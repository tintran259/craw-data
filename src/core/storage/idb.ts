/** Wrapper IndexedDB tối giản. Dùng được ở cả service worker và side panel. */
const DB_NAME = 'social-comment-exporter';
const DB_VERSION = 3;

export const STORES = {
  debugSessions: 'debugSessions',
  debugPayloads: 'debugPayloads',
  comments: 'comments',
  /** Trạng thái chế độ nhanh của từng bài (để "Chạy tiếp"). */
  checkpoints: 'checkpoints',
} as const;

let dbPromise: Promise<IDBDatabase> | null = null;

export function openDb(): Promise<IDBDatabase> {
  dbPromise ??= new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORES.debugSessions)) {
        db.createObjectStore(STORES.debugSessions, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(STORES.debugPayloads)) {
        const store = db.createObjectStore(STORES.debugPayloads, {
          keyPath: 'seq',
          autoIncrement: true,
        });
        store.createIndex('sessionId', 'sessionId');
      }
      if (!db.objectStoreNames.contains(STORES.comments)) {
        const store = db.createObjectStore(STORES.comments, { keyPath: 'key' });
        store.createIndex('itemId', 'itemId');
      }
      if (!db.objectStoreNames.contains(STORES.checkpoints)) {
        db.createObjectStore(STORES.checkpoints, { keyPath: 'itemId' });
      }
    };
    req.onsuccess = () => {
      const db = req.result;
      db.onversionchange = () => {
        db.close();
        dbPromise = null;
      };
      resolve(db);
    };
    req.onerror = () => {
      dbPromise = null;
      reject(req.error ?? new Error('Không mở được cơ sở dữ liệu cục bộ.'));
    };
  });
  return dbPromise;
}

export function requestToPromise<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('Lỗi IndexedDB'));
  });
}

export function transactionDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('Lỗi IndexedDB'));
    tx.onabort = () => reject(tx.error ?? new Error('Giao dịch IndexedDB bị hủy'));
  });
}
