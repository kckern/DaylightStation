import { useCallback, useEffect, useMemo, useRef } from 'react';
import { usePianoMidi } from '../../PianoMidiContext.jsx';
import { createHumanNoteClassifier, DEFAULTS as CLASSIFIER_DEFAULTS } from '../../humanNoteClassifier.js';
import { DaylightAPI } from '../../../../../../../frontend/src/lib/api.mjs';
import getLogger from '../../../../../../../frontend/src/lib/logging/Logger.js';
import {
  createPracticeMeter, classifyBurst, burstState, weighEvents, PRESCHOOL_PRACTICE, PRACTICE_DEFAULTS,
} from '../../../../portable/practice/practiceScore.mjs';
import {
  goodFaithScore, rawScore, isBorderline, GOOD_FAITH_DEFAULTS, PRESCHOOL_POLICY,
} from '../../../../portable/practice/goodFaith.mjs';

let _logger;
function logger() {
  if (!_logger) _logger = getLogger().child({ component: 'piano-lesson-practice' });
  return _logger;
}

/** A check-in's own answer (and the 3 s after it) is not practice. */
export const CHECK_IN_GRACE_MS = 3000;

function newSittingId() {
  const rnd = Math.random().toString(36).slice(2, 10);
  return `${Date.now().toString(36)}-${rnd}`;
}

/**
 * useLessonPractice — one lesson sitting's live practice tally on the kiosk.
 *
 * Classifies every note itself (humanNoteClassifier: drum loop, accompaniment,
 * clockwork are dropped), weighs human notes for how practice-like they are
 * (practiceScore; preschool courses are lenient), counts played seconds, and
 * reports the totals on every play/log. The running score is LOGGED, never
 * rendered. When playback crosses the watch threshold with a borderline score
 * it fires one non-awaited legitimacy question (minimal MIDI log only).
 */
