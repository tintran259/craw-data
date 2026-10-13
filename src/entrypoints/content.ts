import { defineContentScript } from 'wxt/utils/define-content-script';
import { BlockedError } from '@/adapters/errors';
import { getAdapter } from '@/adapters/registry';
import type {
  CommentRecord,
  GraphqlAccess,
  ObservedPayload,
  PlatformAdapter,
  RequestInfo,
} from '@/adapters/types';
import { collectHtmlJsonBlocks } from '@/core/capture/html-json';
import {
  sendRequest,
  type CapturedPayload,
  type FastModeConfig,
  type JobOutcome,
  type TabMode,
} from '@/core/messaging';
import {
  CONTENT_SOURCE,
  isInterceptorMessage,
  type ContentToInterceptorMessage,
  type InterceptedResponse,
} from '@/core/messaging/page-bridge';
import { toUserMessage } from '@/shared/errors';
import { AbortedError, randomBetween, randomSleep, sleep, type Range } from '@/shared/utils/delay';
import { createLogger } from '@/shared/utils/logger';

const log = createLogger('content');
const FLUSH_INTERVAL_MS = 1000;
/** Giới hạn kích thước mỗi lô raw payload gửi về background. */
const MAX_BATCH_CHARS = 8_000_000;
/** Chờ trang hiển thị xong lô đầu trước khi bắt đầu thao tác. */
const SETTLE_MS = 2500;
/** Sau khi bấm: tần suất kiểm tra đã có dữ liệu mới chưa. */
const PAYLOAD_POLL_MS = 100;
/** Nghỉ thêm sau khi dữ liệu về, để trang hiển thị lô mới và vẫn giữ nhịp như người dùng. */
const SETTLE_AFTER_DATA_MS: Range = { min: 300, max: 900 };
/** Mẫu request GraphQL của trang để chế độ nhanh gửi lại. */
interface RelayTemplate {
  url: string;
  body: string;
  headers: Record<string, string>;
}
/** Header mô tả riêng một operation — không dùng lại khi mượn mẫu của operation khác. */
const OPERATION_HEADERS = ['x-root-field-name', 'x-fb-friendly-name'];
/** Lưu trạng thái để "Chạy tiếp" không quá dày (trạng thái có thể vài trăm KB). */
const CHECKPOINT_INTERVAL_MS = 15_000;

export default defineContentScript({
  // Danh sách thật lấy từ các adapter khi đăng ký (core/capture/register-scripts).
  matches: ['https://*.facebook.com/*'],
  registration: 'runtime',
  runAt: 'document_start',
  globalName: false,
  main() {
    void run().catch((err: unknown) => log.warn('Content script lỗi', err));
  },
});

/**
 * Chờ bằng timer ở background: timer trong tab bị Chrome kìm mạnh khi cửa sổ bị che hoặc chạy nền
 * lâu (tới 1 lần/phút), còn phản hồi tin nhắn từ background thì không.
 */
function backgroundSleep(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.reject(new AbortedError());
  return new Promise((resolve, reject) => {
    const onAbort = () => reject(new AbortedError());
    signal.addEventListener('abort', onAbort, { once: true });
    sendRequest('util/sleep', { ms })
      // Không gửi được (extension vừa tải lại...): vẫn chờ bằng timer của tab.
      .catch(() => sleep(ms))
      .then(() => {
        signal.removeEventListener('abort', onAbort);
        resolve();
      });
  });
}

