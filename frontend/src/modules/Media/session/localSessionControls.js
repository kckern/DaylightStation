// frontend/src/modules/Media/session/localSessionControls.js
// Screen session controls for THIS device's Media session (P1, tech doc §6.6
// and §9.14): the sleep timer (RQ-STEER-12), the end-of-queue choice and
// "keep similar things playing" (RQ-STEER-19), the next-episode countdown and
// "Stop after this one" (RQ-STEER-20).
//
// It is the SAME rule set a screen runs
// (screen-framework/session/screenSessionControls.js) and the same similar
// resolver (continuationResolver.js), bound to the local session through
// ports: the O2 similar rule (parent siblings, no `library:` fallback, season
// -> show, 7-day preference, <=5 per batch, a container cycled once, 4
// unattended batches), the 10-second countdown, and the published `controls`
// block. The ports differ, so behaviour is not identical to a screen's.
//
// Local differences, stated:
//   - A sleep timer PAUSES here (item and spot kept), so "continue from where
//     it stopped" is ordinary Play; "where the timer was set" is resumeSleep.
//     A screen's timer STOPS playback instead.
//   - The fade rides on the element volume. iOS Safari makes media volume
//     read-only, so there the fade is a no-op and the timer simply pauses.
//   - An armed minutes timer is saved with its absolute deadline and re-armed
//     (or, if it came due while the page was closed, turned into the continue
//     offer) on the next load.
//   - Add only and screen notes / Put it back belong to a screen other
//     devices play to; this session reports them as unsupported (Add only is
//     shown unavailable with the reason, never hidden).
//
// The facade mirrors `controller.sessionControls` on a remote screen
// (peek/RemoteSessionController.js): every method returns a Promise of
// `{ ok, code? }`, and `getState()` returns the §9.14 block.
import { createScreenSessionControls } from '../../../screen-framework/session/screenSessionControls.js';
import { createContinuationResolver } from '../../../screen-framework/session/continuationResolver.js';
import mediaLog from '../logging/mediaLog.js';

export const LOCAL_CONTROLS_STORAGE_PREFIX = 'media-app.session-controls.v1:';

const UNSUPPORTED = Object.freeze({
  addOnly: 'Add only is for a screen other devices play to',
  putBack: 'Put it back is offered on the screen that was changed',
});

function safeStorage(storage) {
  return {
    read(key) {
      try { const raw = storage?.getItem?.(key); return raw ? JSON.parse(raw) : null; } catch { return null; }
    },
    write(key, value) {
      try { storage?.setItem?.(key, JSON.stringify(value)); } catch { /* private mode / quota */ }
    },
  };
}

function defaultStorage() {
  try { return globalThis.localStorage ?? null; } catch { return null; }
}

/** Queue-API / search items → local queue inputs (whitelisted by queueOps). */
export function continuationToQueueInput(item) {
  const contentId = item?.contentId ?? item?.id ?? null;
  if (typeof contentId !== 'string' || !contentId) return null;
  const mediaType = item.mediaType ?? item.format ?? null;
  const type = item.type ?? item.metadata?.type ?? null;
  return {
    contentId,
    title: item.title ?? item.label ?? contentId,
    thumbnail: item.thumbnail ?? item.image ?? null,
    duration: Number.isFinite(item.duration) ? item.duration : null,
    format: ['video', 'audio', 'dash_video', 'hls_video'].includes(mediaType)
      ? mediaType
      : (type === 'episode' || type === 'movie' ? 'video' : (type === 'track' ? 'audio' : null)),
    ...(type === 'episode' ? { type: 'episode' } : {}),
    ...(item.grandparentTitle || item.parentTitle
      ? { containerTitle: item.grandparentTitle ?? item.parentTitle }
      : {}),
    addedBy: 'auto-continue',
  };
}

/**
 * @param {object} opts
 * @param {string} opts.ownerId        `browser:<clientId>`
 * @param {object} opts.ports          { getSnapshot, pause, setFade, restoreSnapshot, addBatch }
 * @param {Function} [opts.resolveContinuation]
 * @param {Storage|null} [opts.storage]
 * @param {Function} [opts.now]
 * @param {number} [opts.countdownSeconds]
 */
