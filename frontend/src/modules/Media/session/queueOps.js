/**
 * Queue operations for Media App sessions.
 * Pure functions that transform queue state immutably.
 * All ops: (snapshot, input, opts?) => newSnapshot
 */

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
  };
}

function countUpNext(items) {
  return items.filter(i => i.priority === 'upNext').length;
}

function withQueue(snapshot, queue) {
  const currentItem = queue.currentIndex >= 0 && queue.items[queue.currentIndex]
    ? {
        contentId: queue.items[queue.currentIndex].contentId,
        format: queue.items[queue.currentIndex].format,
        title: queue.items[queue.currentIndex].title,
        duration: queue.items[queue.currentIndex].duration,
        thumbnail: queue.items[queue.currentIndex].thumbnail,
      }
    : snapshot.currentItem;
  return { ...snapshot, queue, currentItem };
}

/**
 * Play item immediately, optionally clearing remaining queue.
 * @param snapshot
 * @param input {contentId, title?, format?, duration?, thumbnail?}
 * @param opts {clearRest?}
 */
export function playNow(snapshot, input, { clearRest = false } = {}) {
  const newItem = toQueueItem(input);
  if (clearRest) {
    return withQueue(snapshot, {
      items: [newItem],
      currentIndex: 0,
      upNextCount: countUpNext([newItem]),
    });
  }
  const items = [newItem, ...snapshot.queue.items];
  return withQueue(snapshot, {
    items,
    currentIndex: 0,
    upNextCount: countUpNext(items),
  });
}

/**
 * Insert item immediately after current, keep current playing.
 * @param snapshot
 * @param input
 */
export function playNext(snapshot, input) {
  const newItem = toQueueItem(input);
  const items = [...snapshot.queue.items];
  const after = Math.max(0, snapshot.queue.currentIndex) + 1;
  items.splice(after, 0, newItem);
  return withQueue(snapshot, {
    items,
    currentIndex: snapshot.queue.currentIndex,
    upNextCount: countUpNext(items),
  });
}

/**
 * Add to Up Next sub-queue (after current item, before remaining queue).
 * @param snapshot
 * @param input
 */
export function addUpNext(snapshot, input) {
  const newItem = toQueueItem(input, { priority: 'upNext' });
  const items = [...snapshot.queue.items];

  // Insert after current item + existing upNext items
  const current = snapshot.queue.currentIndex;
  let targetIdx;

  if (current >= 0 && current < items.length) {
    // Current item exists: insert after it + all existing upNext items
    targetIdx = current + 1 + snapshot.queue.upNextCount;
  } else {
    // No current: insert at beginning
    targetIdx = 0;
  }

  items.splice(targetIdx, 0, newItem);
  const newCurrentIndex = snapshot.queue.currentIndex;

  return withQueue(snapshot, {
    items,
    currentIndex: newCurrentIndex,
    upNextCount: countUpNext(items),
  });
}

/**
 * Append to end of queue.
 * @param snapshot
 * @param input
 */
export function add(snapshot, input) {
  const newItem = toQueueItem(input);
  const items = [...snapshot.queue.items, newItem];
  const currentIndex = snapshot.queue.currentIndex === -1 && items.length === 1
    ? 0
    : snapshot.queue.currentIndex;
  return withQueue(snapshot, {
    items,
    currentIndex,
    upNextCount: countUpNext(items),
  });
}

/**
 * Empty queue and reset currentIndex.
 * @param snapshot
 */
export function clear(snapshot) {
  return withQueue(snapshot, {
    items: [],
    currentIndex: -1,
    upNextCount: 0,
  });
}

/**
 * Remove item by queueItemId, adjust currentIndex.
 * @param snapshot
 * @param queueItemId
 */
export function remove(snapshot, queueItemId) {
  const idx = snapshot.queue.items.findIndex(i => i.queueItemId === queueItemId);
  if (idx === -1) return snapshot;
  const items = snapshot.queue.items.filter((_, i) => i !== idx);
  let currentIndex = snapshot.queue.currentIndex;
  if (idx < currentIndex) {
    currentIndex -= 1;
  } else if (idx === currentIndex) {
    currentIndex = items.length > 0 ? Math.min(currentIndex, items.length - 1) : -1;
  }
  return withQueue(snapshot, {
    items,
    currentIndex,
    upNextCount: countUpNext(items),
  });
}

/**
 * Jump to item by queueItemId.
 * @param snapshot
 * @param queueItemId
 */
export function jump(snapshot, queueItemId) {
  const idx = snapshot.queue.items.findIndex(i => i.queueItemId === queueItemId);
  if (idx === -1) return snapshot;
  return withQueue(snapshot, {
    items: snapshot.queue.items,
    currentIndex: idx,
    upNextCount: snapshot.queue.upNextCount,
  });
}

/**
 * Reorder queue. Accepts {from, to} (swap) or {items} (full reorder by ID list).
 * @param snapshot
 * @param input {from, to} | {items}
 */
export function reorder(snapshot, input) {
  const items = [...snapshot.queue.items];
  if (Array.isArray(input?.items)) {
    const byId = new Map(items.map(i => [i.queueItemId, i]));
    const reordered = input.items.map(id => byId.get(id)).filter(Boolean);
    return withQueue(snapshot, {
      items: reordered,
      currentIndex: snapshot.queue.currentIndex,
      upNextCount: countUpNext(reordered),
    });
  }
  const fromIdx = items.findIndex(i => i.queueItemId === input.from);
  const toIdx = items.findIndex(i => i.queueItemId === input.to);
  if (fromIdx === -1 || toIdx === -1) return snapshot;
  const [moved] = items.splice(fromIdx, 1);
  items.splice(toIdx, 0, moved);
  return withQueue(snapshot, {
    items,
    currentIndex: snapshot.queue.currentIndex,
    upNextCount: countUpNext(items),
  });
}
