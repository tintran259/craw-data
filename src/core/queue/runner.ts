import { browser } from 'wxt/browser';
import type { BlockCode, CommentRecord } from '@/adapters/types';
import { createDebugSession, endDebugSession } from '@/core/capture/debug-session';
import {
  ensureCaptureScriptsRegistered,
  unregisterCaptureScripts,
} from '@/core/capture/register-scripts';
import type { JobOutcome, TabMode } from '@/core/messaging/protocol';
import { addComments, clearComments } from '@/core/storage/comments-db';
import { getSettings, type Settings } from '@/core/storage/settings';
import { hasAnyTabMode, removeTabMode, setTabMode } from '@/core/storage/tab-modes';
import { randomBetween } from '@/shared/utils/delay';
import { createLogger } from '@/shared/utils/logger';
import { parseLinkInput, unsupportedReason } from './links';
import { nextAllowedByHourlyLimit, pruneHistory } from './rate-limit';
import { loadQueue, saveQueue, withQueueLock } from './store';
import { EMPTY_QUEUE, type QueueItem, type QueueState } from './types';

const log = createLogger('queue');

const ALARM_TICK = 'sce-queue-tick';
const ALARM_TIMEOUT = 'sce-job-timeout';
const ALARM_START_TIMEOUT = 'sce-job-start-timeout';
/** Không nhận được tín hiệu từ trang sau khoảng này thì coi như không tải được trang. */
const START_TIMEOUT_MS = 90_000;
/** chrome.alarms không cho đặt sớm hơn 30 giây. */
const MIN_ALARM_MS = 30_000;

const now = () => Date.now();
const iso = () => new Date().toISOString();

function current(state: QueueState): QueueItem | undefined {
  return state.items.find((i) => i.id === state.currentItemId);
}

function scheduleTick(at: number): void {
  const delay = Math.max(0, at - now());
  // setTimeout cho độ chính xác; alarm làm lưới an toàn nếu service worker bị tắt.
  setTimeout(() => void tick(), delay);
  void browser.alarms.create(ALARM_TICK, { when: Math.max(at, now() + MIN_ALARM_MS) });
}

async function clearJobAlarms(): Promise<void> {
  await Promise.all([
    browser.alarms.clear(ALARM_TIMEOUT),
    browser.alarms.clear(ALARM_START_TIMEOUT),
  ]);
}

async function tabExists(tabId: number | null): Promise<boolean> {
  if (tabId === null) return false;
  try {
    await browser.tabs.get(tabId);
    return true;
  } catch {
    return false;
  }
}

/** Cửa sổ riêng, đủ lớn: Facebook chỉ tải thêm khi trang thực sự hiển thị. */
async function ensureWorkerTab(state: QueueState): Promise<number> {
  if (await tabExists(state.workerTabId)) return state.workerTabId!;
  const win = await browser.windows.create({
    url: 'about:blank',
    focused: true,
    width: 1200,
    height: 900,
    type: 'normal',
  });
  const tabId = win?.tabs?.[0]?.id;
  if (tabId === undefined || win?.id === undefined) {
    throw new Error('Không mở được cửa sổ thu thập.');
  }
  state.workerTabId = tabId;
  state.workerWindowId = win.id;
  return tabId;
}

async function closeWorker(state: QueueState): Promise<void> {
  const windowId = state.workerWindowId;
  const tabId = state.workerTabId;
  state.workerTabId = null;
  state.workerWindowId = null;
  // Ghi trước để sự kiện onRemoved sinh ra từ việc đóng không bị coi là người dùng đóng.
  await saveQueue(state);
  try {
    if (windowId !== null) await browser.windows.remove(windowId);
    else if (tabId !== null) await browser.tabs.remove(tabId);
  } catch {
    /* đã đóng */
  }
}

async function releaseScriptsIfIdle(): Promise<void> {
  if (!(await hasAnyTabMode())) await unregisterCaptureScripts();
}

/** Kết thúc bài đang chạy (dọn tab mode, alarm, phiên debug) và đặt lịch nghỉ. */
async function endCurrent(
  state: QueueState,
  patch: Partial<QueueItem>,
  opts: { navigateAway: boolean; rest: Settings | null },
): Promise<void> {
  const item = current(state);
  if (item) Object.assign(item, { finishedAt: iso() }, patch);
  state.currentItemId = null;
  await clearJobAlarms();
  if (state.workerTabId !== null) {
    await removeTabMode(state.workerTabId);
    if (opts.navigateAway) {
      await browser.tabs.update(state.workerTabId, { url: 'about:blank' }).catch(() => {});
    }
  }
  if (state.currentDebugSessionId) {
    await endDebugSession(state.currentDebugSessionId).catch(() => {});
    state.currentDebugSessionId = null;
  }
  if (opts.rest) state.nextRunAt = now() + randomBetween(opts.rest.postDelayMs);
}

