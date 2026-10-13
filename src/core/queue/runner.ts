import { browser } from 'wxt/browser';
import type { BlockCode, CommentRecord } from '@/adapters/types';
import { createDebugSession, endDebugSession } from '@/core/capture/debug-session';
import {
  ensureCaptureScriptsRegistered,
  unregisterCaptureScripts,
} from '@/core/capture/register-scripts';
import type { JobOutcome, TabMode } from '@/core/messaging/protocol';
import {
  clearCheckpoints,
  deleteCheckpoint,
  getCheckpoint,
  saveCheckpoint,
} from '@/core/storage/checkpoints';
import { addComments, clearComments } from '@/core/storage/comments-db';
import { getNewestCommentTime, recordNewestCommentTime } from '@/core/storage/post-history';
import { getSettings, type Settings } from '@/core/storage/settings';
import { hasAnyTabMode, removeTabMode, setTabMode } from '@/core/storage/tab-modes';
import { randomBetween } from '@/shared/utils/delay';
import { createLogger } from '@/shared/utils/logger';
import { parseLinkInput, unsupportedReason } from './links';
import { nextAllowedByHourlyLimit, pruneHistory } from './rate-limit';
import { loadQueue, saveQueue, withQueueLock } from './store';
import {
  EMPTY_QUEUE,
  type QueueItem,
  type QueueState,
  type ScreenArea,
  type Worker,
} from './types';

const log = createLogger('queue');

const ALARM_TICK = 'sce-queue-tick';
/** Alarm theo từng bài (chạy song song nhiều bài): tên = tiền tố + id bài. */
const ALARM_TIMEOUT = 'sce-job-timeout:';
const ALARM_START_TIMEOUT = 'sce-job-start:';
/** Không nhận được tín hiệu từ trang sau khoảng này thì coi như không tải được trang. */
const START_TIMEOUT_MS = 90_000;
/** chrome.alarms không cho đặt sớm hơn 30 giây. */
const MIN_ALARM_MS = 30_000;
/** Cửa sổ thu thập khi chạy từng bài một: đủ lớn để trang hiển thị đầy đủ. */
const SINGLE_WINDOW = { width: 1200, height: 900 };

const now = () => Date.now();
const iso = () => new Date().toISOString();
const ACTIVE = ['running', 'paused', 'blocked'];

const itemById = (state: QueueState, id: string | null) =>
  id ? state.items.find((i) => i.id === id) : undefined;

/** Cửa sổ đang chạy đúng bài này trong đúng tab gửi tin nhắn. */
const jobWorker = (state: QueueState, itemId: string, tabId: number | undefined) =>
  tabId === undefined
    ? undefined
    : state.workers.find((w) => w.itemId === itemId && w.tabId === tabId);

function scheduleTick(at: number): void {
  const delay = Math.max(0, at - now());
  // setTimeout cho độ chính xác; alarm làm lưới an toàn nếu service worker bị tắt.
  setTimeout(() => void tick(), delay);
  void browser.alarms.create(ALARM_TICK, { when: Math.max(at, now() + MIN_ALARM_MS) });
}

async function clearJobAlarms(itemId: string): Promise<void> {
  await Promise.all([
    browser.alarms.clear(ALARM_TIMEOUT + itemId),
    browser.alarms.clear(ALARM_START_TIMEOUT + itemId),
  ]);
}

async function tabExists(tabId: number): Promise<boolean> {
  try {
    await browser.tabs.get(tabId);
    return true;
  } catch {
    return false;
  }
}

/** Vùng của cửa sổ trình duyệt đang dùng — các cửa sổ thu thập được xếp trong vùng này. */
async function currentScreenArea(): Promise<ScreenArea | null> {
  try {
    const win = await browser.windows.getLastFocused({ windowTypes: ['normal'] });
    if (!win.width || !win.height) return null;
    return { left: win.left ?? 0, top: win.top ?? 0, width: win.width, height: win.height };
  } catch {
    return null;
  }
}

