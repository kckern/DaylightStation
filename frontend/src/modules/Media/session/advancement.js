/**
 * Picks the next queue item to play given the current snapshot.
 * Handles repeat modes (off/one/all), shuffle, and upNext priority.
 *
 * Semantics:
 * - Empty queue → null
 * - repeat='one' AND currentIndex is valid → return current item
 * - Else: prefer an upNext item (any index ≠ currentIndex with priority='upNext')
 * - Else: if shuffle, pick a random non-current item
 *   (repeat='all' → wrap to item 0; otherwise null if only 1 item)
 * - Else (sequential): next idx; if past end → wrap if repeat='all', else null
 *
 * @param {Object} snapshot - The session snapshot
 * @param {Object} snapshot.queue - Queue state {items, currentIndex, upNextCount}
 * @param {Array} snapshot.queue.items - Queue items, each with priority field
 * @param {number} snapshot.queue.currentIndex - Index of the currently playing item
 * @param {Object} snapshot.config - Session config {shuffle, repeat, ...}
 * @param {boolean} snapshot.config.shuffle - Whether shuffle is enabled
 * @param {string} snapshot.config.repeat - Repeat mode: 'off'|'one'|'all'
 * @param {Object} options - Options for testing/determinism
 * @param {Function} options.randomFn - Custom random function (default: Math.random)
 * @returns {Object|null} The next queue item, or null if none
 */
export function pickNextQueueItem(snapshot, { randomFn = Math.random } = {}) {
  const { items, currentIndex } = snapshot.queue;
  if (!items || items.length === 0) return null;

  const { repeat, shuffle } = snapshot.config;

  // If repeat=one and currentIndex is valid, always return current item
  if (repeat === 'one' && currentIndex >= 0 && currentIndex < items.length) {
    return items[currentIndex];
  }

  // Prefer upNext items first (any item with priority='upNext' that isn't current)
  const upNextIdx = items.findIndex((it, i) => i !== currentIndex && it.priority === 'upNext');
  if (upNextIdx !== -1) return items[upNextIdx];

  if (shuffle) {
    // Pick a random non-current item from the queue
    const candidates = items
      .map((item, i) => ({ item, i }))
      .filter(({ i }) => i !== currentIndex);

    if (candidates.length === 0) {
      // Only one item in queue; wrap if repeat=all, else null
      return repeat === 'all' && items.length > 0 ? items[0] : null;
    }

    const pick = candidates[Math.floor(randomFn() * candidates.length)];
    return pick.item;
  }

  // Sequential: advance to next index
  const nextIdx = currentIndex + 1;
  if (nextIdx < items.length) return items[nextIdx];

  // Reached end: wrap if repeat=all, else null
  if (repeat === 'all') return items[0];
  return null;
}

export default pickNextQueueItem;
