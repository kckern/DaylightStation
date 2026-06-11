// frontend/src/modules/Media/session/advancement.js
// Picks the next queue item. Rebuilt from spec (C3.3, J2):
//
// - `reason` distinguishes natural end from explicit user skip. repeat='one'
//   repeats the item ONLY on natural advancement — an explicit skip is user
//   navigation and moves on (the previous generation trapped Skip forever).
// - The Up Next band is POSITIONAL: only the consecutive upNext run directly
//   AFTER the current index counts. Spent band members behind the cursor are
//   never revisited, so repeat='off' terminates (the previous generation
//   looped two upNext items infinitely).
// - Shuffle with repeat='off' draws only from items ahead of the cursor so
//   a shuffled session also ends; repeat='all' draws from everything.

export function pickNextQueueItem(snapshot, { reason = 'item-ended', randomFn = Math.random } = {}) {
  const { items, currentIndex } = snapshot.queue;
  if (!items || items.length === 0) return null;

  const { repeat, shuffle } = snapshot.config;
  const isExplicitSkip = reason === 'skip-next';

  // repeat=one governs natural end-of-item advancement only.
  if (repeat === 'one' && !isExplicitSkip && currentIndex >= 0 && currentIndex < items.length) {
    return items[currentIndex];
  }

  // Up Next band: the item directly after current, if it carries upNext.
  const bandHead = items[currentIndex + 1];
  if (bandHead && bandHead.priority === 'upNext') return bandHead;

  if (shuffle) {
    const pool = items
      .map((item, i) => ({ item, i }))
      .filter(({ i }) => (repeat === 'all' ? i !== currentIndex : i > currentIndex));
    if (pool.length === 0) {
      return repeat === 'all' && items.length > 0 ? items[0] : null;
    }
    return pool[Math.floor(randomFn() * pool.length)].item;
  }

  const nextIdx = currentIndex + 1;
  if (nextIdx < items.length) return items[nextIdx];
  if (repeat === 'all') return items[0];
  return null;
}

export default pickNextQueueItem;
