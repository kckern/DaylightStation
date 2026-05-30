/**
 * Pure transition detector for challenge toasts. Given the prior tracker state and the
 * current governance challenge snapshot, decide whether to emit a 'start' or 'end' toast.
 *
 * Rules:
 * - 'start' fires the first time a given challenge id is seen with status 'pending'.
 * - 'end' fires the first time that id is seen with status 'success'.
 * - A challenge first seen already in 'success' (never observed pending) emits only 'end'
 *   — a single toast for the instant-satisfaction case.
 * - 'failed' and null snapshots emit nothing.
 * - Each event fires at most once per challenge id (de-dup across the engine's many ticks).
 *
 * Pure: never mutates the input tracker; returns the next tracker to store.
 */

// The id Sets grow for the life of a session. A session has at most tens of challenges,
// so this is intentionally left unbounded — the simplicity is worth more than reclaiming
// a handful of strings.
export function createChallengeToastTracker() {
  return { startedIds: new Set(), endedIds: new Set() };
}

export function nextChallengeToast(tracker, challenge) {
  const t = tracker || createChallengeToastTracker();
  const id = challenge && challenge.id;
  if (!id) return { event: null, tracker: t };

  const { status } = challenge;

  if (status === 'pending' && !t.startedIds.has(id)) {
    const startedIds = new Set(t.startedIds);
    startedIds.add(id);
    return { event: 'start', tracker: { startedIds, endedIds: t.endedIds } };
  }

  if (status === 'success' && !t.endedIds.has(id)) {
    const startedIds = new Set(t.startedIds);
    startedIds.add(id); // mark started too, so a stray later 'pending' can't re-fire start
    const endedIds = new Set(t.endedIds);
    endedIds.add(id);
    return { event: 'end', tracker: { startedIds, endedIds } };
  }

  return { event: null, tracker: t };
}

export default nextChallengeToast;
