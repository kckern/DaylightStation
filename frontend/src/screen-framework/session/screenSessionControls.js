// frontend/src/screen-framework/session/screenSessionControls.js
//
// Screen session controls — the P1 screen-player capabilities, as one plain
// state machine with injected ports so it can be tested without React:
//
//   - Add only (RQ-PLAY-10)                      applyConfig('addOnly')
//   - End of queue stop | repeat | similar       applyConfig('endOfQueue') + naturalEndPolicy
//   - Next-episode countdown, stop after this    naturalEndPolicy + handleSession
//   - Sleep timer with fade, resume-from-set     handleSession('sleep-timer' …)
//   - Screen notes + Put it back (RQ-STEER-21)   noteRemoteCommand + handleSession('put-back')
//   - Origin of the latest command               stampOrigin / getOrigin
//
// Everything a remote needs to see is published through `toPublished()` as
// `SessionSnapshot.controls` (tech doc §9.14). Ports:
//   getSnapshot()                     current SessionSnapshot (or null)
//   stopPlayback()                    stop via the playback owner, keeping the queue
//   setFade(multiplier)               screen-level fade multiplier (0..1)
//   restoreSnapshot(snapshot, opts)   adopt a snapshot (paused or playing) → Promise<{ok}>
//   resolveContinuation({ finished, queue }) → Promise<items[]> ("keep similar things playing")
//   addAutoContinueBatch(items)       append one batch as ONE queue operation → Promise<{ok}>
import getLogger from '../../lib/logging/Logger.js';
import {
  createDefaultSessionControls, isEndOfQueueMode, validateSessionActionParams,
  NEXT_EPISODE_COUNTDOWN_SECONDS, PUT_BACK_WINDOW_MS, SLEEP_FADE_MS,
} from '@shared-contracts/media/sessionControls.mjs';
import { AUTO_CONTINUE_ADDED_BY } from '@shared-contracts/media/continuation.mjs';

let _logger;
function logger() {
  if (!_logger) _logger = getLogger().child({ component: 'ScreenSessionControls' });
  return _logger;
}

const NOTE_GROUP_WINDOW_MS = 60_000;
const MAX_NOTES = 5;
const FADE_TICK_MS = 250;
const FADE_RESTORE_DELAY_MS = 1_000;
const NOTE_VERBS = { paused: 'Paused', stopped: 'Stopped', replaced: 'Replaced', moved: 'Moved' };
const ACTIVE_STATES = new Set(['playing', 'paused', 'buffering', 'loading', 'stalled', 'ready']);
const VIDEO_FORMATS = new Set(['video', 'dash_video', 'hls_video']);

const iso = (ms) => new Date(ms).toISOString();

/** An item is an episode when the catalog says so, or it carries show/season placement. */
export function isEpisode(item) {
  if (!item) return false;
  if (item.type === 'episode' || item.metadata?.type === 'episode' || item.itemType === 'episode') return true;
  return VIDEO_FORMATS.has(item.format ?? item.mediaType) && !!item.grandparentTitle && !!item.parentTitle
    && Number.isFinite(item.itemIndex);
}

export function originLabel(origin) {
  if (!origin || typeof origin !== 'object') return 'another device';
  if (typeof origin.name === 'string' && origin.name.trim()) return origin.name.trim();
  if (origin.kind === 'device' && typeof origin.id === 'string') return origin.id.replace(/^(browser|fleet):/, '');
  return 'another device';
}

const originKey = (origin) => `${origin?.kind ?? 'unknown'}:${origin?.id ?? origin?.name ?? ''}`;

function currentEntry(snapshot) {
  const q = snapshot?.queue;
  return q && Number.isInteger(q.currentIndex) && q.currentIndex >= 0 ? q.items?.[q.currentIndex] ?? null : null;
}

function positionOf(snapshot) {
  const entry = currentEntry(snapshot) ?? snapshot?.currentItem ?? null;
  if (!entry?.contentId) return null;
  return {
    contentId: entry.contentId,
    queueItemId: entry.queueItemId ?? null,
    position: Number.isFinite(snapshot?.position) ? snapshot.position : 0,
  };
}