async function startItem(state: QueueState, item: QueueItem, settings: Settings): Promise<void> {
  await ensureCaptureScriptsRegistered();
  const tabId = await ensureWorkerTab(state);
  const debugSessionId = settings.debugMode
    ? await createDebugSession(tabId, item.inputUrl, item.platform!)
    : null;
  const mode: TabMode = {
    platform: item.platform!,
    postUrl: item.inputUrl,
    purpose: 'job',
    debugSessionId,
    job: {
      itemId: item.id,
      actionDelayMs: settings.actionDelayMs,
      idleStopMs: settings.idleStopMs,
      includeReplies: settings.includeReplies,
    },
  };
  // Gán chế độ TRƯỚC khi điều hướng để content script của trang mới nhận đúng cấu hình.
  await setTabMode(tabId, mode);

  const startedAt = now();
  Object.assign(item, {
    status: 'running',
    startedAt: new Date(startedAt).toISOString(),
    finishedAt: null,
    error: null,
    retryOnResume: false,
  } satisfies Partial<QueueItem>);
  state.currentItemId = item.id;
  state.currentDebugSessionId = debugSessionId;
  state.startHistory = [...pruneHistory(state.startHistory, startedAt), startedAt];
  state.nextRunAt = null;
  state.waitReason = null;
  await saveQueue(state);

  await browser.tabs.update(tabId, { url: item.inputUrl });
  await browser.alarms.create(ALARM_TIMEOUT, { when: startedAt + settings.postTimeoutMs });
  await browser.alarms.create(ALARM_START_TIMEOUT, { when: startedAt + START_TIMEOUT_MS });
  log.info('Bắt đầu', item.inputUrl);
}

async function tickLocked(): Promise<void> {
  const state = await loadQueue();
  if (state.status !== 'running' || state.currentItemId) return;

  const next = state.items.find((i) => i.status === 'pending');
  if (!next) {
    state.status = 'completed';
    state.nextRunAt = null;
    state.waitReason = null;
    await closeWorker(state);
    await releaseScriptsIfIdle();
    await saveQueue(state);
    return;
  }

  const settings = await getSettings();
  const t = now();
  const hourly = nextAllowedByHourlyLimit(state.startHistory, settings.maxPostsPerHour, t);
  const rest = state.nextRunAt ?? 0;
  const waitUntil = Math.max(hourly, rest);
  if (waitUntil > t + 250) {
    const reason =
      hourly >= rest
        ? `Đã đạt giới hạn ${settings.maxPostsPerHour} bài/giờ — đang chờ`
        : 'Đang nghỉ giữa các bài';
    if (state.waitReason !== reason || state.nextRunAt !== waitUntil) {
      state.waitReason = reason;
      state.nextRunAt = waitUntil;
      await saveQueue(state);
    }
    scheduleTick(waitUntil);
    return;
  }

  try {
    await startItem(state, next, settings);
  } catch (err) {
    log.error('Không bắt đầu được bài', err);
    await endCurrent(
      state,
      { status: 'error', error: 'Không mở được bài viết trong cửa sổ thu thập.' },
      { navigateAway: false, rest: null },
    );
    // Đảm bảo không kẹt ở trạng thái running nếu lỗi xảy ra trước khi gán currentItemId.
    if (next.status === 'pending' || next.status === 'running') {
      Object.assign(next, {
        status: 'error',
        error: 'Không mở được bài viết trong cửa sổ thu thập.',
      });
    }
    await saveQueue(state);
    scheduleTick(now() + 1000);
  }
}

export function tick(): Promise<void> {
  return withQueueLock(tickLocked).catch((err: unknown) => log.error('tick lỗi', err));
}

export function getQueueState(): Promise<QueueState> {
  return loadQueue();
}

