// frontend/src/modules/Media/session/attachments.js
// Side effects that ride along with session-store transitions. Each is an
// independent listener with one job; the store and controller know nothing
// about them. All return a detach function.
import { TIMING } from '../constants.js';
import mediaLog from '../logging/mediaLog.js';
import { recordRecent } from './recents.js';

/**
 * Persist every transition, throttled to ≤1 write per PERSIST_THROTTLE_MS
 * (§11.3): leading write immediately, trailing write for changes that land
 * inside the window.
 */
export function attachPersistence(store, { write, timing = TIMING, setTimeoutFn = setTimeout, clearTimeoutFn = clearTimeout, nowFn = () => Date.now() } = {}) {
  let lastWriteAt = -Infinity;
  let trailing = null;

  const doWrite = (snapshot) => {
    lastWriteAt = nowFn();
    const result = write(snapshot, { wasPlayingOnUnload: snapshot.state === 'playing' });
    if (result?.truncated) {
      mediaLog.sessionPersisted({ sessionId: snapshot.sessionId, truncated: true });
    }
    return result;
  };

  // Lifecycle boundaries must hit disk immediately — a reset that only
  // persists 500ms later loses to a fast tab close or test assertion.
  const FLUSH_ACTIONS = new Set(['RESET', 'ADOPT_SNAPSHOT']);

  const detachTransition = store.onTransition((prev, next, action) => {
    const since = nowFn() - lastWriteAt;
    if (FLUSH_ACTIONS.has(action?.type) || since >= timing.PERSIST_THROTTLE_MS) {
      if (trailing) { clearTimeoutFn(trailing); trailing = null; }
      doWrite(next);
      return;
    }
    if (!trailing) {
      trailing = setTimeoutFn(() => {
        trailing = null;
        doWrite(store.getSnapshot());
      }, timing.PERSIST_THROTTLE_MS - since);
    }
  });

  return () => {
    detachTransition();
    if (trailing) { clearTimeoutFn(trailing); trailing = null; }
  };
}

/** Record a recent on transition into 'playing' or when a new item loads. */
export function attachRecents(store, { record = recordRecent } = {}) {
  return store.onTransition((prev, next) => {
    const itemChanged = next.currentItem?.contentId !== prev.currentItem?.contentId;
    const nowPlaying = next.state === 'playing' && prev.state !== 'playing';
    if ((nowPlaying || (itemChanged && next.currentItem)) && next.currentItem) {
      record({
        contentId: next.currentItem.contentId,
        title: next.currentItem.title,
        thumbnail: next.currentItem.thumbnail,
        format: next.currentItem.format,
      });
    }
  });
}

/** Structured log events derived from transitions (taxonomy §10.1). */
export function attachLogging(store) {
  return store.onTransition((prev, next) => {
    if (next.state !== prev.state) {
      mediaLog.sessionStateChange({
        sessionId: next.sessionId,
        prevState: prev.state,
        nextState: next.state,
      });
      if (next.state === 'playing' && prev.state !== 'playing') {
        mediaLog.playbackStarted({
          sessionId: next.sessionId,
          contentId: next.currentItem?.contentId,
        });
      }
    }
  });
}
