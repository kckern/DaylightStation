import { getToken } from '../../../../../frontend/src/lib/auth.js';
import { createIndexedDbOpener, requestResult, transactionDone } from '../../../../../frontend/src/lib/indexedDb.js';

const DB_NAME = 'daylight-feed-offline-v1';
const STORE = 'editions';
const MAX_EDITIONS = 100;
const openDb = createIndexedDbOpener(DB_NAME, 1, db => {
  if (!db.objectStoreNames.contains(STORE)) {
    const store = db.createObjectStore(STORE, { keyPath: 'key' });
    store.createIndex('user', 'user', { unique: false });
    store.createIndex('savedAt', 'savedAt', { unique: false });
  }
}, { waitWhileBlocked: true });

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

async function objectStore(mode) {
  const db = await openDb();
  return db.transaction(STORE, mode).objectStore(STORE);
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
  const transaction = (await openDb()).transaction(STORE, 'readwrite');
  const store = transaction.objectStore(STORE);
  store.put(row);
  const request = store.index('user').getAll(user);
  request.onsuccess = () => {
    // Queue deletes while the native transaction is active.
    for (const edition of newestFirst(request.result).slice(MAX_EDITIONS)) {
      store.delete(edition.key);
    }
  };
  await transactionDone(transaction);
  return row;
}

export async function removeOfflineEdition(id) {
  const user = userScope();
  const transaction = (await openDb()).transaction(STORE, 'readwrite');
  transaction.objectStore(STORE).delete(editionKey(user, id));
  await transactionDone(transaction);
}

export function offlineStorageUser() {
  return userScope();
}

// A blocked identity read cannot establish whose offline changes would be stored.
export function feedQueueOwner() {
  try { return offlineStorageUser(); }
  catch { return null; }
}
