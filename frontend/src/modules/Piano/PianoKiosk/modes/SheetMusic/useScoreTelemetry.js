import { useMemo, useRef, useCallback } from 'react';
import getLogger from '../../../../../lib/logging/Logger.js';
import { summarizeDrift, classifyFollowHit, stallThresholdMs } from './scoreTelemetry.js';

// The visual driver is a coarse setInterval at `tickMs` BY DESIGN (see
// useScoreTransport), so a gap of ~tickMs is healthy, not a stall. Only a gap
// that skipped whole ticks is worth a line. The old absolute 50ms budget could
// essentially never NOT fire: it produced 65,595 warnings in three days, 95% of
// them from this term alone, and drowned the log (audit H1).
const GAP_TICK_MULTIPLE = 2.5;
// Sched-late is a REAL condition, but 1,442 lines for one underlying problem is
// not information. Warn a handful per run; the full count ships in stats.
const SCHED_LATE_WARN_CAP = 5;

/**
 * useScoreTelemetry — owns one child logger and the per-run collectors for the
 * sheet-music player's logs-only telemetry. Callers feed it load phases, transport
 * fires, and follow hits; it emits the structured events (score.load,
 * score.playback.stall/stats, score.follow.timing/stats). Timing math lives in
 * scoreTelemetry.js; this layer only collects + emits.
 */
