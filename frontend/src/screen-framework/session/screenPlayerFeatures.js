// frontend/src/screen-framework/session/screenPlayerFeatures.js
//
// Player features on a screen (P2), as one plain state machine with injected
// ports, attached to the screen session controls (screenSessionControls.js
// `attachExtension`) so they ride the same `session` command and publish in
// the same `snapshot.controls`:
//
//   - Subtitles and audio language (RQ-STEER-14)  set-tracks      → controls.tracks
//   - Show briefly (RQ-PLAY-11)                    beginBrief / close-brief → controls.brief
//   - Music behind a slideshow (RQ-PLAY-12)        music-behind    → controls.musicBehind
//
// Ports (bound by ScreenPlayerFeaturesHost):
//   getSnapshot()                       current bare SessionSnapshot
//   setTracks(selection)                → {ok, code?} via the playback owner's Player
//   pausePlayback() / resumePlayback()  the main playback, under a brief
//   restoreSnapshot(snapshot, opts)     → Promise<{ok}> (the put-back restore path)
//   musicCommand(op, params)            → {ok, code?} the music layer
import getLogger from '../../lib/logging/Logger.js';
import { briefLabel, validatePlayerFeatureParams } from '@shared-contracts/media/playerFeatures.mjs';
import { originLabel } from './screenSessionControls.js';

let _logger;
function logger() {
  if (!_logger) _logger = getLogger().child({ component: 'ScreenPlayerFeatures' });
  return _logger;
}

const ACTIVE = new Set(['playing', 'paused', 'buffering', 'loading', 'stalled']);
const iso = (ms) => new Date(ms).toISOString();

function currentOf(snapshot) {
  const q = snapshot?.queue;
  const entry = q && Number.isInteger(q.currentIndex) && q.currentIndex >= 0 ? q.items?.[q.currentIndex] : null;
  const item = entry ?? snapshot?.currentItem ?? null;
  return item?.contentId ? { contentId: item.contentId, queueItemId: item.queueItemId ?? null, title: item.title ?? null } : null;
}

