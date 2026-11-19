// IndexedDB backing for scoped useApiResource persistence.
//
// One record per request path: { path, value, bytes, at, v }. A reopened page
// restores these into memory before its first render, paints them, and
// revalidates every one against the API — the disk copy is a first frame, not
// a source of truth. Every failure degrades to "nothing cached": no IndexedDB
// (private window, jsdom), a blocked open or a quota error all mean a normal
// network load, never a broken page.
//
// Bounded by count and by bytes, pruned oldest-first on load. `v` retires
// every record at once when a payload shape changes incompatibly: bump
// RECORD_VERSION and old records are ignored and deleted.

const STORE = 'resources';
const META = 'meta';
const DB_VERSION = 1;
export const RECORD_VERSION = 1;

function requestDone(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function transactionDone(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('idb-aborted'));
  });
}

/**
 * @param {string} name IndexedDB database name (one per app surface).
 * @param {{ maxEntries?: number, maxBytes?: number }} [limits]
 * @returns {{ load, put, remove, clear, setOwner }}
 */
export function createIdbResourceStore(name, { maxEntries = 150, maxBytes = 8 * 1024 * 1024 } = {}) {
  let dbPromise = null;
  const open = () => {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      if (typeof indexedDB === 'undefined' || !indexedDB) { reject(new Error('no-indexeddb')); return; }
      const request = indexedDB.open(name, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'path' });
        if (!db.objectStoreNames.contains(META)) db.createObjectStore(META);
      };
      request.onsuccess = () => {
        const db = request.result;
        // Another tab upgrading the schema must not be blocked by this one:
        // close, and reopen on the next use.
        db.onversionchange = () => { db.close(); dbPromise = null; };
        resolve(db);
      };
      request.onerror = () => reject(request.error || new Error('idb-open-failed'));
      // Blocked is not failed: the open completes once the other tab lets go.
      // This load gives up (the caller's timeout), and a later use reopens.
      request.onblocked = () => { dbPromise = null; reject(new Error('idb-blocked')); };
    }).catch(error => { dbPromise = null; throw error; });
    return dbPromise;
  };
  // Writes are fire-and-forget: a lost write costs one cold paint later.
  const write = async (stores, work) => {
    try {
      const db = await open();
      const tx = db.transaction(stores, 'readwrite');
      work(tx);
      await transactionDone(tx);
    } catch { /* degrade to uncached */ }
  };

  // The owner check and mutation share a transaction. A delayed write from an
  // earlier page cannot overwrite (or delete) another person's snapshot.
  function writeForOwner(owner, mutate) {
    return write([STORE, META], tx => {
      const request = tx.objectStore(META).get('owner');
      request.onsuccess = () => {
        if ((request.result ?? null) === owner) mutate(tx.objectStore(STORE));
      };
    });
  }

  return {
    /** `{ owner, entries: [{ path, value }] }` newest first, or null on failure. */
    async load() {
      try {
        const db = await open();
        const tx = db.transaction([STORE, META], 'readwrite');
        const [records, owner] = await Promise.all([
          requestDone(tx.objectStore(STORE).getAll()),
          requestDone(tx.objectStore(META).get('owner')),
        ]);
        const kept = [];
        const dropped = [];
        let bytes = 0;
        for (const record of records.sort((a, b) => b.at - a.at)) {
          const fits = record.v === RECORD_VERSION && kept.length < maxEntries && bytes + (record.bytes || 0) <= maxBytes;
          if (fits) { kept.push(record); bytes += record.bytes || 0; } else dropped.push(record.path);
        }
        for (const path of dropped) tx.objectStore(STORE).delete(path);
        await transactionDone(tx);
        return { owner: owner ?? null, entries: kept.map(({ path, value }) => ({ path, value })) };
      } catch { return null; }
    },
    put(path, value, bytes, owner = null) {
      return writeForOwner(owner, records => records.put({ path, value, bytes, at: Date.now(), v: RECORD_VERSION }));
    },
    remove(path, owner = null) {
      return writeForOwner(owner, records => records.delete(path));
    },
    clear() {
      return write([STORE], tx => tx.objectStore(STORE).clear());
    },
    claimOwner(owner) {
      return write([STORE, META], tx => {
        const meta = tx.objectStore(META);
        const current = meta.get('owner');
        current.onsuccess = () => {
          if (current.result !== owner) tx.objectStore(STORE).clear();
          meta.put(owner, 'owner');
        };
      });
    },
    setOwner(owner) {
      return write([META], tx => tx.objectStore(META).put(owner, 'owner'));
    },
  };
}
