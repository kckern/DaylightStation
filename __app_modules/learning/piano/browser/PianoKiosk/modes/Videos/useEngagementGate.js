import { useState, useEffect, useRef, useCallback } from 'react';
import getLogger from '../../../../../../../frontend/src/lib/logging/Logger.js';
import {
  ladderConfig, classifyInterval, nextRung, intervalSecondsFor, checkInStepFor,
} from '../../../../portable/practice/presenceLadder.mjs';
import { burstState } from '../../../../portable/practice/practiceScore.mjs';
import { CHECK_IN_GRACE_MS } from './useLessonPractice.js';

const DEFAULT_LADDER = ladderConfig();

let _logger;
function logger() {
  if (!_logger) _logger = getLogger().child({ component: 'piano-engagement-gate' });
  return _logger;
}

/** Ambiguous bursts get a model answer at this probability or above. */
export const LADDER_LEGIT_P = 0.7;

/**
 * Anti-AFK inactivity gate for sequential piano lectures. When no HUMAN note is
 * played for the current rung's interval while a sequential lecture plays,
 * pauses the video and opens the gate. The parent shows a play-along prompt and
 * calls dismissGate() on success to resume. No-op when isSequential is false.
 *
 * pause/play/isPaused should come from usePlayerController (ctrl.pause, ctrl.play,
 * () => !isPlaying) — NOT from mediaEl directly, which bypasses the Player's API.
 *
 * `humanNoteAt` (from useHumanNotes) is the time of the last note a PERSON
 * played. The idle clock deliberately does not watch activeNotes: the piano's
 * rhythm/drum loop streams notes there too, and while it ran the prompt never
 * appeared (ops:docs/_wip/audits/2026-11-12-piano-lesson-engagement-audit.md §8.1).
 *
 * THE PRESENCE LADDER (2026-11-13; rules in portable/practice/presenceLadder.mjs).
 * Each check-in classifies the playing since the last answer (+3 s, so the
 * answer's own notes never count) as practice / partial / none / hold:
 * practice drops to the one-note step, partial steps down one rung, none climbs
 * one (note → one scale → two scales R then L → a hands-together scale → two),
 * hold (the burst judge is still thinking) keeps the rung. The wait before the
 * next check-in tightens with the rung (`ladder.intervalsSeconds`). Every
 * sitting (each mount of a lesson video) starts at the note (owner, 2026-11-13:
 * the run resets on each lesson video). `burstSince` labels the burst
 * legit / spam / ambiguous; only an ambiguous one is sent to `judgeBurst`
 * (async, never awaited by the video). Preschool ladders never leave the note.
 */