export function useLessonPractice({
  enabled = true, isPlaying = false, targetNpm = null, preschool = false,
  thresholdPercent = 90, getPercent = null, userId = null, contentId = null,
} = {}) {
  const { subscribe } = usePianoMidi() || {};
  const sittingIdRef = useRef(null);
  if (!sittingIdRef.current) sittingIdRef.current = newSittingId();
  const weighOpts = preschool ? PRESCHOOL_PRACTICE : {};
  const policy = preschool ? PRESCHOOL_POLICY : GOOD_FAITH_DEFAULTS;

  const stateRef = useRef(null);
  if (!stateRef.current) {
    stateRef.current = {
      classifier: createHumanNoteClassifier(),
      meter: createPracticeMeter(weighOpts),
      held: new Map(),
      playedMs: 0,
      drillsPassed: 0,
      checkIns: 0,
      scaleCheckIns: 0,
      legitChecks: 0,
      checkInOpen: false,
      graceUntil: 0,
      judged: false,
    };
  }
  const live = useRef({});
  live.current = { isPlaying, targetNpm, getPercent, thresholdPercent, userId, contentId, preschool, policy };

  useEffect(() => {
    logger().info('piano.lesson-practice.sitting-start', {
      sittingId: sittingIdRef.current, contentId, targetNpm, preschool,
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps -- once per sitting

  useEffect(() => {
    if (!enabled || typeof subscribe !== 'function') return undefined;
    const s = stateRef.current;
    return subscribe((evt) => {
      if (evt?.type === 'note_on' && evt.velocity > 0) {
        const time = Number.isFinite(evt.time) ? evt.time : Date.now();
        const v = s.classifier.classify({ ...evt, time });
        if (v.transition === 'loop-on') {
          // The loop ran ~30 s before it was recognised: take its notes back.
          const pitches = s.classifier.loopPitches;
          const from = time - (CLASSIFIER_DEFAULTS.armMs + CLASSIFIER_DEFAULTS.windowMs + 5000);
          const removed = s.meter.retract((e) => e.t >= from && pitches.has(e.note));
          logger().info('piano.lesson-practice.loop-retracted', { sittingId: sittingIdRef.current, removed });
        }
        if (!v.human) return;
        if (s.checkInOpen || time < s.graceUntil) return;
        const added = s.meter.add({ t: time, note: evt.note, velocity: evt.velocity });
        if (added) s.held.set(evt.note, added);
      } else if (evt?.type === 'note_off' || (evt?.type === 'note_on' && !(evt.velocity > 0))) {
        const ev = s.held.get(evt.note);
        if (ev) {
          const time = Number.isFinite(evt.time) ? evt.time : Date.now();
          ev.durMs = Math.max(0, time - ev.t);
          s.held.delete(evt.note);
        }
      }
    });
  }, [enabled, subscribe]);

  const report = useCallback(() => {
    const s = stateRef.current;
    const t = s.meter.snapshot();
    return {
      sittingId: sittingIdRef.current,
      humanNotes: t.humanNotes,
      practiceNotes: Math.floor(t.practiceNotes),
      playedSec: Math.floor(s.playedMs / 1000),
      drillsPassed: s.drillsPassed,
      checkIns: s.checkIns,
      scaleCheckIns: s.scaleCheckIns,
      legitChecks: s.legitChecks,
      penalties: t.penalties,
    };
  }, []);

  const scoreOf = useCallback((r) => ({
    practiceNotes: r.practiceNotes, playedSec: r.playedSec, targetNpm: live.current.targetNpm,
  }), []);
  const runningScore = useCallback(() => {
    if (live.current.targetNpm == null) return null;
    return goodFaithScore(scoreOf(report()));
  }, [report, scoreOf]);

  const fireEndOfLesson = useCallback(() => {
    const s = stateRef.current;
    const { userId: uid, preschool: pre } = live.current;
    if (!uid) return;
    s.judged = true;
    s.legitChecks += 1;
    const recent = weighEvents(s.meter.since(0), pre ? PRESCHOOL_PRACTICE : {})
      .filter((e) => e.weight >= PRACTICE_DEFAULTS.legitWeight).slice(-200);
    const verdict = classifyBurst(recent, pre ? PRESCHOOL_PRACTICE : {});
    const body = {
      sittingId: sittingIdRef.current, kind: 'end-of-lesson', index: 0,
      burst: burstState(recent, verdict.stats), preschool: !!pre,
    };
    DaylightAPI(`api/v1/piano/users/${encodeURIComponent(uid)}/lesson-legit`, body)
      .then((res) => logger().info('piano.lesson-practice.judge-answer', { sittingId: sittingIdRef.current, kind: 'end-of-lesson', ...res }))
      .catch((err) => logger().warn('piano.lesson-practice.judge-failed', { sittingId: sittingIdRef.current, error: err?.message }));
  }, []);

  // One clock: played seconds while playing, the threshold crossing, and a
  // sampled snapshot for the log.
  useEffect(() => {
    if (!enabled) return undefined;
    const id = setInterval(() => {
      const s = stateRef.current;
      const l = live.current;
      if (l.isPlaying) s.playedMs += 1000;
      if (!s.judged && l.targetNpm != null && typeof l.getPercent === 'function') {
        const pct = Number(l.getPercent());
        if (Number.isFinite(pct) && pct >= l.thresholdPercent) {
          const raw = rawScore(scoreOf(report()));
          if (isBorderline(raw, l.policy)) fireEndOfLesson();
          else s.judged = true;
        }
      }
      const r = report();
      logger().sampled('piano.lesson-practice.snapshot', {
        sittingId: r.sittingId, contentId: l.contentId, humanNotes: r.humanNotes, practiceNotes: r.practiceNotes,
        playedSec: r.playedSec, runningScore: l.targetNpm == null ? null : goodFaithScore(scoreOf(r)),
      }, { maxPerMinute: 2, aggregate: false });
    }, 1000);
    return () => clearInterval(id);
  }, [enabled, fireEndOfLesson, report, scoreOf]);

  const setDrillsPassed = useCallback((n) => { stateRef.current.drillsPassed = Math.max(0, Math.floor(Number(n) || 0)); }, []);

  /** A check-in opened ({ open: true, scales }) or was answered ({ open: false }). */
  const recordCheckIn = useCallback(({ open = true, scales = 0 } = {}) => {
    const s = stateRef.current;
    if (open) {
      s.checkInOpen = true;
      s.checkIns += 1;
      if (scales > 0) s.scaleCheckIns += 1;
    } else {
      s.checkInOpen = false;
      s.graceUntil = Date.now() + CHECK_IN_GRACE_MS;
    }
  }, []);

  /** Human notes since `ms` (epoch), with the burst filter's verdict. */
  const burstSince = useCallback((ms) => {
    const events = stateRef.current.meter.since(ms);
    const c = classifyBurst(events, live.current.preschool ? PRESCHOOL_PRACTICE : {});
    return { events, verdict: c.verdict, legitNotes: c.legitNotes, retention: c.retention, stats: c.stats };
  }, []);

  const noteLegitCheck = useCallback(() => { stateRef.current.legitChecks += 1; }, []);

  return useMemo(() => ({
    sittingId: sittingIdRef.current,
    report, runningScore, setDrillsPassed, recordCheckIn, burstSince, noteLegitCheck,
  }), [report, runningScore, setDrillsPassed, recordCheckIn, burstSince, noteLegitCheck]);
}

export default useLessonPractice;
