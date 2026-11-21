/**
 * useProvenanceHandoff — runs the provenance handoff once per title, on the
 * first `playing` at or near the start (not on a resume), and only when the
 * provider is already known and its logo loaded. It never waits on the lookup:
 * a title whose answer is not in yet plays without a handoff, and the next play
 * has it.
 *
 * Phases:
 *   pending  -> waiting for the first play to decide
 *   linking  -> video held paused behind the scene; two lines reach toward the logo
 *   linked   -> play resumed; on its `playing` the lines meet (connection made)
 *   docked   -> scene dissolves, logo shrinks into the corner over the film
 *   leaving  -> corner logo fades
 *   done | skipped
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
export const HANDOFF_TIMING = Object.freeze({
  linkMinMs: 5000,     // lines reach in, dots pulse; video held for a random
  linkMaxMs: 10000,    //   time in this range, so it feels like a real connection
  playTimeoutMs: 2500, // resume did not report `playing`: link anyway
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

export function useProvenanceHandoff({ getMediaEl, contentId, eligible, status, provenance, timing = HANDOFF_TIMING, random = Math.random }) {
  const [phase, setPhase] = useState('pending');
  const [linkMs, setLinkMs] = useState(null);
  const decidedRef = useRef(false);
  const timersRef = useRef([]);
  const boundRef = useRef({ el: null, off: null });
  const runOffRef = useRef(null);
  const getMediaElRef = useRef(getMediaEl);
  getMediaElRef.current = getMediaEl;
  const liveRef = useRef({ status, provenance, timing, contentId, random });
  liveRef.current = { status, provenance, timing, contentId, random };

  const clearTimers = () => { timersRef.current.forEach(clearTimeout); timersRef.current = []; };
  const after = (ms, fn) => { timersRef.current.push(setTimeout(fn, ms)); };

  // A new title starts over.
  useEffect(() => {
    decidedRef.current = false;
    setPhase('pending');
    return () => {
      clearTimers();
      runOffRef.current?.();
      runOffRef.current = null;
      boundRef.current.off?.();
      boundRef.current = { el: null, off: null };
      setProvenanceHolding(false);
    };
  }, [contentId]);

  // Nothing to show for this title: let the filter bumper go.
  useEffect(() => {
    if (decidedRef.current) return;
    if (!eligible || status === 'none' || status === 'failed') {
      decidedRef.current = true;
      setPhase('skipped');
    }
  }, [eligible, status]);

  // After every commit: listen on the current element until the first play decides.
  useEffect(() => {
    const el = (!decidedRef.current && eligible) ? (getMediaElRef.current?.() || null) : null;
    if (el === boundRef.current.el) return;
    boundRef.current.off?.();
    boundRef.current = { el: null, off: null };
    if (!el) return;

    const run = (videoEl) => {
      const { provenance: p, timing: tm, random: rnd } = liveRef.current;
      const holdMs = pickLinkMs(tm, rnd);
      const log = { contentId: liveRef.current.contentId, provider: p.provider, tier: p.tier, holdMs };
      try { videoEl.pause(); } catch (_) { /* ignore */ }
      setProvenanceHolding(true);
      setLinkMs(holdMs);
      setPhase('linking');
      logger().info('provenance.handoff.shown', log);

      let linked = false;
      const link = (by) => {
        if (linked) return;
        linked = true;
        videoEl.removeEventListener('playing', onPlaying);
        setProvenanceHolding(false);
        setPhase('linked');
        logger().debug('provenance.handoff.linked', { ...log, by });
        after(tm.linkedMs, () => {
          setPhase('docked');
          after(tm.dockMs, () => {
            setPhase('leaving');
            after(tm.leaveMs, () => { setPhase('done'); logger().debug('provenance.handoff.done', log); });
          });
        });
      };
      // Someone else resumed early (a remote press): the connection is made now.
      const onPlaying = () => link('playing');
      videoEl.addEventListener('playing', onPlaying);
      runOffRef.current = () => videoEl.removeEventListener('playing', onPlaying);
      after(holdMs, () => {
        if (linked) return;
        try {
          const r = videoEl.play();
          r?.catch?.((error) => logger().warn('provenance.handoff.resume-refused', { ...log, error: error?.message }));
        } catch (error) {
          logger().warn('provenance.handoff.resume-refused', { ...log, error: error?.message });
        }
        after(tm.playTimeoutMs, () => link('timeout'));
      });
    };

    const check = () => {
      if (decidedRef.current) return;
      decidedRef.current = true;
      boundRef.current.off?.();
      boundRef.current = { el: null, off: null };
      const t = el.currentTime;
      const { status: st, provenance: p, contentId: id } = liveRef.current;
      if (!(Number.isFinite(t) && t <= HANDOFF_START_WINDOW_SEC)) {
        logger().debug('provenance.handoff.skipped', { contentId: id, reason: 'resume', at: Number.isFinite(t) ? +t.toFixed(2) : null });
        setPhase('skipped');
        return;
      }
      if (st !== 'ready' || !p) {
        logger().info('provenance.handoff.skipped', { contentId: id, reason: 'not-ready', status: st });
        setPhase('skipped');
        return;
      }
      run(el);
    };

    if (el.paused === false && el.readyState > 2) { check(); return; }
    el.addEventListener('playing', check);
    boundRef.current = { el, off: () => el.removeEventListener('playing', check) };
  });

  return { phase, afterHandoff: AFTER.has(phase), linkMs };
}