export function createLocalSessionControls({
  ownerId,
  ports,
  resolveContinuation = null,
  storage = defaultStorage(),
  now = () => Date.now(),
  countdownSeconds,
} = {}) {
  const store = safeStorage(storage);
  const storageKey = `${LOCAL_CONTROLS_STORAGE_PREFIX}${ownerId}`;
  const resolver = resolveContinuation ?? createContinuationResolver({ ownerId });
  // Set while a sleep stop is offered and cleared when a person plays on by
  // any route — the "continue from where the timer was set" offer is for
  // the moment after the timer, not forever.
  let resumeDismissed = false;

  const machine = createScreenSessionControls({
    ownerId,
    now,
    ...(Number.isFinite(countdownSeconds) ? { countdownSeconds } : {}),
    ports: {
      getSnapshot: () => ports.getSnapshot(),
      stopPlayback: () => ports.pause(),
      setFade: (value) => ports.setFade(value),
      restoreSnapshot: (snapshot, opts) => ports.restoreSnapshot(snapshot, opts),
      resolveContinuation: (args) => resolver(args),
      addAutoContinueBatch: (items) => ports.addBatch(items
        .map(continuationToQueueInput)
        .filter(Boolean)),
    },
  });

  // Lifecycle logging: diff what the machine publishes, so every set,
  // fade, stop, countdown and auto-continue result is one structured event.
  let last = machine.toPublished();
  const listeners = new Set();
  machine.subscribe(() => {
    const next = machine.toPublished();
    const prevSleep = last.sleepTimer;
    const nextSleep = next.sleepTimer;
    if (!!prevSleep !== !!nextSleep || prevSleep?.setAt !== nextSleep?.setAt) {
      mediaLog.sleepTimerChanged({
        target: 'local',
        state: nextSleep ? 'set' : (next.sleepResume ? 'stopped' : 'cleared'),
        mode: nextSleep?.mode ?? prevSleep?.mode ?? null,
        minutes: nextSleep?.minutes ?? null,
      });
    } else if (!last.sleepResume && next.sleepResume && !nextSleep) {
      // A timer that came due while nothing was running (hydrate): it stopped.
      mediaLog.sleepTimerChanged({ target: 'local', state: 'stopped', mode: 'minutes', minutes: null });
    } else if (nextSleep?.fading && !prevSleep?.fading) {
      mediaLog.sleepTimerChanged({ target: 'local', state: 'fading', mode: nextSleep.mode, minutes: nextSleep.minutes ?? null });
    }
    if (!!last.countdown !== !!next.countdown) {
      mediaLog.countdownChanged({
        target: 'local',
        state: next.countdown ? 'started' : 'ended',
        nextContentId: (next.countdown ?? last.countdown)?.next?.contentId ?? null,
      });
    }
    if (next.endOfQueueStatus && next.endOfQueueStatus.at !== last.endOfQueueStatus?.at) {
      mediaLog.endOfQueueResult({
        target: 'local',
        code: next.endOfQueueStatus.code,
        count: next.endOfQueueStatus.count ?? null,
      });
    }
    last = next;
    store.write(storageKey, machine.persistable());
    for (const fn of [...listeners]) {
      try { fn(); } catch { /* listener isolation */ }
    }
  });

  // Hydrate AFTER the persist/log subscriber is attached, so a hydrate-time
  // sleepResume or re-armed timer is persisted and logged at once.
  const saved = store.read(storageKey);
  if (saved && typeof saved === 'object') machine.hydrate(saved);

  const run = async (action, value, thunk) => {
    mediaLog.sessionControlCommand({ target: 'local', action, ...(value !== undefined ? { value } : {}) });
    let result;
    try { result = await thunk(); } catch (error) {
      result = { ok: false, code: 'LOCAL_ERROR', error: error?.message ?? String(error) };
    }
    if (result?.ok === false) {
      mediaLog.sessionControlFailed({ target: 'local', action, code: result.code ?? null, error: result.error ?? null });
    }
    return result ?? { ok: true };
  };
  const unsupported = (action) => {
    mediaLog.sessionControlFailed({ target: 'local', action, code: 'UNSUPPORTED' });
    return Promise.resolve({ ok: false, code: 'UNSUPPORTED', error: UNSUPPORTED[action] });
  };

  const getState = () => {
    const published = machine.toPublished();
    return resumeDismissed && published.sleepResume
      ? { ...published, sleepResume: null }
      : published;
  };

  return {
    kind: 'local',
    supports: { addOnly: false, notes: false, sleepTimer: true, endOfQueue: true, stopAfterCurrent: true, countdown: true },
    unsupportedReasons: UNSUPPORTED,
    getState,
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },

    setSleepTimer: ({ minutes, atEnd } = {}) => run('sleepTimer', atEnd ?? minutes, () => {
      resumeDismissed = false;
      return machine.handleSession('sleep-timer', atEnd !== undefined ? { atEnd } : { minutes });
    }),
    cancelSleepTimer: () => run('cancelSleepTimer', undefined, () => machine.handleSession('cancel-sleep-timer')),
    resumeSleep: () => run('resumeSleep', undefined, () => machine.handleSession('resume-sleep')),
    cancelCountdown: () => run('cancelCountdown', undefined, () => machine.handleSession('cancel-countdown')),
    startNextNow: () => run('startNextNow', undefined, () => machine.handleSession('start-next-now')),
    setEndOfQueue: (mode) => run('setEndOfQueue', mode, () => machine.applyConfig('endOfQueue', mode)),
    setStopAfterCurrent: (enabled) => run('setStopAfterCurrent', !!enabled, () => machine.applyConfig('stopAfterCurrent', !!enabled)),
    setAddOnly: () => unsupported('addOnly'),
    putBack: () => unsupported('putBack'),

    // ---- Owner hooks (LocalSessionController) ----
    /** Consulted at every natural end of an item; true = it owns what happens next. */
    naturalEnd: (ctx, actions) => machine.naturalEndPolicy(ctx, actions),
    observeSnapshot: (snapshot) => machine.observeSnapshot(snapshot),
    /** A person's command on this session: limits restart, a countdown is superseded. */
    noteCommand: (reason = 'local-command') => {
      machine.markHumanInput();
      machine.interrupt(reason);
    },
    /** A person started something new here: session modes return to defaults. */
    noteNewPlayback: () => machine.markLocalPlayback(),
    /** Playback carried on by a person (not by the timer's own resume). */
    notePlayedOn: () => {
      if (!resumeDismissed && machine.toPublished().sleepResume) {
        resumeDismissed = true;
        for (const fn of [...listeners]) {
          try { fn(); } catch { /* listener isolation */ }
        }
      }
    },
    hasAtEndSleep: () => machine.toPublished().sleepTimer?.mode === 'atEnd',
    stopsAfterCurrent: () => machine.toPublished().stopAfterCurrent === true,
    dispose: () => machine.dispose(),
  };
}

export default createLocalSessionControls;
