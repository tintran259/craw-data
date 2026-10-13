import { openDb, requestToPromise, STORES, transactionDone } from './idb';

/**
 * Trạng thái chế độ nhanh của từng bài trong hàng đợi (cursor + nhánh reply chưa xong), để bài bị
 * timeout / tạm dừng / bị chặn có thể "Chạy tiếp" thay vì tải lại từ đầu. Nội dung do adapter
 * quyết định (opaque) — ở đây chỉ lưu và trả lại.
 */

interface StoredCheckpoint {
  itemId: string;
  state: unknown;
  savedAt: string;
}

async function withStore<T>(
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await openDb();
  const tx = db.transaction(STORES.checkpoints, mode);
  const result = requestToPromise(run(tx.objectStore(STORES.checkpoints)));
  await transactionDone(tx);
  return result;
}

export async function saveCheckpoint(itemId: string, state: unknown): Promise<void> {
  const row: StoredCheckpoint = { itemId, state, savedAt: new Date().toISOString() };
  await withStore('readwrite', (s) => s.put(row));
}

export async function getCheckpoint(itemId: string): Promise<unknown> {
  const row = await withStore<StoredCheckpoint | undefined>('readonly', (s) => s.get(itemId));
  return row?.state ?? null;
}

export async function deleteCheckpoint(itemId: string): Promise<void> {
  await withStore('readwrite', (s) => s.delete(itemId));
}

export async function clearCheckpoints(): Promise<void> {
  await withStore('readwrite', (s) => s.clear());
}
