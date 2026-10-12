import type { CapturedPayload, DebugSession } from '@/core/messaging/protocol';
import { openDb, requestToPromise, STORES, transactionDone } from './idb';

export interface StoredDebugPayload extends CapturedPayload {
  seq?: number;
  sessionId: string;
}

export async function putDebugSession(session: DebugSession): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(STORES.debugSessions, 'readwrite');
  tx.objectStore(STORES.debugSessions).put(session);
  await transactionDone(tx);
}

export async function getDebugSession(id: string): Promise<DebugSession | undefined> {
  const db = await openDb();
  const tx = db.transaction(STORES.debugSessions, 'readonly');
  return requestToPromise(
    tx.objectStore(STORES.debugSessions).get(id) as IDBRequest<DebugSession | undefined>,
  );
}

export async function listDebugSessions(): Promise<DebugSession[]> {
  const db = await openDb();
  const tx = db.transaction(STORES.debugSessions, 'readonly');
  const all = await requestToPromise(
    tx.objectStore(STORES.debugSessions).getAll() as IDBRequest<DebugSession[]>,
  );
  return all.sort((a, b) => a.startedAt.localeCompare(b.startedAt));
}

/** Thêm payload và cập nhật bộ đếm của phiên trong cùng một giao dịch. */
export async function addDebugPayloads(
  sessionId: string,
  payloads: CapturedPayload[],
  skippedHtmlBlocks = 0,
): Promise<DebugSession | undefined> {
  const db = await openDb();
  const tx = db.transaction([STORES.debugSessions, STORES.debugPayloads], 'readwrite');
  const sessions = tx.objectStore(STORES.debugSessions);
  const store = tx.objectStore(STORES.debugPayloads);
  const session = await requestToPromise(
    sessions.get(sessionId) as IDBRequest<DebugSession | undefined>,
  );
  if (!session) {
    tx.abort();
    return undefined;
  }
  for (const p of payloads) {
    store.add({ ...p, sessionId } satisfies StoredDebugPayload);
    if (p.kind === 'graphql') session.graphqlCount++;
    else session.htmlJsonCount++;
    session.totalBytes += p.raw.length;
  }
  session.skippedHtmlBlocks += skippedHtmlBlocks;
  sessions.put(session);
  await transactionDone(tx);
  return session;
}

/** Duyệt toàn bộ payload theo thứ tự thu thập, không nạp hết vào bộ nhớ cùng lúc. */
export async function forEachDebugPayload(
  visit: (payload: StoredDebugPayload) => void,
): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(STORES.debugPayloads, 'readonly');
  await new Promise<void>((resolve, reject) => {
    const req = tx.objectStore(STORES.debugPayloads).openCursor();
    req.onsuccess = () => {
      const cursor = req.result;
      if (!cursor) return resolve();
      visit(cursor.value as StoredDebugPayload);
      cursor.continue();
    };
    req.onerror = () => reject(req.error ?? new Error('Lỗi đọc dữ liệu debug'));
  });
}

export async function clearDebugData(): Promise<void> {
  const db = await openDb();
  const tx = db.transaction([STORES.debugSessions, STORES.debugPayloads], 'readwrite');
  tx.objectStore(STORES.debugSessions).clear();
  tx.objectStore(STORES.debugPayloads).clear();
  await transactionDone(tx);
}
