import { useMemo, useRef, useCallback } from 'react';
import getLogger from '../../../../../lib/logging/Logger.js';
import { summarizeDrift, classifyFollowHit } from './scoreTelemetry.js';

const STALL_MS = 120;
const FRAME_GAP_MS = 50;

/**
 * useScoreTelemetry — owns one child logger and the per-run collectors for the
 * sheet-music player's logs-only telemetry. Callers feed it load phases, transport
 * fires, and follow hits; it emits the structured events (score.load,
 * score.playback.stall/stats, score.follow.timing/stats). Timing math lives in
 * scoreTelemetry.js; this layer only collects + emits.
 */
export function useScoreTelemetry({ id }) {
  const logger = useMemo(() => getLogger().child({ component: 'piano-score-player' }), []);
  const drifts = useRef([]);
  const gaps = useRef([]);
  const stalls = useRef(0);
  const follow = useRef([]);

  const logLoad = useCallback((phases) => logger.info('score.load', { id, ...phases }), [logger, id]);
  const logLoadFailed = useCallback((phase, error) => logger.warn('score.load.failed', { id, phase, error }), [logger, id]);

  const recordFire = useCallback((ev, driftMs, gapMs, bpm) => {
    drifts.current.push(driftMs); gaps.current.push(gapMs);
    if (driftMs >= STALL_MS || gapMs >= FRAME_GAP_MS) {
      stalls.current += 1;
      logger.warn('score.playback.stall', { step: ev.step ?? ev.index, driftMs: Math.round(driftMs), gapMs: Math.round(gapMs), bpm });
    }
  }, [logger]);

  const flushPlayback = useCallback((mode) => {
    const d = summarizeDrift(drifts.current, { stallMs: STALL_MS });
    logger.info('score.playback.stats', {
      mode, events: d.count,
      meanDriftMs: Math.round(d.meanDriftMs), p95DriftMs: Math.round(d.p95DriftMs), maxDriftMs: Math.round(d.maxDriftMs),
      stalls: stalls.current, maxFrameGapMs: Math.round(Math.max(0, ...gaps.current, 0)),
    });
    drifts.current = []; gaps.current = []; stalls.current = 0;
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

  return { logLoad, logLoadFailed, recordFire, flushPlayback, recordFollowHit, flushFollow };
}

function pct(arr, pred) { return arr.length ? Math.round((arr.filter(pred).length / arr.length) * 100) : 0; }

export default useScoreTelemetry;
