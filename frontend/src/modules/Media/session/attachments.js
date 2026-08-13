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

/**
 * A load that never finishes must stop describing itself as a normal start.
 * After STARTUP_SLOW_MS in 'loading' the session moves to 'stalled', which
 * every surface already renders as "Having trouble streaming — hang on".
 *
 * Deliberately does NOT auto-advance: the mid-playback stall contract (C9.3,
 * onPlayerStalled) skips to the next item because the current one is proven
 * broken, but a slow START usually means a busy server. Skipping the episode
 * the user just picked would be the wrong cure — on 2026-08-12 a Plex
 * transcode decision blocked 54s and then played fine.
 */
export function attachSlowStartWatchdog(store, {
  timing = TIMING,
  setTimeoutFn = setTimeout,
  clearTimeoutFn = clearTimeout,
} = {}) {
  let timer = null;
  let startedAt = null;
  const clear = () => {
    if (timer) { clearTimeoutFn(timer); timer = null; }
    startedAt = null;
  };

  const detach = store.onTransition((prev, next) => {
    if (next.state === prev.state) return;
    clear();
    if (next.state !== 'loading') return;
    startedAt = Date.now();
    timer = setTimeoutFn(() => {
      const waitedMs = startedAt ? Date.now() - startedAt : timing.STARTUP_SLOW_MS;
      timer = null;
      startedAt = null;
      const snapshot = store.getSnapshot();
      if (snapshot.state !== 'loading') return;
      mediaLog.playbackStalled({
        sessionId: snapshot.sessionId,
        contentId: snapshot.currentItem?.contentId ?? null,
        phase: 'startup',
        waitedMs,
      });
      store.dispatch({ type: 'PLAYER_STATE', playerState: 'stalled' });
    }, timing.STARTUP_SLOW_MS);
  });

  return () => { detach(); clear(); };
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
