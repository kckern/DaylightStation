// frontend/src/modules/Media/session/sessionStore.js
// The snapshot holder. Lives outside React; React binds via
// useSyncExternalStore. Side effects (persistence, recents, logging) attach
// as transition listeners instead of being inlined into mutation paths.
import { reduce } from './sessionReducer.js';

export function createSessionStore(initialSnapshot) {
  let snapshot = initialSnapshot;
  const subscribers = new Set();
  const transitionListeners = new Set();

  function commit(prev, next, action) {
    snapshot = next;
    for (const fn of transitionListeners) fn(prev, next, action);
    for (const fn of subscribers) fn(next);
    return next;
  }

  return {
    getSnapshot: () => snapshot,

    subscribe(fn) {
      subscribers.add(fn);
      return () => subscribers.delete(fn);
    },

    /** Side-effect seam: fn(prev, next, action) on every committed change. */
    onTransition(fn) {
      transitionListeners.add(fn);
      return () => transitionListeners.delete(fn);
    },

    /** Run an action through the pure reducer. No-op if state is unchanged. */
    dispatch(action) {
      const prev = snapshot;
      const next = reduce(prev, action);
      if (next === prev) return prev;
      return commit(prev, next, action);
    },

    /** Replace with a pre-built snapshot (queue ops build full snapshots). */
    replace(next, action = { type: 'REPLACE_SNAPSHOT' }) {
      const prev = snapshot;
      if (next === prev) return prev;
      return commit(prev, next, action);
    },
  };
}

export default createSessionStore;
