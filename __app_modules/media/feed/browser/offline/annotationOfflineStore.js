import { subscribeToStorageKey } from '../../../../../frontend/src/lib/browserPreference.js';
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

function updateCache(owner, update) {
  if (!owner || owner !== annotationOwner()) return;
  try {
    const key = CACHE_PREFIX + owner;
    const next = update(readList(key))
      .sort((a, b) => new Date(b.updatedAt || b.createdAt || 0) - new Date(a.updatedAt || a.createdAt || 0))
      .slice(0, MAX_CACHED);
    localStorage.setItem(key, JSON.stringify(next));
  } catch { /* A cache miss does not invalidate a server response. */ }
}

export function cacheAnnotations(itemId, annotations, owner = annotationOwner()) {
  updateCache(owner, notes => [...notes.filter(note => note && note.itemId !== itemId), ...(annotations || [])]);
}

export function annotationPath(id) {
  const base = '/api/v1/feed/annotations';
  return id == null ? base : base + '/' + encodeURIComponent(id);
}

export function upsertAnnotation(notes, annotation) {
  if (!notes.some(note => note.id === annotation.id)) return [...notes, annotation];
  return notes.map(note => note.id === annotation.id ? annotation : note);
}

function removeAnnotation(notes, path) {
  return notes.filter(note => annotationPath(note.id) !== path);
}

export function annotationsWithPending(itemId, notes, operations) {
  let visible = notes;
  for (const operation of operations) {
    if (!operation || (operation.itemId && operation.itemId !== itemId)) continue;
    const { method, path, data, createdAt } = operation;
    if (method === 'DELETE') {
      visible = removeAnnotation(visible, path);
    } else if (method === 'POST' && data?.id && data.itemId === itemId) {
      visible = upsertAnnotation(visible, { ...data, createdAt, updatedAt: createdAt, syncStatus: 'pending' });
    } else if (method === 'PATCH') {
      // Older queue entries identify the note only by its request path.
      const original = visible.find(note => annotationPath(note.id) === path);
      const id = original?.id ?? operation.annotationId;
      if (id) visible = upsertAnnotation(visible, { ...original, ...data, id, itemId, updatedAt: createdAt, syncStatus: 'pending' });
    }
  }
  return visible;
}

export function queueAnnotationMutation(operation, owner = annotationOwner()) {
  return mutations.enqueue(owner, operation).length;
}

export function queueAnnotationChange(owner, itemId, method, annotationId, data) {
  return mutations.enqueue(owner, {
    queueId: offlineAnnotationId(),
    itemId,
    annotationId,
    method,
    path: annotationPath(method === 'POST' ? null : annotationId),
    data,
    createdAt: new Date().toISOString(),
  });
}

export function hasPendingAnnotationWrite(id, owner) {
  return mutations.snapshot(owner).some(operation =>
    operation?.path === annotationPath(id) || operation?.data?.id === id
  );
}

export function subscribeToAnnotationQueue(owner, listener) {
  return subscribeToStorageKey(QUEUE_PREFIX + owner, () => {
    if (owner && owner === annotationOwner()) listener(mutations.snapshot(owner));
  });
}

export function queuedAnnotationMutations(owner = annotationOwner()) {
  return mutations.snapshot(owner);
}

export function queuedAnnotationCount() {
  return queuedAnnotationMutations().length;
}

export function flushAnnotationMutations(send, onDequeue) {
  const owner = annotationOwner();
  return mutations.flush(owner, async operation => {
    const result = await send(operation.path, operation.data || {}, operation.method);
    const note = result?.annotation;
    return note?.id && note.itemId ? note : null;
  }, {
    onDequeue(remaining, operation, annotation) {
      let change;
      if (operation.method === 'DELETE') {
        change = { itemId: operation.itemId, update: notes => removeAnnotation(notes, operation.path) };
      } else if (annotation) {
        change = { itemId: annotation.itemId, update: notes => upsertAnnotation(notes, annotation) };
      }
      if (change) updateCache(owner, change.update);
      onDequeue?.(remaining, change);
    },
  });
}

export function offlineAnnotationId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `offline-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}
