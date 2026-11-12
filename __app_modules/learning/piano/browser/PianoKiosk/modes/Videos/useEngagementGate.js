import { useState, useEffect, useRef, useCallback } from 'react';
import getLogger from '../../../../../../../frontend/src/lib/logging/Logger.js';
import { checkInStep, GOOD_FAITH_DEFAULTS } from '../../../../portable/practice/goodFaith.mjs';
import { burstState } from '../../../../portable/practice/practiceScore.mjs';
import { CHECK_IN_GRACE_MS } from './useLessonPractice.js';

let _logger;
function logger() {
  if (!_logger) _logger = getLogger().child({ component: 'piano-engagement-gate' });
  return _logger;
}

/** Ambiguous bursts get a model answer at this probability or above. */
export const LADDER_LEGIT_P = 0.7;

/**
 * Anti-AFK inactivity gate for sequential piano lectures. When no HUMAN note is
 * played for `timeoutSeconds` while a sequential lecture plays, pauses the video
 * and opens the gate. The parent shows a play-along prompt and calls dismissGate()
 * on success to resume. No-op when isSequential is false.
 *
 * pause/play/isPaused should come from usePlayerController (ctrl.pause, ctrl.play,
 * () => !isPlaying) — NOT from mediaEl directly, which bypasses the Player's API.
 *
 * `humanNoteAt` (from useHumanNotes) is the time of the last note a PERSON
 * played. The idle clock deliberately does not watch activeNotes: the piano's
 * rhythm/drum loop streams notes there too, and while it ran the prompt never
 * appeared (ops:docs/_wip/audits/2026-11-12-piano-lesson-engagement-audit.md §8.1).
 *
 * THE LADDER (2026-11-12). A check-in that comes round again with no real
 * playing since the last answer asks for more: one note, then one scale, then
 * two (the policy's cap; preschool courses never leave the note). "Real
 * playing" is ≥ `realPlayingNotes` LEGIT notes since the answer (+3 s) —
 * `burstSince` labels the burst legit / spam / ambiguous; only an ambiguous one
 * is sent to `judgeBurst` (async, never awaited by the video). Pending → the
 * ladder holds; fallback / disabled → benefit of the doubt (reset).
 */