/**
 * Vị trí cửa sổ thứ `slot` khi chạy `total` bài cùng lúc: chia đều vùng màn hình để các cửa sổ
 * không che nhau (cửa sổ bị che hoàn toàn bị Chrome coi là ẩn và chạy chậm lại).
 */
export function windowBounds(
  slot: number,
  total: number,
  area: ScreenArea | null,
): { left?: number; top?: number; width: number; height: number } {
  if (total <= 1 || !area) return SINGLE_WINDOW;
  const cols = Math.min(total, 2);
  const rows = Math.ceil(total / cols);
  const width = Math.floor(area.width / cols);
  const height = Math.floor(area.height / rows);
  return {
    left: area.left + (slot % cols) * width,
    top: area.top + Math.floor(slot / cols) * height,
    width,
    height,
  };
}

/** Cửa sổ rảnh còn mở, hoặc mở cửa sổ mới ở ô lưới còn trống. */
async function idleWorker(state: QueueState, settings: Settings): Promise<Worker> {
  for (const w of state.workers.filter((w) => !w.itemId)) {
    if (await tabExists(w.tabId)) return w;
    state.workers = state.workers.filter((x) => x !== w);
  }
  const used = new Set(state.workers.map((w) => w.slot));
  let slot = 0;
  while (used.has(slot)) slot++;
  const win = await browser.windows.create({
    url: 'about:blank',
    focused: true,
    type: 'normal',
    ...windowBounds(slot, settings.parallelPosts, state.area),
  });
  const tabId = win?.tabs?.[0]?.id;
  if (tabId === undefined || win?.id === undefined) {
    throw new Error('Không mở được cửa sổ thu thập.');
  }
  const worker: Worker = { tabId, windowId: win.id, slot, itemId: null, debugSessionId: null };
  state.workers.push(worker);
  return worker;
}

async function closeWorkers(state: QueueState): Promise<void> {
  const workers = state.workers;
  state.workers = [];
  // Ghi trước để sự kiện onRemoved sinh ra từ việc đóng không bị coi là người dùng đóng.
  await saveQueue(state);
  for (const w of workers) {
    const close =
      w.windowId >= 0 ? browser.windows.remove(w.windowId) : browser.tabs.remove(w.tabId);
    await close.catch(() => {});
  }
}

async function releaseScriptsIfIdle(): Promise<void> {
  if (!(await hasAnyTabMode())) await unregisterCaptureScripts();
}

/** Kết thúc bài trong một cửa sổ (dọn tab mode, alarm, phiên debug) và đặt lịch nghỉ. */
async function endJob(
  state: QueueState,
  worker: Worker,
  patch: Partial<QueueItem>,
  opts: { navigateAway: boolean; rest: Settings | null },
): Promise<void> {
  const item = itemById(state, worker.itemId);
  if (item) {
    Object.assign(item, { finishedAt: iso() }, patch);
    await clearJobAlarms(item.id);
  }
  worker.itemId = null;
  await removeTabMode(worker.tabId);
  if (opts.navigateAway) {
    await browser.tabs.update(worker.tabId, { url: 'about:blank' }).catch(() => {});
  }
  if (worker.debugSessionId) {
    await endDebugSession(worker.debugSessionId).catch(() => {});
    worker.debugSessionId = null;
  }
  if (opts.rest) {
    state.nextRunAt = Math.max(state.nextRunAt ?? 0, now() + randomBetween(opts.rest.postDelayMs));
  }
}

/** Kết thúc mọi bài đang chạy (tạm dừng / hủy / bị chặn ở cửa sổ khác). */
async function endAllJobs(
  state: QueueState,
  patch: Partial<QueueItem>,
  opts: { navigateAway: boolean },
): Promise<void> {
  for (const w of state.workers) {
    if (w.itemId) await endJob(state, w, patch, { ...opts, rest: null });
  }
}

