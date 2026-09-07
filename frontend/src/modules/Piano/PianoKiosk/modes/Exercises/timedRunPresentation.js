const TERMINAL = new Set(['completed', 'aborted', 'timeout', 'error']);

// Expectations are compiled by assessmentSession: tempo entries are ordered,
// positive and deduplicated, and a timed expectation has a tempo at quarter 0.
function millisecondsAt(map, quarter) {
  let milliseconds = 0;
  for (let i = 0; i < map.length; i += 1) {
    const start = map[i].onsetQuarter;
    if (quarter <= start) break;
    const end = Math.min(quarter, map[i + 1]?.onsetQuarter ?? quarter);
    milliseconds += (end - start) * 60000 / map[i].bpm;
  }
  return milliseconds;
}

function positionAt(map, milliseconds) {
  let remaining = milliseconds;
  for (let i = 0; i < map.length; i += 1) {
    const entry = map[i];
    const next = map[i + 1];
    const lengthMs = next ? (next.onsetQuarter - entry.onsetQuarter) * 60000 / entry.bpm : Infinity;
    if (remaining < lengthMs) return { quarter: entry.onsetQuarter + remaining * entry.bpm / 60000, bpm: entry.bpm };
    remaining -= lengthMs;
  }
  return { quarter: 0, bpm: null };
}

/**
 * Clock-only presentation for a compiled timed assessment snapshot.
 *
 * `nowMs` must use the same clock as `startedAt`. `elapsedMs` excludes lead-in;
 * `quarter` is absolute score position, while `beat` is a one-based quarter
 * beat relative to `originQuarter` (the caller owns meter grouping).
 * `expectedCursor` indexes all expectation events, including rests, choosing
 * the latest onset reached by the clock; before the first onset it points to
 * the first event. At musical end it is events.length. Hits, misses, held keys
 * and the matcher cursor never influence it.
 *
 * Only runtime terminal statuses produce phase `done`. `timelineDone` marks
 * the authored duration independently: the matcher may still need its late
 * window, and this helper neither ends nor grades the assessment.
 */
export function timedRunPresentation(snapshot, nowMs) {
  const events = snapshot?.expectation?.events ?? [];
  const map = snapshot?.expectation?.tempoMap ?? [];
  const originQuarter = snapshot?.originQuarter ?? 0;
  const started = Number.isFinite(snapshot?.startedAt) && snapshot?.status !== 'prepared';
  const wallElapsed = started ? nowMs - snapshot.startedAt : 0;
  const leadInMs = snapshot?.leadInMs ?? 0;
  const elapsedMs = started ? Math.max(0, wallElapsed - leadInMs) : 0;
  const countdownRemainingMs = started ? Math.max(0, leadInMs - wallElapsed) : 0;
  const originMs = millisecondsAt(map, originQuarter);
  const { quarter, bpm } = map.length
    ? positionAt(map, originMs + elapsedMs)
    : { quarter: originQuarter, bpm: null };
  const endQuarter = events.reduce((end, event) => Math.max(end, event.onsetQuarter + event.durationQuarters), originQuarter);
  const durationMs = millisecondsAt(map, endQuarter) - originMs;
  const timelineDone = Boolean(started && !countdownRemainingMs && map.length && elapsedMs >= durationMs);
  let expectedCursor = 0;
  if (timelineDone) expectedCursor = events.length;
  else {
    for (let i = 0; i < events.length; i += 1) {
      if (events[i].onsetQuarter > quarter) break;
      expectedCursor = i;
    }
  }
  const phase = TERMINAL.has(snapshot?.status) ? 'done'
    : !started ? 'prepared'
      : countdownRemainingMs > 0 ? 'countdown' : 'running';
  return {
    phase, elapsedMs, countdownRemainingMs,
    beat: Math.floor(Math.max(0, quarter - originQuarter)) + 1,
    bpm, expectedCursor, quarter, durationMs, timelineDone,
  };
}
