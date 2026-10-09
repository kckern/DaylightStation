// Tiny IndexedDB key→value store for persisted piano list responses. Keeps the
// kiosk snappy across reloads: a cached list paints instantly, then revalidates
// against the API in the background. No deps — raw IndexedDB, all errors swallow
// to null/no-op so a missing/blocked IDB (e.g. jsdom in tests) degrades to a
// plain network fetch.

const DB_NAME = 'daylight-piano';
const STORE = 'lists';
const DB_VERSION = 1;

let dbPromise = null;

function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined' || !indexedDB) { reject(new Error('no-indexeddb')); return; }
    let req;
    try { req = indexedDB.open(DB_NAME, DB_VERSION); } catch (e) { reject(e); return; }
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('idb-open-failed'));
    req.onblocked = () => reject(new Error('idb-blocked'));
  }).catch((e) => { dbPromise = null; throw e; });
  return dbPromise;
}

/** Read one entry by key. Resolves null on any failure (no IDB, miss, error). */
export async function idbGet(key) {
  try {
    const db = await openDb();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly');
      const r = tx.objectStore(STORE).get(key);
      r.onsuccess = () => resolve(r.result ?? null);
      r.onerror = () => reject(r.error);
    });
  } catch { return null; }
}

/** Write one entry; silently no-ops on any failure. */
export async function idbSet(key, val) {
  try {
    const db = await openDb();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(val, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch { /* ignore */ }
}

/** Wipe the whole store (used by the in-memory cache reset in tests/dev). */
export async function idbClear() {
  try {
    const db = await openDb();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch { /* ignore */ }
}
