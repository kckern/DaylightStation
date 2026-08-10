const clamp01 = (value) => Math.max(0, Math.min(1, value));

export function timingQuality(actualAt, targetAt, beatMs) {
  if (![actualAt, targetAt, beatMs].every(Number.isFinite) || beatMs <= 0) return null;
  return clamp01(1 - Math.abs(actualAt - targetAt) / Math.max(120, beatMs * 0.45));
}

export function gradeOrderedPerformance({ expectedCount, wrongNotes = 0, timingQualities = [], paced = false }) {
  const required = Math.max(1, Number(expectedCount) || 1);
  const pitchAccuracy = required / (required + Math.max(0, wrongNotes));
  const continuity = clamp01(1 - Math.max(0, wrongNotes) / required);
  const timing = timingQualities.length > 0
    ? timingQualities.reduce((total, value) => total + value, 0) / timingQualities.length
    : (paced ? 0 : null);
  const score = paced
    ? 0.55 * pitchAccuracy + 0.30 * timing + 0.15 * continuity
    : 0.70 * pitchAccuracy + 0.30 * continuity;
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

export default { gradeOrderedPerformance, gradeChordPerformance, timingQuality };
