import { browser } from 'wxt/browser';
import { broadcast } from '@/core/messaging';
import { EMPTY_QUEUE, type QueueState } from './types';

const KEY = 'queue';

export async function loadQueue(): Promise<QueueState> {
  const stored = await browser.storage.local.get(KEY);
  return { ...EMPTY_QUEUE, ...((stored[KEY] as Partial<QueueState> | undefined) ?? {}) };
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