const hasPlayback = (snapshot) => !!(snapshot?.currentItem || currentEntry(snapshot)) && ACTIVE_STATES.has(snapshot?.state);

/** Which kind of note a remote command produces on this screen, or null. */
function classifyRemoteCommand({ command, params = {} }, snapshot) {
  if (!hasPlayback(snapshot)) return null;
  if (command === 'transport') {
    if (params.action === 'pause') return snapshot.state === 'paused' ? null : 'paused';
    if (params.action === 'stop') return params.intent === 'move' ? 'moved' : 'stopped';
    return null;
  }
  if (command === 'queue') {
    if (params.op === 'play-now') return 'replaced';
    if (params.op === 'item-action' && (params.kind === 'playNow' || params.kind === 'shuffle')) return 'replaced';
    return null;
  }
  if (command === 'adopt-snapshot') return 'replaced';
  if (command === 'handoff') {
    if (params.op === 'commit-stop') return 'moved';
    if (params.op === 'start') return 'replaced';
  }
  return null;
}

export function createScreenSessionControls({
  ownerId,
  ports = {},
  now = () => Date.now(),
  countdownSeconds = NEXT_EPISODE_COUNTDOWN_SECONDS,
} = {}) {
  const state = createDefaultSessionControls();
  let lastOrigin = null;
  let generation = 0;
  let restore = null; // { snapshot, noteId, generation, expiresAt }
  let sleep = null;   // internal: { mode, minutes?, atEnd?, setAt, endsAt?, setPosition, fading, timers }
  let countdown = null; // internal: { next, current, seconds, endsAt, actions, timer, ticker }
  let refillFor = null;
  let disposed = false;
  const listeners = new Set();

  const notify = () => {
    for (const fn of [...listeners]) {
      try { fn(); } catch (err) { logger().warn('listener-threw', { error: String(err?.message ?? err) }); }
    }
  };
  const snapshot = () => { try { return ports.getSnapshot?.() ?? null; } catch { return null; } };
  const setFade = (value) => { try { ports.setFade?.(value); } catch (err) { logger().warn('fade-failed', { error: String(err?.message ?? err) }); } };

  // --- Sleep timer -------------------------------------------------------
  function clearSleepTimers() {
    if (!sleep) return;
    for (const t of sleep.timers) { clearTimeout(t); clearInterval(t); }
    sleep.timers = [];
  }

  function completeSleep(reason) {
    const record = sleep;
    clearSleepTimers();
    sleep = null;
    const stoppedAt = iso(now());
    state.sleepResume = record?.setPosition
      ? { ...record.setPosition, setAt: record.setAt, stoppedAt }
      : null;
    logger().info('sleep-timer.stopped', { ownerId, reason, mode: record?.mode, resume: state.sleepResume });
    notify();
  }

  function fireMinutesSleep() {
    if (!sleep) return;
    try { ports.stopPlayback?.(); } catch (err) { logger().warn('sleep-timer.stop-failed', { error: String(err?.message ?? err) }); }
    completeSleep('minutes-elapsed');
    // The renderer pauses asynchronously; restore the screen's volume once the
    // stop has landed so the next playback is not silent.
    setTimeout(() => setFade(1), FADE_RESTORE_DELAY_MS);
  }

  function startFade() {
    if (!sleep || sleep.fading) return;
    sleep.fading = true;
    logger().info('sleep-timer.fading', { ownerId, fadeMs: SLEEP_FADE_MS });
    const tick = () => {
      if (!sleep) return;
      const remaining = Math.max(0, sleep.endsAt - now());
      setFade(Math.min(1, remaining / SLEEP_FADE_MS));
    };
    tick();
    sleep.timers.push(setInterval(tick, FADE_TICK_MS));
    notify();
  }

  function armSleep(params) {
    clearSleepTimers();
    const setAt = now();
    const base = { setAt: iso(setAt), setPosition: positionOf(snapshot()), fading: false, timers: [] };
    if (params.atEnd) {
      sleep = { ...base, mode: 'atEnd', atEnd: params.atEnd };
    } else {
      const endsAt = setAt + params.minutes * 60_000;
      sleep = { ...base, mode: 'minutes', minutes: params.minutes, endsAt };
      sleep.timers.push(setTimeout(startFade, Math.max(0, endsAt - setAt - SLEEP_FADE_MS)));
      sleep.timers.push(setTimeout(fireMinutesSleep, endsAt - setAt));
    }
    state.sleepResume = null;
    logger().info('sleep-timer.set', { ownerId, mode: sleep.mode, minutes: params.minutes ?? null, atEnd: params.atEnd ?? null, setPosition: sleep.setPosition });
    notify();
  }

  function cancelSleep() {
    if (!sleep) return false;
    clearSleepTimers();
    sleep = null;
    setFade(1);
    logger().info('sleep-timer.cancelled', { ownerId });
    notify();
    return true;
  }

  async function resumeSleep() {
    const record = state.sleepResume;
    if (!record) return { ok: false, code: 'SLEEP_RESUME_UNAVAILABLE', error: 'No sleep timer stopped playback here' };
    const current = snapshot();
    if (!current?.queue?.items?.length) return { ok: false, code: 'SLEEP_RESUME_UNAVAILABLE', error: 'The queue is gone' };
    const items = current.queue.items;
    let index = items.findIndex((it) => record.queueItemId && it.queueItemId === record.queueItemId);
    if (index < 0) index = items.findIndex((it) => it.contentId === record.contentId);
    if (index < 0) return { ok: false, code: 'SLEEP_RESUME_UNAVAILABLE', error: 'That item is no longer queued' };
    const restored = {
      ...current,
      state: 'playing',
      position: record.position,
      currentItem: items[index],
      queue: { ...current.queue, currentIndex: index, executionOrder: items.slice(index).map((it) => it.queueItemId) },
    };
    const result = await ports.restoreSnapshot?.(restored, { autoplay: true, reason: 'resume-sleep' });
    if (result?.ok === false) return result;
    state.sleepResume = null;
    generation += 1;
    logger().info('sleep-timer.resumed', { ownerId, contentId: record.contentId, position: record.position });
    notify();
    return { ok: true };
  }

  // --- Countdown ---------------------------------------------------------
  function clearCountdown(reason) {
    if (!countdown) return null;
    const ended = countdown;
    clearTimeout(ended.timer);
    clearInterval(ended.ticker);
    countdown = null;
    state.countdown = null;
    logger().info('countdown.ended', { ownerId, reason, next: ended.next?.contentId ?? null });
    notify();
    return ended;
  }

  function startCountdown(ctx, actions) {
    clearCountdown('superseded');
    const startedAt = now();
    countdown = {
      next: ctx.next, current: ctx.current, seconds: countdownSeconds,
      endsAt: startedAt + countdownSeconds * 1000, actions, generation,
    };
    countdown.timer = setTimeout(() => {
      const ended = clearCountdown('elapsed');
      if (ended && ended.generation === generation) ended.actions.advance();
    }, countdownSeconds * 1000);
    // Re-publish once a second so every remote shows the same count.
    countdown.ticker = setInterval(notify, 1000);
    logger().info('countdown.started', { ownerId, seconds: countdownSeconds, current: ctx.current?.contentId, next: ctx.next?.contentId });
    notify();
  }

  // --- End of queue / natural end policy --------------------------------
  function setStatus(status) {
    state.endOfQueueStatus = status ? { ...status, at: iso(now()) } : null;
    notify();
  }

  async function addContinuation(finished, { advanceAfter, actions }) {
    const startedGeneration = generation;
    let items = [];
    try {
      items = await ports.resolveContinuation?.({ finished, queue: snapshot()?.queue ?? null }) ?? [];
    } catch (err) {
      logger().warn('auto-continue.resolve-failed', { ownerId, contentId: finished?.contentId, error: String(err?.message ?? err) });
      items = [];
    }
    if (disposed || generation !== startedGeneration) {
      logger().info('auto-continue.abandoned', { ownerId, reason: 'newer-command', contentId: finished?.contentId });
      return;
    }
    if (!items.length) {
      logger().info('auto-continue.nothing-similar', { ownerId, contentId: finished?.contentId });
      setStatus({ code: 'NOTHING_SIMILAR', message: 'Nothing similar left' });
      if (advanceAfter) actions.finish();
      return;
    }
    const marked = items.map((it) => ({ ...it, addedBy: AUTO_CONTINUE_ADDED_BY }));
    const result = await ports.addAutoContinueBatch?.(marked);
    if (result?.ok === false) {
      logger().warn('auto-continue.add-failed', { ownerId, code: result.code });
      if (advanceAfter) actions.finish();
      return;
    }
    logger().info('auto-continue.added', {
      ownerId, after: finished?.contentId, count: marked.length,
      contentIds: marked.map((it) => it.contentId), operationId: result?.operationId ?? null,
    });
    setStatus({ code: 'SIMILAR_ADDED', count: marked.length, contentIds: marked.map((it) => it.contentId), title: marked[0]?.title ?? null });
    if (advanceAfter && generation === startedGeneration) actions.advance();
  }

  /**
   * Consulted by the Player at every NATURAL end of an item (never on skip).
   * Returns true when it took responsibility for what happens next.
   */
  function naturalEndPolicy(ctx = {}, actions) {
    const { current = null, next = null } = ctx;
    if (current?.isLive === true) return false;
    if (sleep?.mode === 'atEnd') {
      actions.stop();
      completeSleep('end-of-item');
      return true;
    }
    if (state.stopAfterCurrent) {
      actions.stop();
      state.stopAfterCurrent = false;
      logger().info('stop-after-current.stopped', { ownerId, contentId: current?.contentId ?? null });
      setStatus({ code: 'STOPPED_AFTER_CURRENT' });
      return true;
    }
    if (next) {
      if (countdownSeconds > 0 && isEpisode(current) && isEpisode(next)) {
        startCountdown(ctx, actions);
        return true;
      }
      return false;
    }
    if (state.endOfQueue === 'repeat') {
      logger().info('end-of-queue.repeat', { ownerId, contentId: current?.contentId ?? null });
      return actions.restartQueue() !== false;
    }
    if (state.endOfQueue === 'similar') {
      logger().info('end-of-queue.similar', { ownerId, contentId: current?.contentId ?? null });
      addContinuation(current, { advanceAfter: true, actions });
      return true;
    }
    return false;
  }

  /** Refill when the last auto-added item starts (batches of ≤5 / ~30 min). */
  function observeSnapshot(snap) {
    const entry = currentEntry(snap);
    // A countdown belongs to the item that just finished. If the owner has
    // moved on by any route (skip, jump, a newer Play), it no longer applies
    // and must never advance a second time (B4).
    if (countdown) {
      const finished = countdown.current;
      const same = entry && finished
        && (finished.queueItemId ? entry.queueItemId === finished.queueItemId : entry.contentId === finished.contentId);
      if (!same) clearCountdown('current-item-changed');
    }
    if (state.endOfQueue !== 'similar') return;
    const order = snap?.queue?.executionOrder;
    const isLast = Array.isArray(order) ? order.length <= 1 : snap?.queue?.currentIndex === (snap?.queue?.items?.length ?? 0) - 1;
    if (!entry || entry.addedBy !== AUTO_CONTINUE_ADDED_BY || !isLast) return;
    if (refillFor === entry.queueItemId) return;
    refillFor = entry.queueItemId;
    logger().info('auto-continue.refill', { ownerId, contentId: entry.contentId });
    addContinuation(entry, { advanceAfter: false });
  }

  // --- Notes / Put it back ----------------------------------------------
  function restoreAvailable(noteId) {
    return !!restore && restore.noteId === noteId && restore.generation === generation && now() <= restore.expiresAt;
  }

  function noteRemoteCommand(command) {
    const before = snapshot();
    const kind = classifyRemoteCommand(command, before);
    if (!kind) return null;
    generation += 1;
    clearCountdown('remote-command');
    const at = now();
    const origin = command.origin ?? null;
    const last = state.notes[0];
    let note;
    if (last && last.kind === kind && last.originKey === originKey(origin) && at - Date.parse(last.at) <= NOTE_GROUP_WINDOW_MS) {
      note = { ...last, count: last.count + 1, at: iso(at) };
      state.notes = [note, ...state.notes.slice(1)];
    } else {
      note = {
        id: `note-${at.toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
        kind, origin, originKey: originKey(origin), count: 1, at: iso(at),
        label: `${NOTE_VERBS[kind]} by ${originLabel(origin)}`,
      };
      state.notes = [note, ...state.notes].slice(0, MAX_NOTES);
    }
    restore = { snapshot: before, noteId: note.id, generation, expiresAt: at + PUT_BACK_WINDOW_MS };
    logger().info('note.recorded', { ownerId, kind, count: note.count, origin, contentId: before?.currentItem?.contentId ?? null });
    notify();
    // Re-publish when the Put it back window closes so remotes drop the offer.
    setTimeout(() => notify(), PUT_BACK_WINDOW_MS + 50);
    return note;
  }

  async function putBack(params = {}) {
    const target = params.noteId ?? restore?.noteId;
    if (!target || !restoreAvailable(target)) {
      logger().info('put-back.refused', { ownerId, noteId: target ?? null });
      return { ok: false, code: 'PUT_BACK_UNAVAILABLE', error: 'Nothing to put back' };
    }
    const record = restore;
    restore = null;
    const result = await ports.restoreSnapshot?.(record.snapshot, {
      autoplay: record.snapshot?.state === 'playing', reason: 'put-back',
    });
    if (result?.ok === false) {
      logger().warn('put-back.failed', { ownerId, code: result.code });
      notify();
      return result;
    }
    generation += 1;
    logger().info('put-back.restored', { ownerId, noteId: record.noteId, contentId: record.snapshot?.currentItem?.contentId ?? null });
    notify();
    return { ok: true };
  }

  // --- Commands ----------------------------------------------------------
  function applyConfig(setting, value) {
    if (setting === 'addOnly' || setting === 'stopAfterCurrent') {
      if (typeof value !== 'boolean') return { ok: false, code: 'INVALID_VALUE', error: `${setting} requires a boolean` };
      state[setting] = value;
    } else if (setting === 'endOfQueue') {
      if (!isEndOfQueueMode(value)) return { ok: false, code: 'INVALID_VALUE', error: 'endOfQueue requires stop|repeat|similar' };
      state.endOfQueue = value;
      state.endOfQueueStatus = null;
      refillFor = null;
    } else {
      return { ok: false, code: 'UNKNOWN_SETTING' };
    }
    logger().info('setting.changed', { ownerId, setting, value });
    notify();
    return { ok: true };
  }

  async function handleSession(action, params = {}) {
    const checked = validateSessionActionParams({ action, ...params });
    if (!checked.valid) return { ok: false, code: 'INVALID_SESSION_COMMAND', error: checked.errors[0] };
    switch (action) {
      case 'sleep-timer': armSleep(params); return { ok: true };
      case 'cancel-sleep-timer': cancelSleep(); return { ok: true };
      case 'resume-sleep': return resumeSleep();
      case 'put-back': return putBack(params);
      case 'cancel-countdown': {
        const ended = clearCountdown('cancelled');
        if (!ended) return { ok: false, code: 'NO_COUNTDOWN', error: 'No countdown is running' };
        ended.actions.stop();
        return { ok: true };
      }
      case 'start-next-now': {
        const ended = clearCountdown('start-now');
        if (!ended) return { ok: false, code: 'NO_COUNTDOWN', error: 'No countdown is running' };
        ended.actions.advance();
        return { ok: true };
      }
      default: return { ok: false, code: 'INVALID_SESSION_COMMAND' };
    }
  }

  /** A transport / seek / queue command arrived: a pending countdown is superseded (B4). */
  function interrupt(reason) {
    if (!countdown) return;
    generation += 1;
    clearCountdown(reason ?? 'interrupted');
  }

  function markLocalPlayback() {
    generation += 1;
    restore = null;
    clearCountdown('local-playback');
    notify();
  }

  // --- Publication -------------------------------------------------------
  function toPublished() {
    const t = now();
    let sleepTimer = null;
    if (sleep) {
      sleepTimer = {
        mode: sleep.mode, setAt: sleep.setAt, setPosition: sleep.setPosition, fading: !!sleep.fading,
        ...(sleep.mode === 'minutes'
          ? { minutes: sleep.minutes, endsAt: iso(sleep.endsAt), remainingSeconds: Math.max(0, Math.ceil((sleep.endsAt - t) / 1000)) }
          : { atEnd: sleep.atEnd }),
      };
    }
    return {
      addOnly: state.addOnly,
      endOfQueue: state.endOfQueue,
      stopAfterCurrent: state.stopAfterCurrent,
      sleepTimer,
      sleepResume: state.sleepResume,
      countdown: countdown ? {
        seconds: countdown.seconds,
        endsAt: iso(countdown.endsAt),
        remainingSeconds: Math.max(0, Math.ceil((countdown.endsAt - t) / 1000)),
        next: { contentId: countdown.next.contentId, title: countdown.next.title ?? null, queueItemId: countdown.next.queueItemId ?? null },
        current: countdown.current ? { contentId: countdown.current.contentId, title: countdown.current.title ?? null } : null,
      } : null,
      endOfQueueStatus: state.endOfQueueStatus,
      notes: state.notes.map(({ originKey: _k, ...note }) => ({
        ...note,
        putBack: restoreAvailable(note.id) ? { availableUntil: iso(restore.expiresAt) } : null,
      })),
    };
  }

  return {
    getState: toPublished,
    toPublished,
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    applyConfig,
    handleSession,
    noteRemoteCommand,
    markLocalPlayback,
    interrupt,
    naturalEndPolicy,
    observeSnapshot,
    stampOrigin(origin) { if (origin && typeof origin === 'object') lastOrigin = origin; },
    getOrigin: () => lastOrigin,
    isAddOnly: () => state.addOnly,
    /** True while something is loaded here — Add only has a queue to protect. */
    hasPlayback: () => hasPlayback(snapshot()),
    persistable: () => ({
      addOnly: state.addOnly, endOfQueue: state.endOfQueue, stopAfterCurrent: state.stopAfterCurrent,
      sleepResume: state.sleepResume,
    }),
    hydrate(saved = {}) {
      if (typeof saved.addOnly === 'boolean') state.addOnly = saved.addOnly;
      if (isEndOfQueueMode(saved.endOfQueue)) state.endOfQueue = saved.endOfQueue;
      if (typeof saved.stopAfterCurrent === 'boolean') state.stopAfterCurrent = saved.stopAfterCurrent;
      if (saved.sleepResume && typeof saved.sleepResume === 'object') state.sleepResume = saved.sleepResume;
      logger().info('hydrated', { ownerId, addOnly: state.addOnly, endOfQueue: state.endOfQueue });
      notify();
    },
    dispose() {
      disposed = true;
      clearSleepTimers();
      clearCountdown('dispose');
      listeners.clear();
    },
    /** Late-bind ports that need the React tree (fade, restore, playback owner). */
    setPorts(partial = {}) { Object.assign(ports, partial); },
    get ownerId() { return ownerId; },
  };
}

export default createScreenSessionControls;