export function useScoreTelemetry({ id, tickMs = 100 }) {
  // app + sessionLog on the child context route every emitted event to the
  // backend per-app session file (media/logs/piano-sheetmusic/{ts}.jsonl). A
  // startSession() 'session-log.start' opens that file; all subsequent events
  // (load / follow / polish / focus / mode / transpose) land in the same run log.
  const logger = useMemo(() => getLogger().child({ component: 'piano-score-player', app: 'piano-sheetmusic', sessionLog: true }), []);
  const drifts = useRef([]);
  const gaps = useRef([]);
  const stalls = useRef(0);
  const follow = useRef([]);
  const leads = useRef([]);
  const stallMsRef = useRef(stallThresholdMs(90)); // latest tempo-scaled budget, for the flush
  const schedLateWarns = useRef(0);

  const startSession = useCallback((scoreId) => logger.info('session-log.start', { scoreId }), [logger]);

  const logLoad = useCallback((phases) => logger.info('score.load', { id, ...phases }), [logger, id]);
  const logLoadFailed = useCallback((phase, error) => logger.warn('score.load.failed', { id, phase, error }), [logger, id]);

  // Full sheet-music event catalog — one path per event so nothing double-logs.
  const logMeasureGrade = useCallback(({ measure, grade, noteScore, timingScore }) => logger.info('score.polish.measure', { measure, grade, noteScore, timingScore }), [logger]);
  const logRunSummary = useCallback(({ greens, yellows, reds, overall }) => logger.info('score.polish.summary', { greens, yellows, reds, overall }), [logger]);
  const logFocus = useCallback(({ kind, inMeasure, outMeasure }) => logger.info('score.focus.set', { kind, inMeasure, outMeasure }), [logger]);
  const logTranspose = useCallback(({ semitones }) => logger.info('score.transpose', { semitones }), [logger]);
  const logMode = useCallback(({ mode }) => logger.info('score.mode', { mode }), [logger]);

  /**
   * @param {number} effectiveBpm — the tempo the music is ACTUALLY playing at
   *   (written bpm x tempoMult), NOT the tempo on the page. The drift budget is
   *   a fraction of a beat, and a beat at 0.5x is twice as long, so the written
   *   bpm would size the budget to a beat that isn't happening.
   */
  const recordFire = useCallback((ev, driftMs, gapMs, effectiveBpm) => {
    drifts.current.push(driftMs); gaps.current.push(gapMs);
    const stallMs = stallThresholdMs(effectiveBpm);
    stallMsRef.current = stallMs; // flushPlayback must count stalls by the same rule
    if (driftMs >= stallMs || gapMs >= tickMs * GAP_TICK_MULTIPLE) {
      stalls.current += 1;
      // debug, not warn: on a genuinely bad run this fires per tick. The count
      // lives in score.playback.stats; turn these on with
      // window.DAYLIGHT_LOG_LEVEL='debug' when investigating.
      logger.debug('score.playback.stall', {
        step: ev.step ?? ev.index,
        driftMs: Math.round(driftMs), gapMs: Math.round(gapMs),
        // effectiveBpm, not bpm: this is tempo-adjusted and will NOT match the
        // `bpm` on score.transport.play (which logs the written tempo + its
        // tempoMult separately). Don't compare the two fields directly.
        effectiveBpm, stallMs: Math.round(stallMs),
      });
    }
  }, [logger, tickMs]);

  const recordSchedule = useCallback((ev, leadMs) => {
    leads.current.push(leadMs);
    // A negative lead means the tick woke later than the event's due time — the
    // note was sent with a past timestamp (dispatches immediately, audibly late).
    if (leadMs < 0 && schedLateWarns.current < SCHED_LATE_WARN_CAP) {
      schedLateWarns.current += 1;
      logger.warn('score.playback.sched-late', { note: ev.note, leadMs: Math.round(leadMs) });
    }
  }, [logger]);

  const flushPlayback = useCallback((mode) => {
    // A run that never fired and never scheduled has nothing to report. Mode
    // changes, Restart, view changes and unmount all call this unconditionally;
    // without the guard 22% of stats records were empty (audit M4).
    if (!drifts.current.length && !leads.current.length) return;
    const d = summarizeDrift(drifts.current, { stallMs: stallMsRef.current });
    const l = leads.current;
    const meanLeadMs = l.length ? Math.round(l.reduce((a, b) => a + b, 0) / l.length) : 0;
    logger.info('score.playback.stats', {
      mode, events: d.count,
      meanDriftMs: Math.round(d.meanDriftMs), p95DriftMs: Math.round(d.p95DriftMs), maxDriftMs: Math.round(d.maxDriftMs),
      stalls: stalls.current, maxFrameGapMs: Math.round(Math.max(0, ...gaps.current, 0)),
      scheduled: l.length, meanLeadMs,
      minLeadMs: l.length ? Math.round(Math.min(...l)) : 0,
      schedLate: l.filter((x) => x < 0).length,
    });
    drifts.current = []; gaps.current = []; stalls.current = 0; leads.current = [];
    schedLateWarns.current = 0;
  }, [logger]);

  const recordFollowHit = useCallback(({ step, note, expectedMs, actualMs }) => {
    const c = classifyFollowHit({ expectedMs, actualMs });
    follow.current.push(c.driftMs);
    logger.sampled('score.follow.timing', { step, note, expectedMs: Math.round(expectedMs), actualMs: Math.round(actualMs), driftMs: c.driftMs, feel: c.feel }, { maxPerMinute: 20, aggregate: true });
  }, [logger]);

  const flushFollow = useCallback((hits, wrongs) => {
    const abs = follow.current.map(Math.abs);
    const mean = abs.length ? abs.reduce((a, b) => a + b, 0) / abs.length : 0;
    logger.info('score.follow.stats', {
      hits, wrongs, meanAbsDriftMs: Math.round(mean),
      rushPct: pct(follow.current, (x) => x < -25), dragPct: pct(follow.current, (x) => x > 25),
    });
    follow.current = [];
  }, [logger]);

  return { logger, startSession, logLoad, logLoadFailed, recordFire, recordSchedule, flushPlayback, recordFollowHit, flushFollow, logMeasureGrade, logRunSummary, logFocus, logTranspose, logMode };
}

function pct(arr, pred) { return arr.length ? Math.round((arr.filter(pred).length / arr.length) * 100) : 0; }

export default useScoreTelemetry;
