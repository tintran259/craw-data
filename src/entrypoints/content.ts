import { defineContentScript } from 'wxt/utils/define-content-script';
import { BlockedError } from '@/adapters/errors';
import { getAdapter } from '@/adapters/registry';
import type { CommentRecord, PlatformAdapter } from '@/adapters/types';
import { collectHtmlJsonBlocks } from '@/core/capture/html-json';
import { sendRequest, type CapturedPayload, type JobOutcome, type TabMode } from '@/core/messaging';
import {
  CONTENT_SOURCE,
  isInterceptorMessage,
  type ContentToInterceptorMessage,
  type InterceptedResponse,
} from '@/core/messaging/page-bridge';
import { toUserMessage } from '@/shared/errors';
import { AbortedError, randomSleep, sleep } from '@/shared/utils/delay';
import { createLogger } from '@/shared/utils/logger';

const log = createLogger('content');
const FLUSH_INTERVAL_MS = 1000;
/** Giới hạn kích thước mỗi lô raw payload gửi về background. */
const MAX_BATCH_CHARS = 8_000_000;
/** Chờ trang hiển thị xong lô đầu trước khi bắt đầu thao tác. */
const SETTLE_MS = 2500;

export default defineContentScript({
  matches: ['https://*.facebook.com/*'],
  // Không nằm trong manifest; background đăng ký động khi cần (xem core/capture/register-scripts).
  registration: 'runtime',
  runAt: 'document_start',
  globalName: false,
  main() {
    void run().catch((err: unknown) => log.warn('Content script lỗi', err));
  },
});