export function useEngagementGate({
  pause, play, isPaused, isSequential, ladder = DEFAULT_LADDER, onEngagementConfirmed, humanNoteAt = 0,
  burstSince = null, judgeBurst = null, recordCheckIn = null,
}) {
  const [gateOpen, setGateOpen] = useState(false);
  const [step, setStep] = useState({ kind: 'note', rung: 0 });
  const lastActivityRef = useRef(Date.now());
  const gateOpenRef = useRef(false);

  // Hosts pass fresh inline closures every render (PianoVideoPlayer re-renders
  // ~4x/second on timeupdate). If these sat in the poll effect's deps, the
  // interval would be torn down and recreated faster than its 1s period and the
  // tick would NEVER fire — the gate silently dies and a full unengaged
  // watch-through records engaged:false. Hold the latest callbacks (and the
  // ladder config, read for the current rung's interval on every tick) in refs
  // so the interval's lifetime depends only on isSequential.
  const pauseRef = useRef(pause);
  const isPausedRef = useRef(isPaused);
  pauseRef.current = pause;
  isPausedRef.current = isPaused;
  const ladderDeps = useRef({});
  ladderDeps.current = { burstSince, judgeBurst, recordCheckIn, cfg: ladder || DEFAULT_LADDER };

  // Ladder state for this sitting: always starts at the note.
  const ladderRef = useRef({ rung: 0, lastAnsweredAt: null, checkIns: 0, judge: null, scalesAsked: 0, minimal: 0, topLogged: false });

  // A human-played note resets the idle timer (machine notes never reach here).
  useEffect(() => {
    if (!isSequential || !humanNoteAt) return;
    lastActivityRef.current = Date.now();
  }, [humanNoteAt, isSequential]);

  /** The burst since the last answer, and (once) a judge request for an ambiguous one. */
  const reviewBurst = useCallback(() => {
    const l = ladderRef.current;
    const d = ladderDeps.current;
    if (l.lastAnsweredAt == null || typeof d.burstSince !== 'function') return null;
    const b = d.burstSince(l.lastAnsweredAt + CHECK_IN_GRACE_MS);
    if (b?.verdict === 'ambiguous' && b.legitNotes >= d.cfg.partialNotes && !l.judge && typeof d.judgeBurst === 'function') {
      const index = l.checkIns;
      l.judge = { index, status: 'pending', legit: null, probability: null, source: null };
      let call;
      try { call = Promise.resolve(d.judgeBurst({ kind: 'check-in', index, burst: burstState(b.events, b.stats) })); } catch (err) { call = Promise.reject(err); }
      call
        .then((res) => {
          if (ladderRef.current.judge?.index !== index) return;
          ladderRef.current.judge = { index, status: 'answered', legit: res?.legit ?? null, probability: res?.probability ?? null, source: res?.source ?? 'fallback' };
        })
        .catch(() => {
          if (ladderRef.current.judge?.index !== index) return;
          ladderRef.current.judge = { index, status: 'answered', legit: null, probability: null, source: 'fallback' };
        });
    }
    return b;
  }, []);

  /** Classify the interval since the last answer: 'first' before any answer. */
  const evidenceNow = useCallback((b) => {
    const l = ladderRef.current;
    if (l.lastAnsweredAt == null) return { evidence: 'first', intervalMs: null };
    const intervalMs = Date.now() - (l.lastAnsweredAt + CHECK_IN_GRACE_MS);
    const evidence = classifyInterval({
      legitNotes: b?.legitNotes ?? 0, verdict: b?.verdict ?? null, intervalMs, judge: l.judge,
    }, ladderDeps.current.cfg);
    return { evidence, intervalMs };
  }, []);

  /** Open a check-in: move the rung on the evidence, ask the rung's step. */
  const openCheckIn = useCallback((idleMs, reason) => {
    const l = ladderRef.current;
    const cfg = ladderDeps.current.cfg;
    const b = reviewBurst();
    const { evidence, intervalMs } = evidenceNow(b);
    const from = l.rung;
    const to = evidence === 'first' ? 0 : nextRung(from, evidence, cfg);
    if (evidence === 'hold') {
      logger().info('piano.engagement-gate.ladder-hold', {
        rung: from, legitNotes: b?.legitNotes ?? 0, verdict: b?.verdict ?? null, probability: null, source: 'pending',
      });
    }
    if (to !== from) {
      const legitNotes = b?.legitNotes ?? 0;
      logger().info('piano.engagement-gate.rung', {
        from, to, evidence, legitNotes, intervalMs,
        ratePerMin: intervalMs > 0 ? Math.round((legitNotes / (intervalMs / 60000)) * 10) / 10 : null,
      });
      const before = intervalSecondsFor(from, cfg);
      const after = intervalSecondsFor(to, cfg);
      if (before !== after) logger().info('piano.engagement-gate.interval', { rung: to, seconds: after });
    }
    l.rung = to;
    const minimal = evidence === 'none';
    if (minimal) l.minimal += 1;
    const next = checkInStepFor(to, { scaleIndex: l.scalesAsked }, cfg);
    if (next.kind === 'scales') l.scalesAsked += next.count; // rotation for the drill roots
    l.checkIns += 1;
    if (cfg.topRung > 0 && to === cfg.topRung && !l.topLogged) {
      l.topLogged = true;
      logger().info('piano.engagement-gate.top-rung', { checkIns: l.checkIns, minimal: l.minimal });
    }
    gateOpenRef.current = true;
    setStep(next);
    setGateOpen(true);
    pauseRef.current?.();
    const scales = next.kind === 'scales' ? next.count : 0;
    ladderDeps.current.recordCheckIn?.({ open: true, scales, rung: to, minimal });
    logger().info('piano.engagement-gate.open', {
      idleMs, reason, step: next.kind, scales, rung: to, minimal, evidence,
    });
  }, [reviewBurst, evidenceNow]);

  // Poll once a second; open the gate when idle for the rung's interval and the video is playing.
  useEffect(() => {
    if (!isSequential) return undefined;
    const id = setInterval(() => {
      if (gateOpenRef.current || isPausedRef.current?.()) return;
      reviewBurst();
      const l = ladderRef.current;
      const intervalMs = intervalSecondsFor(l.rung, ladderDeps.current.cfg) * 1000;
      const idleMs = Date.now() - lastActivityRef.current;
      if (idleMs >= intervalMs) openCheckIn(idleMs, 'idle');
    }, 1000);
    return () => clearInterval(id);
  }, [isSequential, reviewBurst, openCheckIn]);

  const dismissGate = useCallback(() => {
    gateOpenRef.current = false;
    setGateOpen(false);
    lastActivityRef.current = Date.now();
    const l = ladderRef.current;
    l.lastAnsweredAt = Date.now();
    l.judge = null;
    ladderDeps.current.recordCheckIn?.({ open: false });
    if (isPaused?.()) play?.();
    logger().info('piano.engagement-gate.dismissed', { rung: l.rung });
    onEngagementConfirmed?.();
  }, [isPaused, play, onEngagementConfirmed]);

  return { gateOpen, step, dismissGate };
}

export default useEngagementGate;
