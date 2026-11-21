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
 *   off      -> no intro for this title (none, a resume, or too late)
 *   waiting  -> intro still deciding; the spinner shows normally
 *   covering -> intro up, spinner hidden; video loading
 *   holding  -> intro up; video held on its first frame (or resuming)
 *   playing  -> the film is rolling; the intro is done gating
 *
 * Once `off` or `playing` for a resetKey, the gate stays there. The gate never
 * reads `intro.render`; the renderer draws the scene from the stage.
 */
import { useEffect, useRef, useState } from 'react';
import { getLogger } from '../../../../../frontend/src/lib/logging/Logger.js';
import { setIntroCovering } from '../../player-support/introCover.js';

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

const FINAL = new Set(['off', 'playing']);
const COVERING = new Set(['covering', 'holding']);

export function useIntroGate({ intro, getMediaEl, startSec = 0, resetKey, playTimeoutMs = 2500 }) {
  const [stage, setStage] = useState('waiting');
  const stageRef = useRef('waiting');
  const runRef = useRef(null);
  const timersRef = useRef([]);
  const boundRef = useRef({ el: null, off: null });
  const getMediaElRef = useRef(getMediaEl);
  getMediaElRef.current = getMediaEl;
  const playTimeoutRef = useRef(playTimeoutMs);
  playTimeoutRef.current = playTimeoutMs;

  const go = (next) => { stageRef.current = next; setStage(next); };
  const clearTimers = () => { timersRef.current.forEach(clearTimeout); timersRef.current = []; };
  const after = (ms, fn) => { timersRef.current.push(setTimeout(fn, ms)); };
  const unbind = () => { boundRef.current.off?.(); boundRef.current = { el: null, off: null }; };

  /** Drop everything for the current run; resume the element if we held it. */
  const release = () => {
    clearTimers();
    unbind();
    const run = runRef.current;
    runRef.current = null;
    if (run?.pausedByUs && run.el) {
      try { run.el.play()?.catch?.(() => {}); } catch (_) { /* ignore */ }
    }
  };

  const toOff = (reason, data = {}) => {
    release();
    go('off');
    logger().debug('intro.off', { reason, ...data });
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
      const r = run.el?.play?.();
      r?.catch?.((error) => logger().warn('intro.resume-refused', { error: error?.message }));
    } catch (error) {
      logger().warn('intro.resume-refused', { error: error?.message });
    }
    after(playTimeoutRef.current, () => toPlaying('timeout'));
  };

  // A new title starts over; unmount releases the element and the cover.
  useEffect(() => {
    stageRef.current = 'waiting';
    setStage('waiting');
    return () => {
      release();
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
    logger().info('intro.covering', { minHoldMs, startSec });
    after(Math.max(0, Number(minHoldMs) || 0), onHoldDone);
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
  }, [stage, pending]);

  // While covering: watch the (current) video element for its first frame.
  useEffect(() => {
    const run = runRef.current;
    const live = COVERING.has(stageRef.current) && run && !run.done;
    const el = live ? (getMediaElRef.current?.() || null) : null;
    if (el === boundRef.current.el) return;
    unbind();
    if (!el) return;
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
    boundRef.current = { el, off: () => el.removeEventListener('playing', onPlaying) };
    if (el.paused === false && el.readyState > 2) onPlaying();
  });

  return stage;
}
