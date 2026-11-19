import { getToken } from '../../../../../frontend/src/lib/auth.js';

const DB_NAME = 'daylight-feed-offline-v1';
const STORE = 'editions';
const MAX_EDITIONS = 100;
let dbPromise = null;

function userScope() {
  const token = getToken();
  if (!token) return 'household';
  try {
    const encoded = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    const payload = JSON.parse(atob(encoded.padEnd(Math.ceil(encoded.length / 4) * 4, '=')));
    return String(payload.sub || payload.username || 'household').slice(0, 128);
  } catch {
    return 'household';
  }
}

function openDb() {
  if (dbPromise) return dbPromise;
  if (!globalThis.indexedDB) return Promise.reject(new Error('Offline storage unavailable'));
  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: 'key' });
        store.createIndex('user', 'user', { unique: false });
        store.createIndex('savedAt', 'savedAt', { unique: false });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => { dbPromise = null; reject(request.error); };
  });
  return dbPromise;
}

async function objectStore(mode) {
  const db = await openDb();
  return db.transaction(STORE, mode).objectStore(STORE);
}

function requestResult(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function editionKey(user, id) {
  return `${user}:${id}`;
}

function newestFirst(rows = []) {
  return rows.sort((a, b) => b.savedAt - a.savedAt);
}

export async function getOfflineEdition(id) {
  const user = userScope();
  const store = await objectStore('readonly');
  return requestResult(store.get(editionKey(user, id)));
}

export async function listOfflineEditions() {
  const user = userScope();
  const store = await objectStore('readonly');
  return newestFirst(await requestResult(store.index('user').getAll(user)));
}

export async function saveOfflineEdition(item, detail = null) {
  if (!item?.id) throw new Error('Feed item id required');
  const user = userScope();
  const row = { key: editionKey(user, item.id), user, item, detail, savedAt: Date.now() };
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE, 'readwrite');
    transaction.oncomplete = () => resolve(row);
    transaction.onabort = () => reject(transaction.error ?? new Error('Offline edition save aborted'));

    const store = transaction.objectStore(STORE);
    const editions = store.index('user');
    store.put(row);
    const request = editions.getAll(user);
    request.onsuccess = () => {
      // Queue deletes while the native transaction is active.
      for (const edition of newestFirst(request.result).slice(MAX_EDITIONS)) {
        store.delete(edition.key);
      }
    };
  });
}

export async function removeOfflineEdition(id) {
  const user = userScope();
  const store = await objectStore('readwrite');
  await requestResult(store.delete(editionKey(user, id)));
}

export function offlineStorageUser() {
  return userScope();
}

// A blocked identity read cannot establish whose offline changes would be stored.
export function feedQueueOwner() {
  try { return offlineStorageUser(); }
  catch { return null; }
}