async function startItem(state: QueueState, item: QueueItem, settings: Settings): Promise<void> {
  await ensureCaptureScriptsRegistered();
  const worker = await idleWorker(state, settings);
  const debugSessionId = settings.debugMode
    ? await createDebugSession(worker.tabId, item.inputUrl, item.platform!)
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
      replyDepth: settings.replyDepth,
      fast: settings.fastMode
        ? {
            apiDelayMs: settings.apiDelayMs,
            replyLanes: settings.replyLanes,
            probeFeedLocation: settings.probeFeedLocation,
          }
        : null,
      onlyNewerThan: settings.onlyNewComments
        ? await getNewestCommentTime(item.normalizedUrl)
        : null,
    },
  };
  // Gán chế độ TRƯỚC khi điều hướng để content script của trang mới nhận đúng cấu hình.
  await setTabMode(worker.tabId, mode);

  const startedAt = now();
  Object.assign(item, {
    status: 'running',
    startedAt: new Date(startedAt).toISOString(),
    finishedAt: null,
    error: null,
    note: null,
    retryOnResume: false,
    limitReached: false,
  } satisfies Partial<QueueItem>);
  worker.itemId = item.id;
  worker.debugSessionId = debugSessionId;
  state.startHistory = [...pruneHistory(state.startHistory, startedAt), startedAt];
  // Giãn cách các lần mở bài, kể cả khi chạy song song.
  state.nextRunAt = startedAt + randomBetween(settings.postDelayMs);
  state.waitReason = null;
  await saveQueue(state);

  await browser.tabs.update(worker.tabId, { url: item.inputUrl });
  await browser.alarms.create(ALARM_TIMEOUT + item.id, {
    when: startedAt + settings.postTimeoutMs,
  });
  await browser.alarms.create(ALARM_START_TIMEOUT + item.id, {
    when: startedAt + START_TIMEOUT_MS,
  });
  log.info('Bắt đầu', item.inputUrl);
}

async function tickLocked(): Promise<void> {
  const state = await loadQueue();
  if (state.status !== 'running') return;

  const busy = state.workers.filter((w) => w.itemId).length;
  const next = state.items.find((i) => i.status === 'pending');
  if (!next) {
    if (busy) return; // chờ các bài đang chạy xong
    state.status = 'completed';
    state.finishedAt = now();
    state.nextRunAt = null;
    state.waitReason = null;
    await closeWorkers(state);
    await releaseScriptsIfIdle();
    await saveQueue(state);
    return;
  }

  const settings = await getSettings();
  if (busy >= settings.parallelPosts) return;
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
    const error = 'Không mở được bài viết trong cửa sổ thu thập.';
    const worker = state.workers.find((w) => w.itemId === next.id);
    if (worker) {
      await endJob(state, worker, { status: 'error', error }, { navigateAway: false, rest: null });
    } else {
      Object.assign(next, { status: 'error', error });
    }
    await saveQueue(state);
  }
  // Còn chỗ chạy song song thì mở bài kế tiếp (sau khoảng nghỉ đã đặt).
  scheduleTick(state.nextRunAt ?? now() + 1000);
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
    if (ACTIVE.includes(old.status)) {
      throw new Error('Hàng đợi hiện tại chưa kết thúc. Hãy Hủy trước khi chạy danh sách mới.');
    }
    const { links } = parseLinkInput(urls.join('\n'));
    if (!links.length) throw new Error('Không có link hợp lệ nào để chạy.');
    await Promise.all([clearComments(), clearCheckpoints()]);
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
      workers: old.workers.map((w) => ({ ...w, itemId: null, debugSessionId: null })),
      area: await currentScreenArea(),
      status: 'running',
      items,
      startedAt: now(),
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
    // Bài đang chạy quay về "Chờ"; bình luận đã thu và checkpoint vẫn giữ để chạy tiếp.
    await endAllJobs(state, { status: 'pending', finishedAt: null }, { navigateAway: true });
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
    state.area = (await currentScreenArea()) ?? state.area;
    await saveQueue(state);
    scheduleTick(now());
    return state;
  });
}