async function run(): Promise<void> {
  /** undefined = chưa hỏi xong background. */
  let mode: TabMode | null | undefined;
  let adapter: PlatformAdapter | null = null;
  const early: InterceptedResponse[] = [];
  const rawOutbox: CapturedPayload[] = [];
  const recordOutbox: CommentRecord[] = [];
  let expectedTotal: number | null = null;
  let lastPayloadAt = Date.now();
  let flushTimer: number | undefined;
  let flushing: Promise<void> = Promise.resolve();

  const configureInterceptor = (enabled: boolean) => {
    const msg: ContentToInterceptorMessage = { source: CONTENT_SOURCE, type: 'config', enabled };
    window.postMessage(msg, window.location.origin);
  };
  const pageUrl = () => location.href.split('#')[0] ?? location.href;

  const sendRaw = async () => {
    while (rawOutbox.length) {
      const batch: CapturedPayload[] = [];
      let size = 0;
      while (
        rawOutbox.length &&
        (!batch.length || size + rawOutbox[0]!.raw.length < MAX_BATCH_CHARS)
      ) {
        const next = rawOutbox.shift()!;
        size += next.raw.length;
        batch.push(next);
      }
      await sendRequest('capture/payloads', { payloads: batch }).catch((err: unknown) =>
        log.warn('Không gửi được dữ liệu debug', err),
      );
    }
  };

  const sendRecords = async () => {
    const job = mode?.job;
    if (!job || (!recordOutbox.length && expectedTotal === null)) return;
    const records = recordOutbox.splice(0);
    await sendRequest('job/comments', { itemId: job.itemId, records, expectedTotal }).catch(
      (err: unknown) => log.warn('Không gửi được bình luận', err),
    );
  };

  /** Gửi hết dữ liệu đang chờ; các lần gọi được xếp hàng để không gửi trùng. */
  const flush = (): Promise<void> => {
    if (flushTimer !== undefined) {
      clearTimeout(flushTimer);
      flushTimer = undefined;
    }
    flushing = flushing.then(async () => {
      await sendRaw();
      await sendRecords();
    });
    return flushing;
  };
  const scheduleFlush = () => {
    flushTimer ??= window.setTimeout(() => void flush(), FLUSH_INTERVAL_MS);
  };

  const updateTotal = (raw: string) => {
    if (!adapter) return;
    const total = adapter.extractTotalCount(raw);
    if (total !== null) expectedTotal = Math.max(expectedTotal ?? 0, total);
  };

  const handleResponse = (res: InterceptedResponse) => {
    if (!mode || !adapter) return;
    const body = res.requestBody ?? undefined;
    if (!adapter.isTargetRequest(res.requestUrl, body)) return;
    // Chỉ lấy các trường mô tả; body request (chứa token) không được gửi đi.
    const info = adapter.describeRequest(res.requestUrl, body);
    if (mode.debugSessionId) {
      rawOutbox.push({
        kind: 'graphql',
        pageUrl: pageUrl(),
        requestUrl: res.requestUrl,
        ...info,
        status: res.status,
        raw: res.responseText,
        capturedAt: res.capturedAt,
      });
    }
    if (mode.job) {
      try {
        const records = adapter.parsePayload(res.responseText, {
          postUrl: mode.postUrl,
          crawledAt: new Date().toISOString(),
          requestVariables: info.variables,
        });
        if (records.length) {
          lastPayloadAt = Date.now();
          recordOutbox.push(...records);
        }
        updateTotal(res.responseText);
      } catch (err) {
        log.warn('Lỗi khi đọc dữ liệu bình luận', err);
      }
    }
    scheduleFlush();
  };

  // Lắng nghe ngay từ đầu để không lỡ tín hiệu "ready" của interceptor.
  window.addEventListener('message', (event: MessageEvent) => {
    if (event.source !== window || !isInterceptorMessage(event.data)) return;
    const msg = event.data;
    if (msg.type === 'ready') {
      if (mode !== undefined) configureInterceptor(!!mode);
    } else if (mode === undefined) {
      early.push(msg.data);
    } else {
      handleResponse(msg.data);
    }
  });

  try {
    mode = await sendRequest('tab/getMode');
  } catch (err) {
    log.warn('Không lấy được chế độ của tab', err);
    mode = null;
  }
  adapter = mode ? getAdapter(mode.platform) : null;
  if (!adapter) mode = null;
  configureInterceptor(!!mode);
  if (!mode || !adapter) return;

  const job = mode.job;
  if (job) await sendRequest('job/started', { itemId: job.itemId }).catch(() => {});
  for (const res of early.splice(0)) handleResponse(res);

  await domReady();

  if (mode.debugSessionId) {
    const { blocks, skipped } = collectHtmlJsonBlocks(document);
    const capturedAt = new Date().toISOString();
    for (const raw of blocks) {
      rawOutbox.push({
        kind: 'html-json',
        pageUrl: pageUrl(),
        requestUrl: null,
        operationName: null,
        docId: null,
        variables: null,
        status: null,
        raw,
        capturedAt,
      });
    }
    if (skipped) {
      await sendRequest('capture/payloads', { payloads: [], skippedHtmlBlocks: skipped }).catch(
        () => {},
      );
    }
  }

  if (!job) {
    await flush();
    return;
  }

  const finish = async (outcome: JobOutcome, message: string | null) => {
    await flush();
    await sendRequest('job/finished', {
      itemId: job.itemId,
      outcome,
      message,
      blockCode: null,
      expectedTotal,
    }).catch((err: unknown) => log.warn('Không báo được kết quả', err));
  };

  const controller = new AbortController();
  try {
    const ctx = { postUrl: mode.postUrl, crawledAt: new Date().toISOString() };
    const initial = adapter.parseInitialHtml(document, ctx);
    if (initial.length) {
      recordOutbox.push(...initial);
      lastPayloadAt = Date.now();
    }
    document.querySelectorAll('script[type="application/json"]').forEach((el) => {
      if (el.textContent?.includes('"total_count"')) updateTotal(el.textContent);
    });
    await flush();
    await sleep(SETTLE_MS);

    await adapter.loadAllComments({
      signal: controller.signal,
      includeReplies: job.includeReplies,
      humanDelay: () => randomSleep(job.actionDelayMs, controller.signal),
      lastPayloadAt: () => lastPayloadAt,
      idleStopMs: job.idleStopMs,
      log: (m) => log.info(m),
    });
    await finish('done', null);
  } catch (err) {
    if (err instanceof BlockedError) {
      await flush();
      await sendRequest('job/finished', {
        itemId: job.itemId,
        outcome: 'blocked',
        message: err.reason.message,
        blockCode: err.reason.code,
        expectedTotal,
      }).catch(() => {});
    } else if (!(err instanceof AbortedError)) {
      log.warn('Lỗi khi tải bình luận', err);
      await finish('error', `Lỗi khi tải bình luận: ${toUserMessage(err)}`);
    }
  }
}

function domReady(): Promise<void> {
  if (document.readyState !== 'loading') return Promise.resolve();
  return new Promise((resolve) =>
    document.addEventListener('DOMContentLoaded', () => resolve(), { once: true }),
  );
}