async function run(): Promise<void> {
  /** undefined = chưa hỏi xong background. */
  let mode: TabMode | null | undefined;
  let adapter: PlatformAdapter | null = null;
  const early: InterceptedResponse[] = [];
  const rawOutbox: CapturedPayload[] = [];
  const recordOutbox: CommentRecord[] = [];
  let expectedTotal: number | null = null;
  /** Ghi chú trực tiếp từ adapter; chỉ gửi khi đổi. */
  let liveNote: string | null = null;
  let sentNote: string | null = null;
  let lastPayloadAt = Date.now();
  let flushTimer: number | undefined;
  let flushing: Promise<void> = Promise.resolve();
  /** Đã đủ số bình luận tối đa mỗi bài (background báo). */
  let limitReached = false;
  const controller = new AbortController();
  /**
   * Request GraphQL (Relay) do trang gửi: URL, body (chứa token phiên), header `x-*` — theo từng
   * operation, kèm mẫu gần nhất. Chỉ giữ trong bộ nhớ tab để chế độ nhanh gửi lại giống hệt trang;
   * không bao giờ gửi về background hay ghi vào debug.
   */
  const relayTemplates = new Map<string, RelayTemplate>();
  let latestTemplate: RelayTemplate | null = null;
  /** Payload nhận trước khi adapter đăng ký nghe (phát lại khi đăng ký); null = không cần giữ. */
  let observedBacklog: ObservedPayload[] | null = [];
  const observers = new Set<(p: ObservedPayload) => void>();
  let checkpointState: (() => unknown) | null = null;
  let lastCheckpointAt = 0;

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
    const noteChanged = liveNote !== sentNote;
    if (!job || (!recordOutbox.length && expectedTotal === null && !noteChanged)) return;
    const records = recordOutbox.splice(0);
    const note = noteChanged ? liveNote : null;
    sentNote = liveNote;
    const res = await sendRequest('job/comments', {
      itemId: job.itemId,
      records,
      expectedTotal,
      note,
    }).catch((err: unknown) => log.warn('Không gửi được bình luận', err));
    if (res?.stop && !limitReached) {
      limitReached = true;
      controller.abort();
    }
  };

  const sendCheckpoint = async (force: boolean) => {
    const job = mode?.job;
    if (!job || !checkpointState) return;
    if (!force && Date.now() - lastCheckpointAt < CHECKPOINT_INTERVAL_MS) return;
    lastCheckpointAt = Date.now();
    const state = checkpointState();
    if (state === null || state === undefined) return;
    await sendRequest('job/checkpoint', { itemId: job.itemId, state }).catch((err: unknown) =>
      log.warn('Không lưu được trạng thái', err),
    );
  };

  /** Gửi hết dữ liệu đang chờ; các lần gọi được xếp hàng để không gửi trùng. */
  const flush = (forceCheckpoint = false): Promise<void> => {
    if (flushTimer !== undefined) {
      clearTimeout(flushTimer);
      flushTimer = undefined;
    }
    flushing = flushing.then(async () => {
      await sendRaw();
      await sendRecords();
      await sendCheckpoint(forceCheckpoint);
    });
    return flushing;
  };
  const scheduleFlush = () => {
    flushTimer ??= window.setTimeout(() => void flush(), FLUSH_INTERVAL_MS);
  };

  const updateTotal = (raw: string) => {
    if (!adapter) return;
    // URL trang hiện tại: link chia sẻ (/share/...) đã được trang chuyển sang link bài thật.
    const total = adapter.extractTotalCount(raw, pageUrl());
    if (total !== null) expectedTotal = Math.max(expectedTotal ?? 0, total);
  };

  /** Ghi debug + trích bình luận từ một response (của trang hoặc của chế độ nhanh). */
  const ingest = (
    raw: string,
    info: RequestInfo,
    meta: { requestUrl: string; status: number; capturedAt: string },
    source: 'page' | 'api',
  ) => {
    if (!mode || !adapter) return;
    if (mode.debugSessionId) {
      rawOutbox.push({ kind: 'graphql', pageUrl: pageUrl(), ...meta, ...info, raw });
    }
    if (mode.job) {
      try {
        const records = adapter.parsePayload(raw, {
          postUrl: mode.postUrl,
          crawledAt: new Date().toISOString(),
          requestVariables: info.variables,
          requestUrl: meta.requestUrl,
          pageUrl: pageUrl(),
        });
        if (records.length) {
          lastPayloadAt = Date.now();
          recordOutbox.push(...records);
        }
        updateTotal(raw);
        const observed: ObservedPayload = { ...info, raw, source };
        observedBacklog?.push(observed);
        for (const fn of observers) fn(observed);
      } catch (err) {
        log.warn('Lỗi khi đọc dữ liệu bình luận', err);
      }
    }
    scheduleFlush();
  };

  const handleResponse = (res: InterceptedResponse) => {
    if (!mode || !adapter) return;
    const body = res.requestBody ?? undefined;
    if (!adapter.isTargetRequest(res.requestUrl, body)) return;
    // Chỉ lấy các trường mô tả; body request (chứa token) không được gửi đi.
    const info = adapter.describeRequest(res.requestUrl, body);
    if (body?.includes('doc_id=') && res.status === 200) {
      latestTemplate = { url: res.requestUrl, body, headers: res.requestHeaders ?? {} };
      if (info.operationName) relayTemplates.set(info.operationName, latestTemplate);
    }
    const meta = { requestUrl: res.requestUrl, status: res.status, capturedAt: res.capturedAt };
    ingest(res.responseText, info, meta, 'page');
  };

  /** Chế độ nhanh: gửi request GraphQL bằng token của trang, xử lý response như trang tự tải. */
  const createGraphqlAccess = (fast: FastModeConfig): GraphqlAccess => ({
    subscribe(listener) {
      for (const p of observedBacklog ?? []) listener(p);
      observedBacklog = null; // đã có người nghe: không cần giữ lịch sử nữa
      observers.add(listener);
      return () => observers.delete(listener);
    },
    ready: () => latestTemplate !== null,
    async request(call) {
      // Ưu tiên mẫu của chính operation này (đúng endpoint + header), không có thì mẫu gần nhất.
      const own = relayTemplates.get(call.friendlyName);
      const template = (own ?? latestTemplate)!;
      const params = new URLSearchParams(template.body);
      params.set('fb_api_caller_class', 'RelayModern');
      params.set('fb_api_req_friendly_name', call.friendlyName);
      params.set('doc_id', call.docId);
      params.set('variables', JSON.stringify(call.variables));
      params.set('server_timestamps', 'true');
      const headers: Record<string, string> = { ...template.headers };
      // Header gắn với operation khác thì bỏ (vd. x-root-field-name của Instagram).
      if (!own) for (const key of OPERATION_HEADERS) delete headers[key];
      headers['content-type'] = 'application/x-www-form-urlencoded';
      headers['x-fb-friendly-name'] = call.friendlyName;
      const lsd = params.get('lsd');
      if (lsd) headers['x-fb-lsd'] = lsd;
      const requestUrl = template.url;
      let status = 0;
      let raw = '';
      try {
        const res = await fetch(requestUrl, {
          method: 'POST',
          body: params.toString(),
          headers,
          credentials: 'include',
          signal: controller.signal,
        });
        status = res.status;
        raw = await res.text();
      } catch (err) {
        if (controller.signal.aborted) throw new AbortedError();
        log.warn('Request API lỗi', err);
      }
      const info: RequestInfo = {
        operationName: call.friendlyName,
        docId: call.docId,
        variables: params.get('variables'),
      };
      const meta = { requestUrl, status, capturedAt: new Date().toISOString() };
      if (raw) ingest(raw, info, meta, 'api');
      return { status, raw };
    },
    delay: () => backgroundSleep(randomBetween(fast.apiDelayMs), controller.signal),
    sleep: (ms) => backgroundSleep(ms, controller.signal),
    replyLanes: fast.replyLanes,
    probeFeedLocation: fast.probeFeedLocation,
  });

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
  // Chỉ chế độ nhanh cần theo dõi payload; tắt thì đừng giữ lịch sử.
  const fast = adapter.supportsFastMode ? (job?.fast ?? null) : null;
  if (!fast) observedBacklog = null;
  const started = job
    ? await sendRequest('job/started', { itemId: job.itemId }).catch(() => null)
    : null;
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
    // Xong thì background xóa trạng thái đã lưu; chỉ cần lưu lần cuối khi còn phải chạy tiếp.
    await flush(outcome !== 'done');
    await sendRequest('job/finished', {
      itemId: job.itemId,
      outcome,
      message,
      blockCode: null,
      expectedTotal,
    }).catch((err: unknown) => log.warn('Không báo được kết quả', err));
  };

  try {
    const initial = adapter.parseInitialHtml(document, {
      postUrl: mode.postUrl,
      crawledAt: new Date().toISOString(),
      pageUrl: pageUrl(),
    });
    if (initial.length) {
      recordOutbox.push(...initial);
      lastPayloadAt = Date.now();
    }
    document.querySelectorAll('script[type="application/json"]').forEach((el) => {
      if (el.textContent?.includes('"total_count"')) updateTotal(el.textContent);
    });
    await flush();
    await sleep(SETTLE_MS);

    const note = await adapter.loadAllComments({
      signal: controller.signal,
      replyDepth: job.replyDepth,
      graphql: fast ? createGraphqlAccess(fast) : null,
      humanDelay: () => randomSleep(job.actionDelayMs, controller.signal),
      afterClick: async () => {
        const since = lastPayloadAt;
        const deadline = Date.now() + randomBetween(job.actionDelayMs);
        while (Date.now() < deadline) {
          await sleep(PAYLOAD_POLL_MS, controller.signal);
          if (lastPayloadAt > since) {
            // Chờ trang hiển thị lô mới (và nút tải tiếp) trước khi bấm lần sau.
            await randomSleep(SETTLE_AFTER_DATA_MS, controller.signal);
            return;
          }
        }
      },
      lastPayloadAt: () => lastPayloadAt,
      idleStopMs: job.idleStopMs,
      log: (m) => log.info(m),
      report: (text) => {
        liveNote = text;
        scheduleFlush();
      },
      onlyNewerThan: job.onlyNewerThan,
      resume: started?.resume ?? null,
      checkpoint: (getState) => {
        checkpointState = getState;
      },
    });
    await finish('done', note);
  } catch (err) {
    if (err instanceof BlockedError) {
      await flush(true);
      await sendRequest('job/finished', {
        itemId: job.itemId,
        outcome: 'blocked',
        message: err.reason.message,
        blockCode: err.reason.code,
        expectedTotal,
      }).catch(() => {});
    } else if (err instanceof AbortedError || controller.signal.aborted) {
      if (limitReached) {
        const reason = 'Dừng vì đã đủ số bình luận tối đa mỗi bài trong Cài đặt.';
        await finish('done', [liveNote, reason].filter(Boolean).join('\n'));
      }
      // Hủy từ background (tạm dừng / hủy hàng đợi): trang sẽ bị điều hướng đi, không báo gì thêm.
    } else {
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
