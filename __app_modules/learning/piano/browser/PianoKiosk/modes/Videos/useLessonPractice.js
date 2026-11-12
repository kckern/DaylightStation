import { useCallback, useEffect, useMemo, useRef } from 'react';
import { usePianoMidi } from '../../PianoMidiContext.jsx';
import { createHumanNoteClassifier, DEFAULTS as CLASSIFIER_DEFAULTS } from '../../humanNoteClassifier.js';
import getLogger from '../../../../../../../frontend/src/lib/logging/Logger.js';
import { createPracticeMeter, classifyBurst, PRESCHOOL_PRACTICE } from '../../../../portable/practice/practiceScore.mjs';
import { sittingGoodFaithState } from '../../../../portable/practice/sittingGoodFaith.mjs';

let _logger;
function logger() {
  if (!_logger) _logger = getLogger().child({ component: 'piano-lesson-practice' });
  return _logger;
}

/** A check-in's own answer (and the 3 s after it) is not practice. */
export const CHECK_IN_GRACE_MS = 3000;
/** Notes kept for the sitting's good-faith log (a long, busy lesson stays well under). */
const LOG_CAP = 8000;

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
 * reports the totals on every play/log. Nothing is rendered.
 *
 * Past the watch threshold, an enforced lesson's report also carries the
 * sitting's good-faith state (sittingGoodFaith: practice-like notes, notes per
 * minute, lesson facts, the presence check-ins and how they were answered —
 * a minimal MIDI log, nothing else). The server asks the session-level judge
 * once per sitting from that post, while the child is still watching.
 */
export function useLessonPractice({
  enabled = true, isPlaying = false, enforced = false, preschool = false,
  thresholdPercent = 90, getPercent = null, getDurationSec = null, contentId = null,
} = {}) {
  const { subscribe } = usePianoMidi() || {};
  const sittingIdRef = useRef(null);
  if (!sittingIdRef.current) sittingIdRef.current = newSittingId();
  const weighOpts = preschool ? PRESCHOOL_PRACTICE : {};

  const stateRef = useRef(null);
  if (!stateRef.current) {
    stateRef.current = {
      classifier: createHumanNoteClassifier(),
      meter: createPracticeMeter(weighOpts),
      held: new Map(),
      log: [],
      checkInLog: [],
      startMs: Date.now(),
      playedMs: 0,
      drillsPassed: 0,
      checkIns: 0,
      scaleCheckIns: 0,
      legitChecks: 0,
      checkInOpen: false,
      graceUntil: 0,
      crossed: false,
    };
  }
  const live = useRef({});
  live.current = { isPlaying, enforced, getPercent, getDurationSec, thresholdPercent, contentId, preschool };

  useEffect(() => {
    logger().info('piano.lesson-practice.sitting-start', {
      sittingId: sittingIdRef.current, contentId, enforced, preschool,
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
          const loopNote = (e) => e.t >= from && pitches.has(e.note);
          const removed = s.meter.retract(loopNote);
          s.log = s.log.filter((e) => !loopNote(e));
          logger().info('piano.lesson-practice.loop-retracted', { sittingId: sittingIdRef.current, removed });
        }
        if (!v.human) return;
        if (s.checkInOpen || time < s.graceUntil) return;
        const added = s.meter.add({ t: time, note: evt.note, velocity: evt.velocity });
        if (added) {
          s.held.set(evt.note, added);
          if (s.log.length < LOG_CAP) s.log.push(added);
        }
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

  const pastThreshold = useCallback(() => {
    const l = live.current;
    if (!l.enforced || typeof l.getPercent !== 'function') return false;
    const pct = Number(l.getPercent());
    return Number.isFinite(pct) && pct >= l.thresholdPercent;
  }, []);

  /** The sitting's good-faith state (sittingGoodFaith) — the minimal MIDI log. */
  const goodFaithState = useCallback(() => {
    const s = stateRef.current;
    const l = live.current;
    const lessonSec = Number(typeof l.getDurationSec === 'function' ? l.getDurationSec() : 0) || 0;
    return sittingGoodFaithState({
      events: s.log, startMs: s.startMs, lessonSec, watchedSec: Math.floor(s.playedMs / 1000),
      checkIns: s.checkInLog, preschool: !!l.preschool,
    });
  }, []);

  const report = useCallback(() => {
    const s = stateRef.current;
    const t = s.meter.snapshot();
    const out = {
      sittingId: sittingIdRef.current,
      humanNotes: t.humanNotes,
      practiceNotes: Math.floor(t.practiceNotes),
      playedSec: Math.floor(s.playedMs / 1000),
      drillsPassed: s.drillsPassed,
      checkIns: s.checkIns,
      checkInsAnswered: s.checkInLog.filter((c) => c.answered).length,
      scaleCheckIns: s.scaleCheckIns,
      legitChecks: s.legitChecks,
      penalties: t.penalties,
    };
    if (pastThreshold()) out.goodFaith = goodFaithState();
    return out;
  }, [pastThreshold, goodFaithState]);

  // One clock: played seconds while playing, the threshold crossing, and a
  // sampled snapshot for the log.
  useEffect(() => {
    if (!enabled) return undefined;
    const id = setInterval(() => {
      const s = stateRef.current;
      const l = live.current;
      if (l.isPlaying) s.playedMs += 1000;
      const t = s.meter.snapshot();
      if (!s.crossed && pastThreshold()) {
        s.crossed = true;
        logger().info('piano.lesson-practice.threshold', {
          sittingId: sittingIdRef.current, contentId: l.contentId, humanNotes: t.humanNotes,
          practiceNotes: Math.floor(t.practiceNotes), logNotes: s.log.length, checkIns: s.checkIns,
          playedSec: Math.floor(s.playedMs / 1000),
        });
      }
      logger().sampled('piano.lesson-practice.snapshot', {
        sittingId: sittingIdRef.current, contentId: l.contentId, humanNotes: t.humanNotes,
        practiceNotes: Math.floor(t.practiceNotes), playedSec: Math.floor(s.playedMs / 1000),
      }, { maxPerMinute: 2, aggregate: false });
    }, 1000);
    return () => clearInterval(id);
  }, [enabled, pastThreshold]);

  const setDrillsPassed = useCallback((n) => { stateRef.current.drillsPassed = Math.max(0, Math.floor(Number(n) || 0)); }, []);

  /** A check-in opened ({ open: true, scales }) or was answered ({ open: false }). */
  const recordCheckIn = useCallback(({ open = true, scales = 0 } = {}) => {
    const s = stateRef.current;
    if (open) {
      s.checkInOpen = true;
      s.checkIns += 1;
      if (scales > 0) s.scaleCheckIns += 1;
      s.checkInLog.push({ atMs: Date.now() - s.startMs, scales, answered: false });
    } else {
      s.checkInOpen = false;
      s.graceUntil = Date.now() + CHECK_IN_GRACE_MS;
      const last = s.checkInLog[s.checkInLog.length - 1];
      if (last) last.answered = true;
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
    report, setDrillsPassed, recordCheckIn, burstSince, noteLegitCheck,
  }), [report, setDrillsPassed, recordCheckIn, burstSince, noteLegitCheck]);
}

export default useLessonPractice;
