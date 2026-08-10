import { useMemo, useRef, useCallback } from 'react';
import getLogger from '../../../../../lib/logging/Logger.js';
import { summarizeDrift, stallThresholdMs, summarizeStepIntervals } from './scoreTelemetry.js';

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
  //
  // `scoreId` names the score ON THE CONTEXT, so the session-log.start the child
  // logger auto-emits at mount (Logger.js:218) already carries it. Without it the
  // id reached the log only via score.load — which is emitted from onReady, and
  // MusicXmlRenderer fires onReady only on a SUCCESSFUL extraction. A failed or
  // abandoned engrave therefore produced a session with events and no attributable
  // score (24 score.load events for 27 field score opens), and those are precisely
  // the sessions worth reading (audit H6).
  //
  // It is a live GETTER over a ref rather than a plain value because the logger
  // identity must stay stable for the life of the component (memo deps []): a
  // churning identity re-fires the renderer's onLayout/onReady — an infinite
  // re-engrave loop (see ScorePlayer's note) — and every freshly created sessionLog
  // child auto-opens ANOTHER session file. Logger.child() spreads its context at
  // EMIT time, so a stable object with a getter reports the CURRENT score on every
  // event, including the fresh start a subsequent document opens.
  const idRef = useRef(id);
  idRef.current = id;
  const logger = useMemo(() => getLogger().child({
    component: 'piano-score-player',
    app: 'piano-sheetmusic',
    sessionLog: true,
    get scoreId() { return idRef.current; },
  }), []); // eslint-disable-line react-hooks/exhaustive-deps
  const drifts = useRef([]);
  const gaps = useRef([]);
  const stalls = useRef(0);
  const follow = useRef([]);
  const leads = useRef([]);
  const stallMsRef = useRef(stallThresholdMs(90)); // latest tempo-scaled budget, for the flush
  const schedLateWarns = useRef(0);

  const startSession = useCallback((scoreId) => logger.info('session-log.start', { scoreId }), [logger]);

  const logLoad = useCallback((phases) => logger.info('score.load', { id, ...phases }), [logger, id]);
  // No load-failure emitter here BY DESIGN: the XML fetch lives in SheetMusic.jsx's
  // NotationScore, and a failed fetch renders PianoEmpty instead of ScorePlayer, so
  // this hook never mounts on that path. The old `logLoadFailed` was therefore
  // unreachable and 'score.load.failed' was never once emitted in three days of
  // field logs (audit L2). The failure is logged at its real site instead, tagged
  // into this same session log.

  // Full sheet-music event catalog — one path per event so nothing double-logs.
  const logMeasureGrade = useCallback(({
    measure, grade, noteScore, timingScore, expectedCount, matchedCount, wrongCount,
  }) => logger.info('score.polish.measure', {
    measure, grade, noteScore, timingScore, expectedCount, matchedCount, wrongCount,
  }), [logger]);
  // `score`/`tier`/`mixed` are the tempo-tier outcome (wave-3 H). They are ALWAYS
  // emitted, defaulted rather than omitted: a reader has to be able to tell "this
  // run had no score" from "this build did not report scores". `score` is the
  // displayed value (overclocked extra credit already applied), `tier` the tempo
  // tier captured at run START, `mixed` true when a mid-run tempo change voided it.
  const logRunSummary = useCallback(({ greens, yellows, reds, overall, score = null, tier = null, mixed = false }) => logger.info('score.polish.summary', { greens, yellows, reds, overall, score, tier, mixed }), [logger]);
  const logFocus = useCallback(({ kind, inMeasure, outMeasure, origin }) => logger.info('score.focus.set', { kind, inMeasure, outMeasure, origin }), [logger]);
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

  // Learn is self-paced, so there is nothing to be late FOR: `sinceAdvanceMs` is
  // how long the player took to answer the cursor, reported raw. The old shape
  // classified it against the written note duration (~94ms), which made every
  // human response a `drag` and `tight` unreachable — 24 of 31 field records were
  // `drag`, up to 47s (audit M5b). No verdict is emitted now.
  const recordFollowHit = useCallback(({ step, note, sinceAdvanceMs }) => {
    follow.current.push(sinceAdvanceMs);
    logger.sampled('score.follow.timing', { step, note, sinceAdvanceMs: Math.round(sinceAdvanceMs) }, { maxPerMinute: 20, aggregate: true });
  }, [logger]);

  const flushFollow = useCallback((hits, wrongs) => {
    const s = summarizeStepIntervals(follow.current);
    logger.info('score.follow.stats', { hits, wrongs, ...s });
    follow.current = [];
  }, [logger]);

  return { logger, startSession, logLoad, recordFire, recordSchedule, flushPlayback, recordFollowHit, flushFollow, logMeasureGrade, logRunSummary, logFocus, logTranspose, logMode };
}

export default useScoreTelemetry;
