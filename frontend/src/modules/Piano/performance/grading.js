const clamp01 = (value) => Math.max(0, Math.min(1, value));

const ORDERED_WEIGHTS = {
  untimed: { pitch: 0.70, timing: 0, continuity: 0.30 },
  paced: { pitch: 0.55, timing: 0.30, continuity: 0.15 },
};

export function timingQuality(actualAt, targetAt, beatMs) {
  if (![actualAt, targetAt, beatMs].every(Number.isFinite) || beatMs <= 0) return null;
  return clamp01(1 - Math.abs(actualAt - targetAt) / Math.max(120, beatMs * 0.45));
}

export function gradeOrderedPerformance({ expectedCount, wrongNotes = 0, timingQualities = [], paced = false, weights = null }) {
  const required = Math.max(1, Number(expectedCount) || 1);
  const pitchAccuracy = required / (required + Math.max(0, wrongNotes));
  const continuity = clamp01(1 - Math.max(0, wrongNotes) / required);
  const timing = timingQualities.length > 0
    ? timingQualities.reduce((total, value) => total + value, 0) / timingQualities.length
    : (paced ? 0 : null);
  const w = weights || (paced ? ORDERED_WEIGHTS.paced : ORDERED_WEIGHTS.untimed);
  const score = w.pitch * pitchAccuracy + w.timing * (timing ?? 0) + w.continuity * continuity;
  return {
    score: clamp01(score),
    pitchAccuracy,
    timingAccuracy: timing,
    continuity,
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
export function gradeBand(score, thresholds = { green: 0.9, yellow: 0.6 }) {
  return score >= thresholds.green ? 'green' : score >= thresholds.yellow ? 'yellow' : 'red';
}

export default { gradeOrderedPerformance, gradeChordPerformance, timingQuality, gradeBand };
