import { createBrowserMutationQueue } from '../../../../../frontend/src/lib/browserMutationQueue.js';
import { feedQueueOwner as annotationOwner } from './feedOfflineStore.js';

export { annotationOwner };

const CACHE_PREFIX = 'feed:annotation-cache:';
const QUEUE_PREFIX = 'feed:annotation-queue:';
const MAX_CACHED = 250;
const mutations = createBrowserMutationQueue({
  prefix: QUEUE_PREFIX,
  getOwner: annotationOwner,
  idOf: row => row.queueId,
});

function readList(key) {
  const raw = localStorage.getItem(key);
  const value = raw === null ? [] : JSON.parse(raw);
  if (!Array.isArray(value)) throw new Error('Invalid annotation storage.');
  return value;
}

export function cachedAnnotations(itemId, owner = annotationOwner()) {
  if (!owner || owner !== annotationOwner()) return [];
  try { return readList(CACHE_PREFIX + owner).filter(note => note?.itemId === itemId); }
  catch { return []; }
}

export function cacheAnnotations(itemId, annotations, owner = annotationOwner()) {
  if (!owner || owner !== annotationOwner()) return;
  try {
    const key = CACHE_PREFIX + owner;
    const others = readList(key).filter(note => note && note.itemId !== itemId);
    const next = [...others, ...(annotations || [])]
      .sort((a, b) => new Date(b.updatedAt || b.createdAt || 0) - new Date(a.updatedAt || a.createdAt || 0))
      .slice(0, MAX_CACHED);
    localStorage.setItem(key, JSON.stringify(next));
  } catch { /* A cache miss does not invalidate a server response. */ }
}

export function queueAnnotationMutation(operation, owner = annotationOwner()) {
  return mutations.enqueue(owner, operation).length;
}

export function queuedAnnotationCount() {
  return mutations.snapshot().length;
}

export function flushAnnotationMutations(send) {
  return mutations.flush(annotationOwner(), operation => send(operation.path, operation.data || {}, operation.method));
}

export function offlineAnnotationId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `offline-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}