export function startQueue(urls: string[]): Promise<QueueState> {
  return withQueueLock(async () => {
    const old = await loadQueue();
    if (['running', 'paused', 'blocked'].includes(old.status)) {
      throw new Error('Hàng đợi hiện tại chưa kết thúc. Hãy Hủy trước khi chạy danh sách mới.');
    }
    const { links } = parseLinkInput(urls.join('\n'));
    if (!links.length) throw new Error('Không có link hợp lệ nào để chạy.');
    await clearComments();
    const items: QueueItem[] = links.map((l) => ({
      id: crypto.randomUUID(),
      inputUrl: l.inputUrl,
      normalizedUrl: l.normalizedUrl,
      platform: l.platform,
      status: l.supported ? 'pending' : 'skipped',
      rootCount: 0,
      replyCount: 0,
      expectedTotal: null,
      error: l.supported || !l.platform ? null : unsupportedReason(l.platform),
      retryOnResume: false,
      startedAt: null,
      finishedAt: null,
    }));
    const state: QueueState = {
      ...EMPTY_QUEUE,
      // Giữ lịch sử để giới hạn mỗi giờ vẫn đúng khi chạy nhiều danh sách liên tiếp.
      startHistory: pruneHistory(old.startHistory, now()),
      workerTabId: old.workerTabId,
      workerWindowId: old.workerWindowId,
      status: 'running',
      items,
    };
    await saveQueue(state);
    scheduleTick(now());
    return state;
  });
}

export function pauseQueue(): Promise<QueueState> {
  return withQueueLock(async () => {
    const state = await loadQueue();
    if (state.status !== 'running') return state;
    if (state.currentItemId) {
      // Bài đang chạy quay về "Chờ"; bình luận đã thu vẫn giữ và sẽ được gộp khi chạy lại.
      await endCurrent(
        state,
        { status: 'pending', finishedAt: null },
        { navigateAway: true, rest: null },
      );
    }
    state.status = 'paused';
    state.waitReason = null;
    return saveQueue(state);
  });
}

export function resumeQueue(): Promise<QueueState> {
  return withQueueLock(async () => {
    const state = await loadQueue();
    if (state.status !== 'paused' && state.status !== 'blocked') return state;
    for (const item of state.items) {
      if (item.retryOnResume)
        Object.assign(item, { status: 'pending', error: null, retryOnResume: false });
    }
    state.status = 'running';
    state.message = null;
    state.nextRunAt = null;
    await saveQueue(state);
    scheduleTick(now());
    return state;
  });
}

export function cancelQueue(): Promise<QueueState> {
  return withQueueLock(async () => {
    const state = await loadQueue();
    if (!['running', 'paused', 'blocked'].includes(state.status)) return state;
    if (state.currentItemId) {
      await endCurrent(
        state,
        { status: 'error', error: 'Đã hủy giữa chừng' },
        { navigateAway: false, rest: null },
      );
    }
    for (const item of state.items) {
      if (item.status === 'pending') Object.assign(item, { status: 'skipped', error: 'Đã hủy' });
      if (item.retryOnResume) item.retryOnResume = false;
    }
    state.status = 'cancelled';
    state.nextRunAt = null;
    state.waitReason = null;
    await closeWorker(state);
    await releaseScriptsIfIdle();
    return saveQueue(state);
  });
}

export function clearQueue(): Promise<QueueState> {
  return withQueueLock(async () => {
    const state = await loadQueue();
    if (['running', 'paused', 'blocked'].includes(state.status)) {
      throw new Error('Hãy Hủy hàng đợi trước khi xóa dữ liệu.');
    }
    await clearComments();
    return saveQueue({ ...EMPTY_QUEUE, startHistory: state.startHistory });
  });
}

/** Chỉ chấp nhận tin nhắn từ đúng tab và đúng bài đang chạy. */
function isCurrentJob(state: QueueState, itemId: string, tabId: number | undefined): boolean {
  return state.currentItemId === itemId && tabId !== undefined && tabId === state.workerTabId;
}

export function onJobStarted(itemId: string, tabId: number | undefined): Promise<void> {
  return withQueueLock(async () => {
    const state = await loadQueue();
    if (isCurrentJob(state, itemId, tabId)) await browser.alarms.clear(ALARM_START_TIMEOUT);
  });
}

