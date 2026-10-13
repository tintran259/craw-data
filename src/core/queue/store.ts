import { browser } from 'wxt/browser';
import { broadcast } from '@/core/messaging';
import { EMPTY_QUEUE, type QueueState } from './types';

const KEY = 'queue';

/** Hàng đợi lưu bởi phiên bản cũ (một cửa sổ thu thập duy nhất). */
interface LegacyQueueFields {
  currentItemId?: string | null;
  workerTabId?: number | null;
  workerWindowId?: number | null;
  currentDebugSessionId?: string | null;
}

export function migrateQueue(stored: Partial<QueueState> & LegacyQueueFields): QueueState {
  const { currentItemId, workerTabId, workerWindowId, currentDebugSessionId, ...rest } = stored;
  // Mảng mới: không dùng chung (rồi sửa nhầm) mảng của hằng EMPTY_QUEUE.
  const state: QueueState = { ...EMPTY_QUEUE, items: [], workers: [], startHistory: [], ...rest };
  if (!Array.isArray(state.workers)) state.workers = [];
  if (workerTabId != null && !state.workers.length) {
    state.workers.push({
      tabId: workerTabId,
      windowId: workerWindowId ?? -1,
      slot: 0,
      itemId: currentItemId ?? null,
      debugSessionId: currentDebugSessionId ?? null,
    });
  }
  return state;
}

export async function loadQueue(): Promise<QueueState> {
  const stored = await browser.storage.local.get(KEY);
  return migrateQueue((stored[KEY] as Partial<QueueState> | undefined) ?? {});
}

/** Lưu sau MỖI thay đổi để service worker bị tắt lúc nào cũng chạy tiếp được. */
export async function saveQueue(state: QueueState): Promise<QueueState> {
  await browser.storage.local.set({ [KEY]: state });
  broadcast('queue/state', state);
  return state;
}

let chain: Promise<unknown> = Promise.resolve();

/** Tuần tự hóa mọi thao tác đọc-sửa-ghi hàng đợi để không mất cập nhật. */
export function withQueueLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = chain.then(fn, fn);
  chain = run.catch(() => {});
  return run;
}
