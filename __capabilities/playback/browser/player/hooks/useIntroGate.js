/**
 * useIntroGate — the Player's timing for an installed intro scene.
 *
 * An app may supply an intro (`{ status, minHoldMs, render }`) that covers the
 * loading spinner while a title starts. The Player owns all timing: the intro
 * covers as soon as it is ready, and a video whose first frame arrives before
 * `minHoldMs` is over is held paused on that frame. When the hold is over and
 * the video is ready, the video plays and the intro steps aside.
 *
 * Stages:
 *   off      -> no intro for this title (none, a resume, a recovery remount,
 *               too late, or a video that never produced a frame)
 *   waiting  -> intro still deciding; the spinner is held back for at most
 *               INTRO_WAIT_COVER_MS. If the film rolls past INTRO_LATE_SEC
 *               first, the gate goes off (`late`).
 *   covering -> intro up, spinner hidden; video loading
 *   holding  -> intro up; video held on its first frame (or resuming)
 *   playing  -> the film is rolling; the intro is done gating
 *
 * Once `off` or `playing` for a resetKey, the gate stays there. The gate never
 * reads `intro.render`; the renderer draws the scene from the stage.
 *
 * Covering never outlasts `minHoldMs + INTRO_COVER_CEILING_MS`: a stream that
 * never produces a frame must not sit behind the scene.
 *
 * `coverStartedAt`: when SinglePlayer's intro host (useIntroHost) already put
 * the scene up during the play-info fetch, the hold counts from that moment,
 * so the early cover does not lengthen it.
 */
import { useEffect, useRef, useState } from 'react';
import { getLogger } from '../../../../../frontend/src/lib/logging/Logger.js';
import { setIntroCovering } from '../../player-support/introCover.js';
import { tagPauseSource, tagPlaySource } from '../lib/playbackToggleSource.js';

let _logger;
const logger = () => (_logger ||= getLogger().child({ component: 'intro-gate' }));

/** A requested start past this many seconds is a resume: no intro. */
export const INTRO_START_WINDOW_SEC = 5;
/** An intro that is ready after the film has rolled this far is too late. */
export const INTRO_LATE_SEC = 1;
/**
 * While an intro is still deciding, the spinner is held back this long so it
 * does not flash before the scene; past it (slow lookup) the spinner returns.
 */
export const INTRO_WAIT_COVER_MS = 1500;
/**
 * A covering intro whose video has not produced a frame this long after the
 * hold was due steps aside, so a broken stream is not hidden behind the scene.
 */
export const INTRO_COVER_CEILING_MS = 20000;
/** Pause/play source tag for the gate's own hold (see lib/playbackToggleSource.js). */
const HOLD_SOURCE = 'intro-hold';

const FINAL = new Set(['off', 'playing']);
const COVERING = new Set(['covering', 'holding']);