export function useEngagementGate({
  pause, play, isPaused, isSequential, timeoutSeconds = 90, onEngagementConfirmed, humanNoteAt = 0,
  burstSince = null, judgeBurst = null, recordCheckIn = null, realPlayingNotes = GOOD_FAITH_DEFAULTS.realPlayingNotes,
  policy = GOOD_FAITH_DEFAULTS,
}) {
  const [gateOpen, setGateOpen] = useState(false);
  const [step, setStep] = useState({ kind: 'note' });
  const lastActivityRef = useRef(Date.now());
  const gateOpenRef = useRef(false);

  // Hosts pass fresh inline closures every render (PianoVideoPlayer re-renders
  // ~4x/second on timeupdate). If these sat in the poll effect's deps, the
  // interval would be torn down and recreated faster than its 1s period and the
  // tick would NEVER fire — the gate silently dies and a full unengaged
  // watch-through records engaged:false. Hold the latest callbacks in refs so
  // the interval's lifetime depends only on isSequential/timeoutSeconds.
  const pauseRef = useRef(pause);
  const isPausedRef = useRef(isPaused);
  pauseRef.current = pause;
  isPausedRef.current = isPaused;
  const ladderDeps = useRef({});
  ladderDeps.current = { burstSince, judgeBurst, recordCheckIn, realPlayingNotes, policy };

  // Ladder state for this sitting.
  const ladder = useRef({ consecutiveIdle: 0, lastAnsweredAt: null, checkIns: 0, judge: null });

  // A human-played note resets the idle timer (machine notes never reach here).
  useEffect(() => {
    if (!isSequential || !humanNoteAt) return;
    lastActivityRef.current = Date.now();
  }, [humanNoteAt, isSequential]);

  /** The burst since the last answer, and (once) a judge request for an ambiguous one. */
  const reviewBurst = useCallback(() => {
    const l = ladder.current;
    const d = ladderDeps.current;
    if (l.lastAnsweredAt == null || typeof d.burstSince !== 'function') return null;
    const b = d.burstSince(l.lastAnsweredAt + CHECK_IN_GRACE_MS);
    if (b?.verdict === 'ambiguous' && b.legitNotes >= d.realPlayingNotes && !l.judge && typeof d.judgeBurst === 'function') {
      const index = l.checkIns;
      l.judge = { index, status: 'pending', legit: null, probability: null, source: null };
      let call;
      try { call = Promise.resolve(d.judgeBurst({ kind: 'check-in', index, burst: burstState(b.events, b.stats) })); } catch (err) { call = Promise.reject(err); }
      call
        .then((res) => {
          if (ladder.current.judge?.index !== index) return;
          ladder.current.judge = { index, status: 'answered', legit: res?.legit ?? null, probability: res?.probability ?? null, source: res?.source ?? 'fallback' };
        })
        .catch(() => {
          if (ladder.current.judge?.index !== index) return;
          ladder.current.judge = { index, status: 'answered', legit: null, probability: null, source: 'fallback' };
        });
    }
    return b;
  }, []);

  // Poll once a second; open the gate when idle too long and the video is playing.
  useEffect(() => {
    if (!isSequential) return undefined;
    const id = setInterval(() => {
      if (gateOpenRef.current || isPausedRef.current?.()) return;
      reviewBurst();
      const idleMs = Date.now() - lastActivityRef.current;
      if (idleMs >= timeoutSeconds * 1000) {
        const l = ladder.current;
        const b = reviewBurst();
        let move = 'first';
        if (l.lastAnsweredAt != null) {
          if (!b || b.verdict === 'spam') move = 'up';
          else if (b.verdict === 'legit') move = 'reset';
          else if (l.judge?.status === 'answered') {
            move = l.judge.legit === false ? 'up' : 'reset'; // null (fallback/disabled) → benefit of the doubt
          } else if (l.judge?.status === 'pending') move = 'hold';
          else move = 'reset';
        }
        if (move === 'up') l.consecutiveIdle += 1;
        else if (move === 'reset' || move === 'first') {
          if (move === 'reset' && l.consecutiveIdle > 0) {
            logger().info('piano.engagement-gate.ladder-reset', {
              legitNotes: b?.legitNotes ?? 0, verdict: b?.verdict ?? null,
              probability: l.judge?.probability ?? null, source: l.judge?.source ?? null,
            });
          }
          l.consecutiveIdle = 0;
        } else {
          logger().info('piano.engagement-gate.ladder-hold', {
            legitNotes: b?.legitNotes ?? 0, verdict: b?.verdict ?? null, probability: null, source: 'pending',
          });
        }
        const next = checkInStep({ consecutiveIdle: l.consecutiveIdle }, ladderDeps.current.policy);
        l.checkIns += 1;
        gateOpenRef.current = true;
        setStep(next);
        setGateOpen(true);
        pauseRef.current?.();
        ladderDeps.current.recordCheckIn?.({ open: true, scales: next.kind === 'scales' ? next.count : 0 });
        logger().info('piano.engagement-gate.open', {
          idleMs, step: next.kind, scales: next.kind === 'scales' ? next.count : 0, consecutiveIdle: l.consecutiveIdle,
        });
      }
    }, 1000);
    return () => clearInterval(id);
  }, [isSequential, timeoutSeconds, reviewBurst]);

  const dismissGate = useCallback(() => {
    gateOpenRef.current = false;
    setGateOpen(false);
    lastActivityRef.current = Date.now();
    const l = ladder.current;
    l.lastAnsweredAt = Date.now();
    l.judge = null;
    ladderDeps.current.recordCheckIn?.({ open: false });
    if (isPaused?.()) play?.();
    logger().info('piano.engagement-gate.dismissed');
    onEngagementConfirmed?.();
  }, [isPaused, play, onEngagementConfirmed]);

  return { gateOpen, step, dismissGate };
}

export default useEngagementGate;
