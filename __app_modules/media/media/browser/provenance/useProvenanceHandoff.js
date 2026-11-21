/**
 * useProvenanceHandoff — the provider scene as the title's loading screen.
 *
 * As soon as the provider is known (usually before the video has loaded) the
 * scene covers the player and hides its spinner. It holds for a random 5-10 s
 * and for as long as the video is still loading after that; a video that is
 * ready early is held paused on its first frame. When both are done the lines
 * meet as the film starts, the field clears and the logo docks in the corner.
 *
 * Only from the top: a requested start past HANDOFF_START_WINDOW_SEC (a resume)
 * shows nothing. A title whose answer arrives after the film is already rolling
 * plays plain; the next play has it.
 *
 * Phases:
 *   pending  -> waiting for the provider (the player's spinner shows meanwhile)
 *   linking  -> scene up, spinner hidden; lines creep in; video loading or held
 *   linked   -> film started; the lines meet
 *   docked   -> scene dissolves, logo in the corner over the film
 *   leaving  -> corner logo fades
 *   done | skipped
 *
 * Safety: if the video is still not playing revealCapMs after the hold, the
 * scene steps aside so the player's own loading and recovery screen shows.
 *
 * `afterHandoff` is true once nothing more will cover the opening, so the
 * content-filter bumper can follow it instead of colliding with it.
 *
 * Reference: __docs/reference/media/provenance.md
 */
import { useEffect, useRef, useState } from 'react';
import { getChildLogger } from '../../../../../frontend/src/lib/logging/singleton.js';
import { setProvenanceHolding } from './provenanceHold.js';

let _logger;
const logger = () => (_logger ||= getChildLogger({ component: 'provenance' }));

export const HANDOFF_START_WINDOW_SEC = 5;
/** Data arriving after the film has rolled this far is too late to cover it. */
export const LATE_START_SEC = 1;
export const HANDOFF_TIMING = Object.freeze({
  linkMinMs: 5000,     // the scene holds for a random time in this range,
  linkMaxMs: 10000,    //   longer if the video is still loading
  playTimeoutMs: 2500, // a held video resumed but never reported `playing`: link anyway
  revealCapMs: 20000,  // video still not up this long after the hold: step aside
  linkedMs: 700,       // lines meet; the scene starts to clear
  dockMs: 4000,        // logo in the corner
  leaveMs: 900,        // corner logo fades
});

const AFTER = new Set(['skipped', 'docked', 'leaving', 'done']);
export const SCENE_PHASES = Object.freeze(['linking', 'linked', 'docked', 'leaving']);

/** A hold length in [min, max] ms. `random` is injectable for tests. */
export function pickLinkMs(timing = HANDOFF_TIMING, random = Math.random) {
  const min = timing.linkMinMs, max = Math.max(min, timing.linkMaxMs);
  return Math.round(min + random() * (max - min));
}