export function useIntroGate({ intro, getMediaEl, startSec = 0, resetKey, playTimeoutMs = 2500, coverStartedAt = null }) {
  const [stage, setStage] = useState('waiting');
  const stageRef = useRef('waiting');
  const runRef = useRef(null);
  const timersRef = useRef([]);
  const boundRef = useRef({ el: null, off: null });
  const getMediaElRef = useRef(getMediaEl);
  getMediaElRef.current = getMediaEl;
  const playTimeoutRef = useRef(playTimeoutMs);
  playTimeoutRef.current = playTimeoutMs;
  // When the scene went up before this gate mounted (SinglePlayer's intro host
  // covered the play-info fetch), the hold counts from then.
  const coverStartedAtRef = useRef(coverStartedAt);
  coverStartedAtRef.current = coverStartedAt;

  const go = (next) => { stageRef.current = next; setStage(next); };
  const clearTimers = () => { timersRef.current.forEach(clearTimeout); timersRef.current = []; };
  const after = (ms, fn) => { timersRef.current.push(setTimeout(fn, ms)); };
  const unbind = () => { boundRef.current.off?.(); boundRef.current = { el: null, off: null }; };

  /** Resume an element we held, if it is still in the document. */
  const resumeHeld = (el) => {
    if (!el || el.isConnected === false) return;
    tagPlaySource(el, HOLD_SOURCE);
    try { el.play()?.catch?.(() => {}); } catch (_) { /* ignore */ }
  };

  /**
   * Drop everything for the current run. `resume` (a reset or a withdrawn
   * intro) resumes an element we held; an unmount never does, since the
   * element is going away with us.
   */
  const release = ({ resume = true } = {}) => {
    clearTimers();
    unbind();
    const run = runRef.current;
    runRef.current = null;
    const held = run?.pausedByUs ? run.el : null;
    if (resume) resumeHeld(held);
    return held;
  };

  const toOff = (reason, data = {}, level = 'debug') => {
    release();
    go('off');
    logger()[level]('intro.off', { reason, ...data });
  };

  const toPlaying = (by) => {
    const run = runRef.current;
    if (!run || run.done) return;
    run.done = true;
    clearTimers();
    unbind();
    runRef.current = null;
    go('playing');
    logger().info('intro.playing', { by, waitedMs: Date.now() - run.startedAt });
  };

  /** The hold is over: resume a held video, or keep covering a loading one. */
  const onHoldDone = () => {
    const run = runRef.current;
    if (!run || run.done) return;
    run.holdDone = true;
    if (stageRef.current !== 'holding') return; // still loading: first `playing` ends it
    run.pausedByUs = false;
    run.resuming = true;
    try {
      if (run.el) tagPlaySource(run.el, HOLD_SOURCE);
      const r = run.el?.play?.();
      r?.catch?.((error) => logger().warn('intro.resume-refused', { error: error?.message }));
    } catch (error) {
      logger().warn('intro.resume-refused', { error: error?.message });
    }
    after(playTimeoutRef.current, () => toPlaying('timeout'));
  };

  // A new title starts over; unmount releases the cover. An element held for
  // the previous title is resumed only on a reset (the next run's body), never
  // on unmount, where it is being torn down with us.
  const heldOnResetRef = useRef(null);
  useEffect(() => {
    const held = heldOnResetRef.current;
    heldOnResetRef.current = null;
    resumeHeld(held);
    stageRef.current = 'waiting';
    setStage('waiting');
    return () => {
      heldOnResetRef.current = release({ resume: false });
      setIntroCovering(false);
    };
  }, [resetKey]);

  // Decide from the intro's status.
  const status = intro ? intro.status : null;
  const minHoldMs = intro ? intro.minHoldMs : null;
  useEffect(() => {
    const current = stageRef.current;
    if (FINAL.has(current)) return;
    if (!status || status === 'none') { toOff('none'); return; }
    if (COVERING.has(current)) return;
    if (Number(startSec) > INTRO_START_WINDOW_SEC) { toOff('resume', { startSec }); return; }
    if (status !== 'ready') { if (current !== 'waiting') go('waiting'); return; }
    const el = getMediaElRef.current?.() || null;
    if (el && el.paused === false && Number(el.currentTime) > INTRO_LATE_SEC) {
      toOff('late', { at: +Number(el.currentTime).toFixed(2) });
      return;
    }
    runRef.current = {
      el: null, startedAt: Date.now(), holdDone: false, pausedByUs: false, resuming: false, done: false,
    };
    go('covering');
    const since = Number(coverStartedAtRef.current);
    const earlyMs = Number.isFinite(since) && since > 0 ? Math.max(0, Date.now() - since) : 0;
    logger().info('intro.covering', { minHoldMs, startSec, earlyMs });
    const holdMs = Math.max(0, (Number(minHoldMs) || 0) - earlyMs);
    after(holdMs, onHoldDone);
    after(holdMs + INTRO_COVER_CEILING_MS, () => {
      if (stageRef.current !== 'covering') return;
      toOff('cover-timeout', { waitedMs: holdMs + INTRO_COVER_CEILING_MS }, 'warn');
    });
  }, [status, minHoldMs, startSec, resetKey]);

  // Publish the cover flag for the loading overlay. A pending intro holds the
  // spinner back briefly too, so a scene that is about to appear is not
  // preceded by a spinner flash.
  const pending = stage === 'waiting' && status === 'pending';
  useEffect(() => {
    if (COVERING.has(stage)) { setIntroCovering(true); return undefined; }
    if (!pending) { setIntroCovering(false); return undefined; }
    setIntroCovering(true);
    const t = setTimeout(() => setIntroCovering(false), INTRO_WAIT_COVER_MS);
    return () => clearTimeout(t);
    // resetKey: a reset's cleanup drops the flag; a covering -> covering reset
    // leaves `stage` unchanged, so the flag must be published again.
  }, [stage, pending, resetKey]);

  // Watch the (current) video element: for its first frame while covering, and
  // for the film rolling past INTRO_LATE_SEC while still waiting.
  const mediaEl = (FINAL.has(stage) ? null : getMediaElRef.current?.()) || null;
  useEffect(() => {
    const current = stageRef.current;
    if (current === 'waiting') {
      const el = mediaEl;
      if (!el) return undefined;
      const onRolling = () => {
        if (stageRef.current !== 'waiting') return;
        const t = Number(el.currentTime);
        if (el.paused === false && t > INTRO_LATE_SEC) toOff('late', { at: +t.toFixed(2) });
      };
      el.addEventListener('playing', onRolling);
      el.addEventListener('timeupdate', onRolling);
      const off = () => {
        el.removeEventListener('playing', onRolling);
        el.removeEventListener('timeupdate', onRolling);
      };
      boundRef.current = { el, off };
      onRolling();
      return () => { if (boundRef.current.off === off) unbind(); else off(); };
    }
    const run = runRef.current;
    const live = COVERING.has(current) && run && !run.done;
    const el = live ? mediaEl : null;
    if (!el) return undefined;
    run.el = el;
    const onPlaying = () => {
      const r = runRef.current;
      if (!r || r.done) return;
      if (r.resuming) { toPlaying('playing'); return; }
      if (Number(el.currentTime) > INTRO_START_WINDOW_SEC) {
        toOff('resumed-elsewhere', { at: +Number(el.currentTime).toFixed(2) });
        return;
      }
      if (!r.holdDone) {
        tagPauseSource(el, HOLD_SOURCE);
        try { el.pause(); r.pausedByUs = true; } catch (_) { /* ignore */ }
        if (stageRef.current !== 'holding') {
          go('holding');
          logger().debug('intro.holding', { at: +Number(el.currentTime).toFixed(2) });
        }
        return;
      }
      toPlaying('ready');
    };
    el.addEventListener('playing', onPlaying);
    const off = () => el.removeEventListener('playing', onPlaying);
    boundRef.current = { el, off };
    if (el.paused === false && el.readyState > 2) onPlaying();
    return () => { if (boundRef.current.off === off) unbind(); else off(); };
  }, [stage, resetKey, mediaEl]);

  return stage;
}
