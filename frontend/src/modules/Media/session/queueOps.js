// frontend/src/modules/Media/session/queueOps.js
// Queue operations — pure functions implementing the Plex MP model
// (requirements C3 / technical doc §4.4). Rebuilt from spec.
//
// Two invariants the previous generation violated, now structural:
// 1. "Current" is tracked by ITEM IDENTITY, not index. Every op resolves the
//    current item's id first and recomputes currentIndex afterwards, so
//    reordering around the playing item can never change what's playing.
// 2. The Up Next band is POSITIONAL: the consecutive run of priority='upNext'
//    items immediately after the current item. Items behind the current item
//    are spent regardless of their priority flag; advancement and insertion
//    both reason about the band, never about a global upNext count.

function uid() {
  try {
    if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  } catch { /* ignore */ }
  return `qi-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function toQueueItem(input, { priority = 'queue' } = {}) {
  if (input && input.queueItemId && input.contentId) {
    return { ...input, priority: input.priority ?? priority };
  }
  return {
    queueItemId: uid(),
    contentId: input.contentId,
    title: input.title ?? input.contentId,
    format: input.format ?? null,
    duration: input.duration ?? null,
    thumbnail: input.thumbnail ?? null,
    addedAt: new Date().toISOString(),
    priority,
    // Container-expanded children carry their show/album title for display;
    // only present when set, so plain items keep their exact shape.
    ...(input.containerTitle != null ? { containerTitle: input.containerTitle } : {}),
    // A track played straight from search carries its artist/album so Now
    // Playing can show "<artist> — <album>". Whitelisted like the fields
    // above — omitted when absent so non-music items are unchanged.
    ...(input.artist != null ? { artist: input.artist } : {}),
    ...(input.album != null ? { album: input.album } : {}),
  };
}

function toQueueItems(inputs, opts) {
  return (Array.isArray(inputs) ? inputs : [inputs]).map((i) => toQueueItem(i, opts));
}

function countUpNext(items) {
  return items.filter((i) => i.priority === 'upNext').length;
}

function currentIdOf(snapshot) {
  const { items, currentIndex } = snapshot.queue;
  return currentIndex >= 0 && items[currentIndex] ? items[currentIndex].queueItemId : null;
}

function itemFields(entry) {
  return {
    contentId: entry.contentId,
    format: entry.format,
    title: entry.title,
    duration: entry.duration,
    thumbnail: entry.thumbnail,
    ...(entry.containerTitle != null ? { containerTitle: entry.containerTitle } : {}),
    ...(entry.artist != null ? { artist: entry.artist } : {}),
    ...(entry.album != null ? { album: entry.album } : {}),
  };
}

/**
 * Rebuild the snapshot's queue around an items array and the id of the item
 * that should be current. currentIndex is recomputed from identity;
 * currentItem follows it. `currentId: null` clears the current item.
 */
function withQueue(snapshot, items, currentId) {
  const currentIndex = currentId == null
    ? -1
    : items.findIndex((i) => i.queueItemId === currentId);
  const currentItem = currentIndex >= 0 ? itemFields(items[currentIndex]) : null;
  return {
    ...snapshot,
    queue: { items, currentIndex, upNextCount: countUpNext(items) },
    currentItem,
  };
}

/** Length of the consecutive upNext band immediately after `index`. */
export function upNextBandLength(items, index) {
  let n = 0;
  for (let i = index + 1; i < items.length && items[i].priority === 'upNext'; i += 1) n += 1;
  return n;
}

/**
 * Play Now (§4.4 play-now): the new item REPLACES the current item in place.
 * clearRest=true additionally drops everything else.
 */
export function playNow(snapshot, input, opts) {
  return playNowMany(snapshot, [input], opts);
}

/**
 * Batch Play Now (container expansion): the FIRST item replaces the current
 * item in place and becomes current; the rest follow it immediately, in
 * order. With one input this is exactly `playNow`.
 */
export function playNowMany(snapshot, inputs, { clearRest = false } = {}) {
  const newItems = toQueueItems(inputs);
  if (newItems.length === 0) return snapshot;
  if (clearRest) {
    return withQueue(snapshot, newItems, newItems[0].queueItemId);
  }
  const { items, currentIndex } = snapshot.queue;
  const next = [...items];
  if (currentIndex >= 0) next.splice(currentIndex, 1, ...newItems);
  else next.unshift(...newItems);
  return withQueue(snapshot, next, newItems[0].queueItemId);
}

/**
 * Play Next (J2): insert directly after the current item, AT THE FRONT of
 * the Up Next band — "interrupts the existing up-next ordering". Carries
 * upNext priority so advancement honors it.
 */
export function playNext(snapshot, input) {
  return playNextMany(snapshot, [input]);
}

/**
 * Batch Play Next (container expansion): the whole batch lands at the FRONT
 * of the Up Next band, preserving the batch's internal order.
 */
export function playNextMany(snapshot, inputs) {
  const newItems = toQueueItems(inputs, { priority: 'upNext' });
  if (newItems.length === 0) return snapshot;
  const { items, currentIndex } = snapshot.queue;
  const next = [...items];
  next.splice(currentIndex >= 0 ? currentIndex + 1 : 0, 0, ...newItems);
  return withQueue(snapshot, next, currentIdOf(snapshot));
}

/**
 * Add to Up Next (J2): append to the END of the Up Next band (after current
 * + any existing band members, before the regular queue).
 */
export function addUpNext(snapshot, input) {
  return addUpNextMany(snapshot, [input]);
}

/**
 * Batch Add to Up Next (container expansion): the whole batch appends to the
 * END of the band, preserving the batch's internal order.
 */
export function addUpNextMany(snapshot, inputs) {
  const newItems = toQueueItems(inputs, { priority: 'upNext' });
  if (newItems.length === 0) return snapshot;
  const { items, currentIndex } = snapshot.queue;
  const next = [...items];
  const insertAt = currentIndex >= 0
    ? currentIndex + 1 + upNextBandLength(items, currentIndex)
    : upNextBandLength(items, -1); // no current: band starts at 0
  next.splice(insertAt, 0, ...newItems);
  return withQueue(snapshot, next, currentIdOf(snapshot));
}

/** Add to Queue: append to the end. First-into-empty becomes current. */
export function add(snapshot, input) {
  return addMany(snapshot, [input]);
}

/** Batch Add to Queue: append in order. First-into-empty becomes current. */
export function addMany(snapshot, inputs) {
  const newItems = toQueueItems(inputs);
  if (newItems.length === 0) return snapshot;
  const items = [...snapshot.queue.items, ...newItems];
  const currentId = currentIdOf(snapshot)
    ?? (snapshot.queue.items.length === 0 ? newItems[0].queueItemId : null);
  return withQueue(snapshot, items, currentId);
}

/** Clear the queue. The current item keeps playing (it leaves the queue). */
export function clear(snapshot) {
  return {
    ...snapshot,
    queue: { items: [], currentIndex: -1, upNextCount: 0 },
    // currentItem intentionally preserved: clearing upcoming items does not
    // stop playback (C3.4).
  };
}

/**
 * Remove an item. Removing the CURRENT item promotes the item that followed
 * it (the caller decides whether to load/play it); removing the last
 * remaining current item clears currentItem.
 */
export function remove(snapshot, queueItemId) {
  const { items } = snapshot.queue;
  const idx = items.findIndex((i) => i.queueItemId === queueItemId);
  if (idx === -1) return snapshot;
  const next = items.filter((_, i) => i !== idx);
  const currentId = currentIdOf(snapshot);
  if (queueItemId !== currentId) {
    return withQueue(snapshot, next, currentId);
  }
  // Removed the current item: the successor (same index in the new array)
  // becomes current; nothing left → no current.
  const successor = next.length > 0 ? next[Math.min(idx, next.length - 1)] : null;
  const result = withQueue(snapshot, next, successor?.queueItemId ?? null);
  // Position belongs to the removed item, not its successor.
  return { ...result, position: 0 };
}

/** Jump to a specific item. */
export function jump(snapshot, queueItemId) {
  const { items } = snapshot.queue;
  const idx = items.findIndex((i) => i.queueItemId === queueItemId);
  if (idx === -1) return snapshot;
  return withQueue(snapshot, items, queueItemId);
}

/**
 * Reorder: {from, to} moves one item; {items} replaces the ordering by id
 * list — ids missing from the list keep their relative order at the END
 * (never silently dropped, §4.4 "replace ordering"). The current item is
 * identity-stable across both paths.
 */
export function reorder(snapshot, input) {
  const { items } = snapshot.queue;
  const currentId = currentIdOf(snapshot);

  if (Array.isArray(input?.items)) {
    const byId = new Map(items.map((i) => [i.queueItemId, i]));
    const listed = input.items.map((id) => byId.get(id)).filter(Boolean);
    const listedIds = new Set(input.items);
    const unlisted = items.filter((i) => !listedIds.has(i.queueItemId));
    return withQueue(snapshot, [...listed, ...unlisted], currentId);
  }

  const next = [...items];
  const fromIdx = next.findIndex((i) => i.queueItemId === input.from);
  const toIdx = next.findIndex((i) => i.queueItemId === input.to);
  if (fromIdx === -1 || toIdx === -1) return snapshot;
  const [moved] = next.splice(fromIdx, 1);
  next.splice(toIdx, 0, moved);
  return withQueue(snapshot, next, currentId);
}

/**
 * Demote a spent Up Next item to regular priority once playback moves past
 * it — the band is consumable, not a permanent attribute.
 */
export function demote(snapshot, queueItemId) {
  const { items } = snapshot.queue;
  const idx = items.findIndex((i) => i.queueItemId === queueItemId);
  if (idx === -1 || items[idx].priority !== 'upNext') return snapshot;
  const next = [...items];
  next[idx] = { ...next[idx], priority: 'queue' };
  return withQueue(snapshot, next, currentIdOf(snapshot));
}