export function cancelQueue(): Promise<QueueState> {
  return withQueueLock(async () => {
    const state = await loadQueue();
    if (!ACTIVE.includes(state.status)) return state;
    await endAllJobs(
      state,
      { status: 'error', error: 'Đã hủy giữa chừng' },
      { navigateAway: false },
    );
    for (const item of state.items) {
      if (item.status === 'pending') Object.assign(item, { status: 'skipped', error: 'Đã hủy' });
      item.retryOnResume = false;
    }
    state.status = 'cancelled';
    state.finishedAt = now();
    state.nextRunAt = null;
    state.waitReason = null;
    await closeWorkers(state);
    await releaseScriptsIfIdle();
    return saveQueue(state);
  });
}

export function clearQueue(): Promise<QueueState> {
  return withQueueLock(async () => {
    const state = await loadQueue();
    if (ACTIVE.includes(state.status)) {
      throw new Error('Hãy Hủy hàng đợi trước khi xóa dữ liệu.');
    }
    await Promise.all([clearComments(), clearCheckpoints()]);
    return saveQueue({ ...EMPTY_QUEUE, items: [], workers: [], startHistory: state.startHistory });
  });
}

/** Chạy lại một bài lỗi / bị hủy. Có checkpoint thì chạy tiếp từ chỗ dừng; bình luận cũ được giữ. */
export function retryItem(itemId: string): Promise<QueueState> {
  return withQueueLock(async () => {
    const state = await loadQueue();
    const item = itemById(state, itemId);
    if (!item || item.status === 'pending' || item.status === 'running') return state;
    Object.assign(item, { status: 'pending', error: null, finishedAt: null, retryOnResume: false });
    if (!ACTIVE.includes(state.status)) {
      state.status = 'running';
      state.finishedAt = null;
      state.message = null;
      state.area = (await currentScreenArea()) ?? state.area;
    }
    await saveQueue(state);
    if (state.status === 'running') scheduleTick(now());
    return state;
  });
}

export function onJobStarted(
  itemId: string,
  tabId: number | undefined,
): Promise<{ resume: unknown }> {
  return withQueueLock(async () => {
    const state = await loadQueue();
    if (!jobWorker(state, itemId, tabId)) return { resume: null };
    await browser.alarms.clear(ALARM_START_TIMEOUT + itemId);
    return { resume: await getCheckpoint(itemId) };
  });
}

export function onJobComments(
  itemId: string,
  records: CommentRecord[],
  expectedTotal: number | null,
  tabId: number | undefined,
  note: string | null = null,
): Promise<{ stop: boolean }> {
  return withQueueLock(async () => {
    const state = await loadQueue();
    const item = jobWorker(state, itemId, tabId) ? itemById(state, itemId) : undefined;
    if (!item) return { stop: false };
    const { addedRoots, addedReplies } = await addComments(itemId, records);
    item.rootCount += addedRoots;
    item.replyCount += addedReplies;
    if (expectedTotal !== null)
      item.expectedTotal = Math.max(item.expectedTotal ?? 0, expectedTotal);
    if (note) item.note = note;
    for (const r of records) {
      if (r.parentId === null && r.createdAt && r.createdAt > (item.newestCommentAt ?? '')) {
        item.newestCommentAt = r.createdAt;
      }
    }
    const { maxCommentsPerPost } = await getSettings();
    const stop = maxCommentsPerPost > 0 && item.rootCount + item.replyCount >= maxCommentsPerPost;
    if (stop) item.limitReached = true;
    await browser.alarms.clear(ALARM_START_TIMEOUT + itemId);
    await saveQueue(state);
    return { stop };
  });
}

