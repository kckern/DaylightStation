/**
 * scoreTelemetry — pure timing math for the sheet-music player's logs-only
 * telemetry. No logging here (callers emit); this just turns raw deltas into the
 * numbers the log events carry, so it's unit-testable off the DOM.
 */
export function summarizeDrift(deltas, { stallMs = 120 } = {}) {
  const d = (deltas || []).filter((x) => Number.isFinite(x));
  if (!d.length) return { count: 0, meanDriftMs: 0, p95DriftMs: 0, maxDriftMs: 0, stalls: 0 };
  const sorted = [...d].sort((a, b) => a - b);
  const p95 = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))];
  const sum = d.reduce((a, b) => a + b, 0);
  return {
    count: d.length,
    meanDriftMs: sum / d.length,
    p95DriftMs: p95,
    maxDriftMs: sorted[sorted.length - 1],
    stalls: d.filter((x) => x >= stallMs).length,
  };
}

const TIGHT_MS = 25;
export function classifyFollowHit({ expectedMs, actualMs }) {
  const driftMs = Math.round(actualMs - expectedMs);
  const feel = Math.abs(driftMs) <= TIGHT_MS ? 'tight' : driftMs < 0 ? 'rush' : 'drag';
  return { driftMs, feel };
}

export default { summarizeDrift, classifyFollowHit };
