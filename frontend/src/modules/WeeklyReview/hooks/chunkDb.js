// Thin IndexedDB wrapper for Weekly Review chunks.
// One row per chunk, keyed by [sessionId, seq]. 7-day retention.
// No external dependency — raw IndexedDB API.

const DB_NAME = 'weekly-review-chunks-v1';
const STORE = 'chunks';
const RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

let _dbPromise = null;

function openDb() {
  if (_dbPromise) return _dbPromise;
  _dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: ['sessionId', 'seq'] });
        store.createIndex('sessionId', 'sessionId', { unique: false });
        store.createIndex('savedAt', 'savedAt', { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return _dbPromise;
}

function tx(mode) {
  return openDb().then(db => db.transaction(STORE, mode).objectStore(STORE));
}

export async function putChunk({ sessionId, seq, week, blob, uploaded = false }) {
  const store = await tx('readwrite');
  return new Promise((resolve, reject) => {
    const req = store.put({ sessionId, seq, week, blob, uploaded, savedAt: Date.now() });
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

export async function markChunkUploaded({ sessionId, seq }) {
  const store = await tx('readwrite');
  return new Promise((resolve, reject) => {
    const getReq = store.get([sessionId, seq]);
    getReq.onsuccess = () => {
      const row = getReq.result;
      if (!row) return resolve(false);
      row.uploaded = true;
      const putReq = store.put(row);
      putReq.onsuccess = () => resolve(true);
      putReq.onerror = () => reject(putReq.error);
    };
    getReq.onerror = () => reject(getReq.error);
  });
}

export async function getChunksForSession(sessionId) {
  const store = await tx('readonly');
  return new Promise((resolve, reject) => {
    const req = store.index('sessionId').getAll(sessionId);
    req.onsuccess = () => resolve((req.result || []).sort((a, b) => a.seq - b.seq));
    req.onerror = () => reject(req.error);
  });
}

export async function listSessions() {
  const store = await tx('readonly');
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
  const chunks = await getChunksForSession(sessionId);
  const store = await tx('readwrite');
  return Promise.all(chunks.map(c => new Promise((resolve, reject) => {
    const req = store.delete([sessionId, c.seq]);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  })));
}

export async function purgeExpired(now = Date.now()) {
  const cutoff = now - RETENTION_MS;
  const store = await tx('readwrite');
  return new Promise((resolve, reject) => {
    const index = store.index('savedAt');
    const range = IDBKeyRange.upperBound(cutoff);
    const req = index.openCursor(range);
    let deleted = 0;
    req.onsuccess = (e) => {
      const cursor = e.target.result;
      if (!cursor) return resolve(deleted);
      cursor.delete();
      deleted += 1;
      cursor.continue();
    };
    req.onerror = () => reject(req.error);
  });
}
