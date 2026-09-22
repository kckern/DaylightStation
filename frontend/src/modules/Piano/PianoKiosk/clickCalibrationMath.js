// clickCalibrationMath.js — pure math for the grown-up click tap-along.
//
// The kiosk plays CALIBRATION.clicks anchored clicks with leadMs 0: click n is
// scheduled to be audible (as far as the browser knows) at anchorMs + n·period.
// A grown-up plays a key on each click they HEAR. Each press is matched to its
// nearest scheduled click; offset = press time − click time. The median offset
// is the latency the browser did not account for — Bluetooth output plus MIDI
// input — and becomes `timing.clickLeadMs`.
//
// Spread is the interquartile range (Q3 − Q1, linear-interpolated quantiles) of
// the matched offsets: robust to a stray early/late tap, and for steady tapping
// roughly 1.35 σ. Save is offered only when spread ≤ maxSpreadMs and at least
// minMatched presses were matched.

export const CALIBRATION = Object.freeze({
  clicks: 24,
  // 60 BPM: a 1 s gap keeps nearest-click matching unambiguous up to ±500 ms of
  // latency. Tablet A2DP alone was measured at ~190-320 ms; a faster tempo
  // would pair a late press with the NEXT click.
  bpm: 60,
  minMatched: 16,
  maxSpreadMs: 60,
  // Epoch lead-in before click 0, so the first click is never "already past".
  startDelayMs: 1500,
});

/** Epoch ms of every scheduled click. */
export function calibrationClickTimes(anchorMs, { clicks = CALIBRATION.clicks, bpm = CALIBRATION.bpm } = {}) {
  const periodMs = 60000 / bpm;
  return Array.from({ length: clicks }, (_, n) => anchorMs + n * periodMs);
}

/**
 * Pair presses with clicks. A press further than half a period from every click
 * is dropped; when two presses claim one click the closer one wins.
 * @returns {Array<{ click:number, press:number, offsetMs:number }>} ordered by click
 */
export function matchPresses(clickTimes, pressTimes) {
  if (!clickTimes.length) return [];
  const periodMs = clickTimes.length > 1 ? clickTimes[1] - clickTimes[0] : 1000;
  const half = periodMs / 2;
  const best = new Map(); // click index → { press, offsetMs }
  for (const press of pressTimes) {
    if (!Number.isFinite(press)) continue;
    let idx = 0;
    let dist = Infinity;
    for (let i = 0; i < clickTimes.length; i += 1) {
      const d = Math.abs(press - clickTimes[i]);
      if (d < dist) { dist = d; idx = i; }
    }
    if (dist > half) continue;
    const prior = best.get(idx);
    if (!prior || dist < Math.abs(prior.offsetMs)) best.set(idx, { press, offsetMs: press - clickTimes[idx] });
  }
  return [...best.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([i, m]) => ({ click: clickTimes[i], press: m.press, offsetMs: m.offsetMs }));
}

function quantile(sorted, q) {
  if (!sorted.length) return NaN;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

/**
 * @returns {{ matched:number, presses:number, medianMs:number|null, spreadMs:number|null,
 *             spreadKind:'iqr', leadMs:number|null, canSave:boolean, reason:string|null }}
 */
export function summarizeCalibration(clickTimes, pressTimes, {
  minMatched = CALIBRATION.minMatched,
  maxSpreadMs = CALIBRATION.maxSpreadMs,
} = {}) {
  const matches = matchPresses(clickTimes, pressTimes);
  const offsets = matches.map((m) => m.offsetMs).sort((a, b) => a - b);
  const medianMs = offsets.length ? quantile(offsets, 0.5) : null;
  const spreadMs = offsets.length ? quantile(offsets, 0.75) - quantile(offsets, 0.25) : null;
  let reason = null;
  if (matches.length < minMatched) reason = 'too-few';
  else if (spreadMs > maxSpreadMs) reason = 'too-uneven';
  return {
    matched: matches.length,
    presses: pressTimes.length,
    medianMs: medianMs == null ? null : Math.round(medianMs),
    spreadMs: spreadMs == null ? null : Math.round(spreadMs),
    spreadKind: 'iqr',
    leadMs: medianMs == null ? null : Math.round(medianMs),
    canSave: reason === null,
    reason,
  };
}
