// Thin IndexedDB wrapper for Weekly Review chunks.
// One row per chunk, keyed by [sessionId, seq]. 7-day retention.
import { createIndexedDbOpener, requestResult, transactionDone } from '../../../../../frontend/src/lib/indexedDb.js';

const DB_NAME = 'weekly-review-chunks-v1';
const STORE = 'chunks';
const RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

const openDb = createIndexedDbOpener(DB_NAME, 1, db => {
  if (!db.objectStoreNames.contains(STORE)) {
    const store = db.createObjectStore(STORE, { keyPath: ['sessionId', 'seq'] });
    store.createIndex('sessionId', 'sessionId', { unique: false });
    store.createIndex('savedAt', 'savedAt', { unique: false });
  }
});

function tx(mode) {
  return openDb().then(db => db.transaction(STORE, mode));
}

export async function putChunk({ sessionId, seq, week, blob, uploaded = false }) {
  const transaction = await tx('readwrite');
  transaction.objectStore(STORE).put({ sessionId, seq, week, blob, uploaded, savedAt: Date.now() });
  await transactionDone(transaction);
}

export async function markChunkUploaded({ sessionId, seq }) {
  const transaction = await tx('readwrite');
  const store = transaction.objectStore(STORE);
  const request = store.get([sessionId, seq]);
  let found = false;
  request.onsuccess = () => {
    if (!request.result) return;
    found = true;
    store.put({ ...request.result, uploaded: true });
  };
  await transactionDone(transaction);
  return found;
}

export async function getChunksForSession(sessionId) {
  const store = (await tx('readonly')).objectStore(STORE);
  const rows = await requestResult(store.index('sessionId').getAll(sessionId));
  return (rows ?? []).sort((a, b) => a.seq - b.seq);
}

export async function listSessions() {
  const store = (await tx('readonly')).objectStore(STORE);
  return new Promise((resolve, reject) => {
    const seen = new Map();
    const req = store.openCursor();
    req.onsuccess = (e) => {
      const cursor = e.target.result;
      if (!cursor) {
        resolve(Array.from(seen.values()));
        return;
      }
      const row = cursor.value;
      const prior = seen.get(row.sessionId);
      if (!prior) {
        seen.set(row.sessionId, {
          sessionId: row.sessionId,
          week: row.week,
          firstSavedAt: row.savedAt,
          lastSavedAt: row.savedAt,
          chunkCount: 1,
          unuploadedCount: row.uploaded ? 0 : 1,
        });
      } else {
        prior.chunkCount += 1;
        prior.firstSavedAt = Math.min(prior.firstSavedAt, row.savedAt);
        prior.lastSavedAt = Math.max(prior.lastSavedAt, row.savedAt);
        if (!row.uploaded) prior.unuploadedCount += 1;
      }
      cursor.continue();
    };
    req.onerror = () => reject(req.error);
  });
}

export async function deleteSession(sessionId) {
  const transaction = await tx('readwrite');
  const store = transaction.objectStore(STORE);
  const request = store.index('sessionId').getAllKeys(sessionId);
  request.onsuccess = () => {
    for (const key of request.result) store.delete(key);
  };
  await transactionDone(transaction);
}

export async function purgeExpired(now = Date.now()) {
  const cutoff = now - RETENTION_MS;
  const transaction = await tx('readwrite');
  const index = transaction.objectStore(STORE).index('savedAt');
  const request = index.openCursor(IDBKeyRange.upperBound(cutoff));
  let deleted = 0;
  request.onsuccess = () => {
    const cursor = request.result;
    if (!cursor) return;
    cursor.delete();
    deleted += 1;
    cursor.continue();
  };
  await transactionDone(transaction);
  return deleted;
}
