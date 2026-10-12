import type { CommentRecord } from '@/adapters/types';
import { commentKey, mergeRecord } from '@/core/dedupe';
import { openDb, requestToPromise, STORES, transactionDone } from './idb';

interface StoredComment {
  key: string;
  itemId: string;
  seq: number;
  record: CommentRecord;
}

export interface AddCommentsResult {
  addedRoots: number;
  addedReplies: number;
}

/** Thêm/gộp bình luận của một link. Khử trùng lặp theo platform + commentId trong link đó. */
export async function addComments(
  itemId: string,
  records: CommentRecord[],
): Promise<AddCommentsResult> {
  const result: AddCommentsResult = { addedRoots: 0, addedReplies: 0 };
  if (!records.length) return result;
  const db = await openDb();
  const tx = db.transaction(STORES.comments, 'readwrite');
  const store = tx.objectStore(STORES.comments);
  const seqBase = Date.now() * 1000;
  for (const [i, record] of records.entries()) {
    const key = `${itemId}|${commentKey(record)}`;
    const existing = await requestToPromise(
      store.get(key) as IDBRequest<StoredComment | undefined>,
    );
    if (existing) {
      const merged = mergeRecord(existing.record, record);
      if (existing.record.parentId === null && merged.parentId !== null) {
        result.addedRoots--;
        result.addedReplies++;
      }
      store.put({ ...existing, record: merged } satisfies StoredComment);
    } else {
      if (record.parentId === null) result.addedRoots++;
      else result.addedReplies++;
      store.put({ key, itemId, seq: seqBase + i, record } satisfies StoredComment);
    }
  }
  await transactionDone(tx);
  return result;
}

/** Bình luận của một link theo thứ tự thu thập. */
export async function getCommentsForItem(itemId: string): Promise<CommentRecord[]> {
  const db = await openDb();
  const tx = db.transaction(STORES.comments, 'readonly');
  const rows = await requestToPromise(
    tx.objectStore(STORES.comments).index('itemId').getAll(itemId) as IDBRequest<StoredComment[]>,
  );
  return rows.sort((a, b) => a.seq - b.seq).map((r) => r.record);
}

export async function clearComments(): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(STORES.comments, 'readwrite');
  tx.objectStore(STORES.comments).clear();
  await transactionDone(tx);
}