export function useProvenanceHandoff({
  getMediaEl, contentId, eligible, status, provenance, startSec = 0,
  timing = HANDOFF_TIMING, random = Math.random,
}) {
  const [phase, setPhase] = useState('pending');
  const [linkMs, setLinkMs] = useState(null);
  const phaseRef = useRef('pending');
  const timersRef = useRef([]);
  const boundRef = useRef({ el: null, off: null });
  const runRef = useRef(null); // the live scene's state, while linking
  const getMediaElRef = useRef(getMediaEl);
  getMediaElRef.current = getMediaEl;
  const liveRef = useRef({});
  liveRef.current = { status, provenance, timing, contentId, random };

  const go = (next) => { phaseRef.current = next; setPhase(next); };
  const clearTimers = () => { timersRef.current.forEach(clearTimeout); timersRef.current = []; };
  const after = (ms, fn) => { timersRef.current.push(setTimeout(fn, ms)); };
  const unbind = () => { boundRef.current.off?.(); boundRef.current = { el: null, off: null }; };

  // A new title starts over.
  useEffect(() => {
    go('pending');
    setLinkMs(null);
    return () => {
      clearTimers();
      unbind();
      const run = runRef.current;
      runRef.current = null;
      if (run?.pausedByUs) { try { run.el?.play?.()?.catch?.(() => {}); } catch (_) { /* ignore */ } }
      setProvenanceHolding(false);
    };
  }, [contentId]);

  // Nothing to show for this title: let the filter bumper go.
  useEffect(() => {
    if (phaseRef.current !== 'pending') return;
    const resume = Number(startSec) > HANDOFF_START_WINDOW_SEC;
    if (!eligible || resume || status === 'none' || status === 'failed') {
      if (resume && eligible) logger().debug('provenance.handoff.skipped', { contentId, reason: 'resume', startSec });
      go('skipped');
    }
  }, [eligible, status, startSec, contentId]);

  /** The lines meet: the film is playing. */
  const link = (by) => {
    const run = runRef.current;
    if (!run || run.linked) return;
    run.linked = true;
    unbind();
    setProvenanceHolding(false);
    go('linked');
    logger().debug('provenance.handoff.linked', { ...run.log, by, waitedMs: Date.now() - run.startedAt });
    const tm = liveRef.current.timing;
    after(tm.linkedMs, () => {
      go('docked');
      after(tm.dockMs, () => {
        go('leaving');
        after(tm.leaveMs, () => { go('done'); runRef.current = null; logger().debug('provenance.handoff.done', run.log); });
      });
    });
  };

  /** Step aside: the player's own screen takes over. */
  const abort = (reason) => {
    const run = runRef.current;
    if (!run || run.linked) return;
    run.linked = true;
    unbind();
    clearTimers();
    setProvenanceHolding(false);
    if (run.pausedByUs && run.el) { try { run.el.play()?.catch?.(() => {}); } catch (_) { /* ignore */ } }
    go('skipped');
    runRef.current = null;
    logger().warn('provenance.handoff.aborted', { ...run.log, reason });
  };

  /** Hold over and video ready: start it (if we held it) and link on `playing`. */
  const maybeLink = () => {
    const run = runRef.current;
    if (!run || run.linked || !run.holdDone || !run.videoReady) return;
    if (!run.pausedByUs) { link('ready'); return; }
    run.pausedByUs = false;
    run.resuming = true;
    try {
      const r = run.el.play();
      r?.catch?.((error) => logger().warn('provenance.handoff.resume-refused', { ...run.log, error: error?.message }));
    } catch (error) {
      logger().warn('provenance.handoff.resume-refused', { ...run.log, error: error?.message });
    }
    after(liveRef.current.timing.playTimeoutMs, () => link('timeout'));
  };

  // The provider is known: raise the scene over the loading player.
  useEffect(() => {
    if (phase !== 'pending' || status !== 'ready' || !provenance || !eligible) return;
    if (Number(startSec) > HANDOFF_START_WINDOW_SEC) return;
    const el = getMediaElRef.current?.() || null;
    if (el && el.paused === false && Number(el.currentTime) > LATE_START_SEC) {
      logger().info('provenance.handoff.skipped', { contentId, reason: 'late', at: +Number(el.currentTime).toFixed(2) });
      go('skipped');
      return;
    }
    const { timing: tm, random: rnd } = liveRef.current;
    const holdMs = pickLinkMs(tm, rnd);
    const run = {
      el: null, startedAt: Date.now(), holdDone: false, videoReady: false, pausedByUs: false, resuming: false, linked: false,
      log: { contentId, provider: provenance.provider, tier: provenance.tier, holdMs },
    };
    runRef.current = run;
    setLinkMs(holdMs);
    setProvenanceHolding(true);
    go('linking');
    logger().info('provenance.handoff.shown', run.log);
    after(holdMs, () => { run.holdDone = true; maybeLink(); });
    after(holdMs + tm.revealCapMs, () => { if (!run.videoReady) abort('video-not-ready'); });
  }, [phase, status, provenance, eligible, startSec, contentId]);

  // While the scene is up: watch the (current) video element for its first frame.
  useEffect(() => {
    const run = runRef.current;
    const el = (phase === 'linking' && run && !run.linked) ? (getMediaElRef.current?.() || null) : null;
    if (el === boundRef.current.el) return;
    unbind();
    if (!el) return;
    run.el = el;
    const onPlaying = () => {
      const r = runRef.current;
      if (!r || r.linked) return;
      if (r.resuming) { link('playing'); return; }
      if (Number(el.currentTime) > HANDOFF_START_WINDOW_SEC) { abort('resume'); return; }
      r.videoReady = true;
      if (!r.holdDone) {
        // Ready before the hold is over: wait on the first frame behind the scene.
        try { el.pause(); r.pausedByUs = true; } catch (_) { /* ignore */ }
        return;
      }
      link('playing');
    };
    el.addEventListener('playing', onPlaying);
    boundRef.current = { el, off: () => el.removeEventListener('playing', onPlaying) };
    if (el.paused === false && el.readyState > 2) onPlaying();
  });

  return { phase, afterHandoff: AFTER.has(phase), linkMs };
}