export function onJobCheckpoint(
  itemId: string,
  checkpoint: unknown,
  tabId: number | undefined,
): Promise<void> {
  return withQueueLock(async () => {
    const state = await loadQueue();
    const item = jobWorker(state, itemId, tabId) ? itemById(state, itemId) : undefined;
    if (!item) return;
    await saveCheckpoint(itemId, checkpoint);
    if (!item.hasCheckpoint) {
      item.hasCheckpoint = true;
      await saveQueue(state);
    }
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
    const worker = jobWorker(state, payload.itemId, tabId);
    const item = itemById(state, payload.itemId);
    if (!worker || !item) return;
    if (payload.expectedTotal !== null) {
      item.expectedTotal = Math.max(item.expectedTotal ?? 0, payload.expectedTotal);
    }
    const settings = await getSettings();
    const stopsQueue = payload.outcome === 'blocked' && payload.blockCode !== 'unavailable';

    if (payload.outcome === 'done') {
      const total = item.rootCount + item.replyCount;
      await endJob(
        state,
        worker,
        {
          status: 'done',
          error: total === 0 ? 'Không tìm thấy bình luận nào' : null,
          note: payload.message,
          hasCheckpoint: false,
        },
        { navigateAway: true, rest: settings },
      );
      await deleteCheckpoint(item.id);
      // Chỉ ghi mốc khi đã lấy hết bài — lần sau "chỉ lấy bình luận mới" bắt đầu từ mốc này.
      if (item.newestCommentAt && !item.limitReached) {
        await recordNewestCommentTime(item.normalizedUrl, item.newestCommentAt);
      }
    } else if (stopsQueue) {
      // Giữ nguyên trang để người dùng thấy và xử lý (checkpoint, đăng nhập...).
      await endJob(
        state,
        worker,
        { status: 'error', error: payload.message, retryOnResume: true },
        { navigateAway: false, rest: settings },
      );
      await endAllJobs(state, { status: 'pending', finishedAt: null }, { navigateAway: true });
      state.status = 'blocked';
      state.message = payload.message;
      await browser.windows.update(worker.windowId, { focused: true }).catch(() => {});
    } else {
      await endJob(
        state,
        worker,
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
    const worker = state.workers.find((w) => w.tabId === tabId);
    if (!worker) return;
    const pending: Partial<QueueItem> = { status: 'pending', finishedAt: null };
    await endJob(state, worker, pending, { navigateAway: false, rest: null });
    state.workers = state.workers.filter((w) => w !== worker);
    if (state.status === 'running') {
      await endAllJobs(state, pending, { navigateAway: true });
      state.status = 'paused';
      state.message = 'Cửa sổ thu thập đã bị đóng. Bấm "Tiếp tục" để chạy tiếp.';
    }
    await releaseScriptsIfIdle();
    await saveQueue(state);
  });
}

export function onQueueAlarm(name: string): Promise<void> {
  if (name === ALARM_TICK) return tick();
  const startTimeout = name.startsWith(ALARM_START_TIMEOUT);
  if (!startTimeout && !name.startsWith(ALARM_TIMEOUT)) return Promise.resolve();
  const itemId = name.slice((startTimeout ? ALARM_START_TIMEOUT : ALARM_TIMEOUT).length);
  return withQueueLock(async () => {
    const state = await loadQueue();
    const worker = state.workers.find((w) => w.itemId === itemId);
    const item = itemById(state, itemId);
    if (!worker || !item) return;
    const settings = await getSettings();
    const total = item.rootCount + item.replyCount;
    const error = startTimeout
      ? 'Không tải được trang bài viết (kiểm tra link hoặc kết nối mạng).'
      : `Quá thời gian ${Math.round(settings.postTimeoutMs / 60000)} phút — đã giữ lại ${total} bình luận thu được.`;
    await endJob(state, worker, { status: 'error', error }, { navigateAway: true, rest: settings });
    await saveQueue(state);
    if (state.status === 'running') scheduleTick(state.nextRunAt ?? now());
  });
}

/** Gọi mỗi khi service worker khởi động: khôi phục hàng đợi từ storage. */
export function recoverQueue(): Promise<void> {
  return withQueueLock(async () => {
    const state = await loadQueue();
    let changed = false;
    for (const worker of [...state.workers]) {
      if (await tabExists(worker.tabId)) continue;
      // Trình duyệt đã khởi động lại hoặc tab mất: chạy lại bài này (dữ liệu cũ vẫn được gộp).
      const pending: Partial<QueueItem> = { status: 'pending', finishedAt: null };
      await endJob(state, worker, pending, { navigateAway: false, rest: null });
      state.workers = state.workers.filter((w) => w !== worker);
      changed = true;
    }
    if (changed) await saveQueue(state);
  }).then(() => tick());
}
