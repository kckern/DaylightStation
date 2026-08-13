const clamp01 = (value) => Math.max(0, Math.min(1, value));

const ORDERED_WEIGHTS = {
  untimed: { pitch: 0.70, timing: 0, continuity: 0.30 },
  paced: { pitch: 0.55, timing: 0.30, continuity: 0.15 },
};

/**
 * Timing quality from a drift in milliseconds.
 *
 * `toleranceMs` is free — inside it a note is exactly on time — and quality then
 * falls to zero across `windowMs` beyond that. Sheet-music polish wants a
 * forgiving curve (80ms free, zero at 400ms) while beat-relative grading wants a
 * tight one; both are this function with different numbers, which is why it
 * lives here rather than in either caller.
 */
export function timingQualityFromDrift(driftMs, { toleranceMs = 0, windowMs = 120 } = {}) {
  if (!Number.isFinite(driftMs) || !(windowMs > 0)) return null;
  const beyond = Math.max(0, Math.abs(driftMs) - Math.max(0, toleranceMs));
  return clamp01(1 - beyond / windowMs);
}

export function timingQuality(actualAt, targetAt, beatMs) {
  if (![actualAt, targetAt, beatMs].every(Number.isFinite) || beatMs <= 0) return null;
  return timingQualityFromDrift(actualAt - targetAt, { windowMs: Math.max(120, beatMs * 0.45) });
}

/**
 * `missedNotes` exists for timed material. The untimed runner advances only on
 * the correct note, so a drill cannot leave one unplayed and every caller before
 * now passed nothing — with none missed this reduces exactly to what it did
 * before. A timed score can be played straight past, and a note never struck
 * has to cost something.
 */
export function gradeOrderedPerformance({ expectedCount, wrongNotes = 0, missedNotes = 0, timingQualities = [], paced = false, weights = null }) {
  const required = Math.max(1, Number(expectedCount) || 1);
  const missed = Math.max(0, Math.min(required, Number(missedNotes) || 0));
  const played = required - missed;
  const pitchAccuracy = clamp01(played / (required + Math.max(0, wrongNotes)));
  const continuity = clamp01(1 - (Math.max(0, wrongNotes) + missed) / required);
  const timing = timingQualities.length > 0
    ? timingQualities.reduce((total, value) => total + value, 0) / timingQualities.length
    : (paced ? 0 : null);
  const w = { ...(paced ? ORDERED_WEIGHTS.paced : ORDERED_WEIGHTS.untimed), ...(weights || {}) };
  const score = w.pitch * pitchAccuracy + w.timing * (timing ?? 0) + w.continuity * continuity;
  return {
    score: clamp01(score),
    pitchAccuracy,
    timingAccuracy: timing,
    continuity,
    missedNotes: missed,
  };
}

export function gradeChordPerformance({ targetNotes, wrongAttempts = 0, onsetSpanMs = 0 }) {
  const required = Math.max(1, Number(targetNotes) || 1);
  const pitchSetAccuracy = required / (required + Math.max(0, wrongAttempts));
  const simultaneity = clamp01(1 - Math.max(0, onsetSpanMs) / 250);
  return {
    score: clamp01(0.70 * pitchSetAccuracy + 0.30 * simultaneity),
    pitchSetAccuracy,
    simultaneity,
  };
}

/** Map a 0–1 score to the polish red/yellow/green bands. */
export function gradeBand(score, thresholds) {
  const t = { green: 0.9, yellow: 0.6, ...(thresholds || {}) };
  return score >= t.green ? 'green' : score >= t.yellow ? 'yellow' : 'red';
}

export default { gradeOrderedPerformance, gradeChordPerformance, timingQuality, timingQualityFromDrift, gradeBand };
