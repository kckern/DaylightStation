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

import { createIndexedDbOpener, requestResult, transactionDone } from '../indexedDb.js';

const STORE = 'resources';
const META = 'meta';
const DB_VERSION = 1;
export const RECORD_VERSION = 1;

/**
 * @param {string} name IndexedDB database name (one per app surface).
 * @param {{ maxEntries?: number, maxBytes?: number }} [limits]
 * @returns {{ load, put, remove, clear, setOwner }}
 */
export function createIdbResourceStore(name, { maxEntries = 150, maxBytes = 8 * 1024 * 1024 } = {}) {
  const open = createIndexedDbOpener(name, DB_VERSION, db => {
    if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'path' });
    if (!db.objectStoreNames.contains(META)) db.createObjectStore(META);
  });
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
          requestResult(tx.objectStore(STORE).getAll()),
          requestResult(tx.objectStore(META).get('owner')),
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
