import { offlineStorageUser } from './feedOfflineStore.js';

const CACHE_PREFIX = 'feed:annotation-cache:';
const QUEUE_PREFIX = 'feed:annotation-queue:';
const MAX_CACHED = 250;
const MAX_QUEUED = 500;
let flushPromise = null;

function read(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key) || 'null') ?? fallback; }
  catch { return fallback; }
}

function write(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

function cacheKey() { return `${CACHE_PREFIX}${offlineStorageUser()}`; }
function queueKey() { return `${QUEUE_PREFIX}${offlineStorageUser()}`; }

export function cachedAnnotations(itemId) {
  return read(cacheKey(), []).filter(annotation => annotation.itemId === itemId);
}

export function cacheAnnotations(itemId, annotations) {
  const others = read(cacheKey(), []).filter(annotation => annotation.itemId !== itemId);
  const next = [...others, ...(annotations || [])]
    .sort((a, b) => new Date(b.updatedAt || b.createdAt || 0) - new Date(a.updatedAt || a.createdAt || 0))
    .slice(0, MAX_CACHED);
  write(cacheKey(), next);
  return annotations || [];
}

export function queueAnnotationMutation(operation) {
  const queue = read(queueKey(), []);
  const next = [...queue, operation].slice(-MAX_QUEUED);
  write(queueKey(), next);
  return next.length;
}

export function queuedAnnotationCount() {
  return read(queueKey(), []).length;
}

export async function flushAnnotationMutations(send) {
  if (flushPromise) return flushPromise;
  flushPromise = (async () => {
    let queue = read(queueKey(), []);
    let completed = 0;
    for (const operation of [...queue]) {
      try {
        await send(operation.path, operation.data || {}, operation.method);
        queue = queue.filter(value => value.queueId !== operation.queueId);
        write(queueKey(), queue);
        completed += 1;
      } catch {
        break;
      }
    }
    return completed;
  })();
  try { return await flushPromise; }
  finally { flushPromise = null; }
}

export function offlineAnnotationId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `offline-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}