export function onJobComments(
  itemId: string,
  records: CommentRecord[],
  expectedTotal: number | null,
  tabId: number | undefined,
): Promise<void> {
  return withQueueLock(async () => {
    const state = await loadQueue();
    if (!isCurrentJob(state, itemId, tabId)) return;
    const item = current(state)!;
    const { addedRoots, addedReplies } = await addComments(itemId, records);
    item.rootCount += addedRoots;
    item.replyCount += addedReplies;
    if (expectedTotal !== null)
      item.expectedTotal = Math.max(item.expectedTotal ?? 0, expectedTotal);
    await browser.alarms.clear(ALARM_START_TIMEOUT);
    await saveQueue(state);
  });
}

export function onJobFinished(
  payload: {
    itemId: string;
    outcome: JobOutcome;
    message: string | null;
    blockCode: BlockCode | null;
    expectedTotal: number | null;
  },
  tabId: number | undefined,
): Promise<void> {
  return withQueueLock(async () => {
    const state = await loadQueue();
    if (!isCurrentJob(state, payload.itemId, tabId)) return;
    const item = current(state)!;
    if (payload.expectedTotal !== null) {
      item.expectedTotal = Math.max(item.expectedTotal ?? 0, payload.expectedTotal);
    }
    const settings = await getSettings();
    const stopsQueue = payload.outcome === 'blocked' && payload.blockCode !== 'unavailable';

    if (payload.outcome === 'done') {
      const total = item.rootCount + item.replyCount;
      await endCurrent(
        state,
        { status: 'done', error: total === 0 ? 'Không tìm thấy bình luận nào' : null },
        { navigateAway: true, rest: settings },
      );
    } else if (stopsQueue) {
      // Giữ nguyên trang để người dùng thấy và xử lý (checkpoint, đăng nhập...).
      await endCurrent(
        state,
        { status: 'error', error: payload.message, retryOnResume: true },
        { navigateAway: false, rest: settings },
      );
      state.status = 'blocked';
      state.message = payload.message;
      if (state.workerWindowId !== null) {
        await browser.windows.update(state.workerWindowId, { focused: true }).catch(() => {});
      }
    } else {
      await endCurrent(
        state,
        { status: 'error', error: payload.message ?? 'Lỗi không xác định' },
        { navigateAway: true, rest: settings },
      );
    }
    await saveQueue(state);
    if (state.status === 'running') scheduleTick(state.nextRunAt ?? now());
  });
}

export function onWorkerTabRemoved(tabId: number): Promise<void> {
  return withQueueLock(async () => {
    const state = await loadQueue();
    if (tabId !== state.workerTabId) return;
    state.workerTabId = null;
    state.workerWindowId = null;
    await removeTabMode(tabId);
    if (state.currentItemId) {
      await endCurrent(
        state,
        { status: 'pending', finishedAt: null },
        { navigateAway: false, rest: null },
      );
    }
    if (state.status === 'running') {
      state.status = 'paused';
      state.message = 'Cửa sổ thu thập đã bị đóng. Bấm "Tiếp tục" để chạy tiếp.';
    }
    await releaseScriptsIfIdle();
    await saveQueue(state);
  });
}

export function onQueueAlarm(name: string): Promise<void> {
  if (name === ALARM_TICK) return tick();
  if (name !== ALARM_TIMEOUT && name !== ALARM_START_TIMEOUT) return Promise.resolve();
  return withQueueLock(async () => {
    const state = await loadQueue();
    const item = current(state);
    if (!item) return;
    const settings = await getSettings();
    const total = item.rootCount + item.replyCount;
    const error =
      name === ALARM_START_TIMEOUT
        ? 'Không tải được trang bài viết (kiểm tra link hoặc kết nối mạng).'
        : `Quá thời gian ${Math.round(settings.postTimeoutMs / 60000)} phút — đã giữ lại ${total} bình luận thu được.`;
    await endCurrent(state, { status: 'error', error }, { navigateAway: true, rest: settings });
    await saveQueue(state);
    if (state.status === 'running') scheduleTick(state.nextRunAt ?? now());
  });
}

/** Gọi mỗi khi service worker khởi động: khôi phục hàng đợi từ storage. */
export function recoverQueue(): Promise<void> {
  return withQueueLock(async () => {
    const state = await loadQueue();
    if (state.currentItemId && !(await tabExists(state.workerTabId))) {
      // Trình duyệt đã khởi động lại hoặc tab mất: chạy lại bài này (dữ liệu cũ vẫn được gộp).
      state.workerTabId = null;
      state.workerWindowId = null;
      await endCurrent(
        state,
        { status: 'pending', finishedAt: null },
        { navigateAway: false, rest: null },
      );
      await saveQueue(state);
    }
  }).then(() => tick());
}