export function createScreenPlayerFeatures({
  ownerId,
  ports = {},
  now = () => Date.now(),
  setTimer = (fn, ms) => setTimeout(fn, ms),
  clearTimer = (t) => clearTimeout(t),
} = {}) {
  let tracks = null;
  let musicBehind = null;
  let brief = null; // { id, kind, contentId, cameraId, title, origin, label, startedAt, endsAt, returnTo, wasPlaying, timer }
  let disposed = false;
  const listeners = new Set();
  const notify = () => {
    for (const fn of [...listeners]) {
      try { fn(); } catch (err) { logger().warn('listener-threw', { error: String(err?.message ?? err) }); }
    }
  };
  const snapshot = () => { try { return ports.getSnapshot?.() ?? null; } catch { return null; } };

  // --- Tracks ---------------------------------------------------------------
  function setTrackState(state) {
    tracks = state ?? null;
    notify();
  }

  async function setTracks(params) {
    const selection = {
      ...(params.audio !== undefined ? { audio: params.audio } : {}),
      ...(params.subtitle !== undefined ? { subtitle: params.subtitle } : {}),
    };
    const result = await ports.setTracks?.(selection);
    if (!result) return { ok: false, code: 'NO_PLAYBACK', error: 'Nothing is playing here' };
    logger()[result.ok ? 'info' : 'warn']('tracks.set', { ownerId, ...selection, ok: result.ok, code: result.code ?? null });
    if (result.ok === false) return { ok: false, code: result.code ?? 'TRACK_SELECT_FAILED', error: result.error ?? result.code };
    return { ok: true };
  }

  // --- Show briefly -----------------------------------------------------------
  function beginBrief({ kind, contentId = null, cameraId = null, title = null, origin = null, seconds = null, noReturn = false } = {}) {
    if (disposed) return { ok: false, code: 'DISPOSED' };
    const at = now();
    // A second interruption while one is up replaces what is shown, but the
    // programme to return to stays the one that was interrupted first.
    // `noReturn`: the start took the screen (a camera that is not brief).
    const before = brief || noReturn ? null : snapshot();
    const returnTo = brief ? brief.returnTo : (ACTIVE.has(before?.state) ? currentOf(before) : null);
    const wasPlaying = brief ? brief.wasPlaying : before?.state === 'playing';
    const returnSnapshot = brief ? brief.returnSnapshot : (returnTo ? before : null);
    if (brief?.timer) clearTimer(brief.timer);
    if (!brief && returnTo && wasPlaying) {
      try { ports.pausePlayback?.(); } catch (err) { logger().warn('brief.pause-failed', { error: String(err?.message ?? err) }); }
    }
    const originName = origin ? originLabel(origin) : null;
    brief = {
      id: `brief-${at.toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
      kind, contentId, cameraId, title, origin,
      label: briefLabel({ title: title ?? (kind === 'camera' ? 'Camera' : 'Clip'), originName: origin ? originName : null }),
      startedAt: at,
      endsAt: Number.isFinite(seconds) && seconds > 0 ? at + seconds * 1000 : null,
      returnTo, wasPlaying, returnSnapshot, timer: null,
    };
    if (brief.endsAt) {
      const id = brief.id;
      brief.timer = setTimer(() => { if (brief?.id === id) endBrief('timeout'); }, brief.endsAt - at);
    }
    logger().info('brief.started', {
      ownerId, kind, contentId, cameraId, seconds: seconds ?? null, origin: origin ?? null,
      returnTo: returnTo?.contentId ?? null, wasPlaying,
    });
    notify();
    return { ok: true, briefId: brief.id };
  }

  /** Close the brief and bring the interrupted programme back at its spot, with its queue. */
  async function endBrief(reason = 'closed') {
    if (!brief) return { ok: false, code: 'NO_BRIEF', error: 'Nothing is being shown briefly' };
    const ended = brief;
    brief = null;
    if (ended.timer) clearTimer(ended.timer);
    notify();
    let returned = 'nothing';
    const liveSnap = snapshot();
    // The programme was stopped (or cleared) while the brief was up: a time-out
    // or the clip's end must not bring it back to life. Only a person closing
    // the brief asks for the programme back.
    const personClosed = reason === 'closed' || reason === 'remote-close';
    const programmeLive = !!currentOf(liveSnap) && ACTIVE.has(liveSnap?.state);
    if (ended.programmeEnded) {
      returned = 'nothing';
    } else if (ended.returnTo && (programmeLive || personClosed)) {
      const live = currentOf(liveSnap);
      const sameItem = live && live.contentId === ended.returnTo.contentId
        && (live.queueItemId ?? null) === (ended.returnTo.queueItemId ?? null);
      if (sameItem && !programmeLive) {
        returned = 'nothing';
      } else if (sameItem) {
        if (ended.wasPlaying) {
          try { ports.resumePlayback?.(); } catch (err) { logger().warn('brief.resume-failed', { error: String(err?.message ?? err) }); }
        }
        returned = 'resumed';
      } else {
        const result = await ports.restoreSnapshot?.(ended.returnSnapshot, { autoplay: ended.wasPlaying, reason: 'brief-return' });
        returned = result?.ok === false ? `restore-failed:${result.code ?? 'unknown'}` : 'restored';
      }
    }
    logger().info('brief.ended', {
      ownerId, reason, kind: ended.kind, contentId: ended.contentId, cameraId: ended.cameraId,
      shownMs: now() - ended.startedAt, returned, returnTo: ended.returnTo?.contentId ?? null,
    });
    return { ok: true, returned };
  }

  /** Another start reached the screen: it owns the screen now; nothing returns. */
  function supersedeBrief(reason) {
    if (!brief) return;
    const ended = brief;
    brief = null;
    if (ended.timer) clearTimer(ended.timer);
    logger().info('brief.superseded', { ownerId, reason, kind: ended.kind, returnTo: ended.returnTo?.contentId ?? null });
    notify();
  }

  /**
   * Playback was stopped here (a Stop, the sleep timer, the screen going to
   * sleep): a brief that was up ends and nothing returns — the programme
   * must not be resurrected — and music behind stops with it when asked.
   */
  function onPlaybackStopped(reason, { stopMusic = true, naturalEnd = false } = {}) {
    if (naturalEnd) {
      // The programme ran out by itself. A brief up over it stays (a doorbell
      // does not vanish) but closing it must not replay what already ended.
      if (brief) { brief.programmeEnded = true; logger().info('brief.programme-ended', { ownerId, reason }); }
    } else {
      supersedeBrief(reason);
    }
    if (stopMusic && musicBehind) {
      try { ports.stopMusic?.(); } catch (err) { logger().warn('music.stop-failed', { error: String(err?.message ?? err) }); }
    }
  }

  // --- Music behind ---------------------------------------------------------
  function setMusicState(state) {
    musicBehind = state ?? null;
    notify();
  }

  async function music(params) {
    const result = await ports.musicCommand?.(params.op, params);
    if (!result) return { ok: false, code: 'MUSIC_UNAVAILABLE', error: 'Music cannot play here' };
    logger()[result.ok === false ? 'warn' : 'info']('music-behind.command', { ownerId, op: params.op, contentId: params.contentId ?? null, ok: result.ok !== false });
    return result.ok === false ? { ok: false, code: result.code ?? 'MUSIC_FAILED', error: result.error ?? result.code } : { ok: true };
  }

  // --- Commands ---------------------------------------------------------------
  const handles = (action) => ['set-tracks', 'close-brief', 'music-behind'].includes(action);

  async function handleSession(action, params = {}) {
    const checked = validatePlayerFeatureParams({ action, ...params });
    if (!checked || !checked.valid) return { ok: false, code: 'INVALID_SESSION_COMMAND', error: checked?.errors?.[0] };
    if (action === 'set-tracks') return setTracks(params);
    if (action === 'close-brief') return endBrief('remote-close');
    if (action === 'music-behind') return music(params);
    return { ok: false, code: 'INVALID_SESSION_COMMAND' };
  }

  // --- Publication --------------------------------------------------------------
  function toPublished() {
    const t = now();
    return {
      tracks,
      brief: brief ? {
        id: brief.id,
        kind: brief.kind,
        ...(brief.contentId ? { contentId: brief.contentId } : {}),
        ...(brief.cameraId ? { cameraId: brief.cameraId } : {}),
        title: brief.title ?? null,
        label: brief.label,
        origin: brief.origin ?? null,
        startedAt: iso(brief.startedAt),
        endsAt: brief.endsAt ? iso(brief.endsAt) : null,
        remainingSeconds: brief.endsAt ? Math.max(0, Math.ceil((brief.endsAt - t) / 1000)) : null,
        returnTo: brief.returnTo ? { contentId: brief.returnTo.contentId, title: brief.returnTo.title ?? null } : null,
      } : null,
      musicBehind,
    };
  }

  return {
    handles,
    handleSession,
    setTrackState,
    beginBrief,
    endBrief,
    supersedeBrief,
    onPlaybackStopped,
    isBriefActive: () => !!brief,
    getBrief: () => (brief ? toPublished().brief : null),
    setMusicState,
    toPublished,
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    setPorts(partial = {}) { Object.assign(ports, partial); },
    dispose() {
      disposed = true;
      if (brief?.timer) clearTimer(brief.timer);
      brief = null;
      listeners.clear();
    },
    get ownerId() { return ownerId; },
  };
}

export default createScreenPlayerFeatures;
