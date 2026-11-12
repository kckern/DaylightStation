// Pressure-mat press timing for the Skyline Invaders spike. Pure.
//
// Clocks available on a press (see _extensions/pressure-mat-relay firmware and
// PressureMatAdapter):
// - deviceTs: the relay's millis() uptime when it sent the message. A relative
//   clock with no epoch, so it cannot give absolute press->app latency. It does
//   give the device-side spacing of presses and how much later than the best
//   case each press was delivered.
// - receivedAt: backend wall clock on receipt. Compared with the browser's
//   Date.now() it gives backend->app delay PLUS the clock offset between the two
//   machines, which this code cannot separate.
// Nothing here measures foot-on-mat -> relay detection (sampling, smoothing and
// debounce inside the firmware).

import { round, summarize } from './stats.js';

export const PRESS_LATENCY_NOTE = 'Absolute press->app latency is not measurable: the relay timestamp is device uptime, not wall time.';

/** Presses per second over the trailing window: count / window length. */
export function pressRate(times, tNow, windowMs = 10000) {
  const count = times.filter((t) => t > tNow - windowMs && t <= tNow).length;
  return round((count * 1000) / windowMs, 2);
}

export const intervalsOf = (times) => times.slice(1).map((t, i) => t - times[i]);

/**
 * Result of a "step off, step on as fast as you can" drill.
 * perSec = presses inside the drill / drill length. sustainedPerSec = 1000 /
 * median interval (the pace actually held between presses).
 */
export function drillResult(times, tStart, durationMs) {
  const inDrill = times.filter((t) => t >= tStart && t <= tStart + durationMs);
  const intervals = intervalsOf(inDrill);
  const stats = summarize(intervals, 0);
  return {
    presses: inDrill.length,
    durationS: round(durationMs / 1000, 1),
    perSec: round((inDrill.length * 1000) / durationMs, 2),
    secPerPress: inDrill.length ? round(durationMs / 1000 / inDrill.length, 2) : null,
    sustainedPerSec: stats.p50 ? round(1000 / stats.p50, 2) : null,
    intervalMs: stats,
  };
}

/**
 * Timing derived from the clocks a press carries.
 * @param {Array<{ t: number, wallMs: number, deviceTs: number|null, receivedAtMs: number|null, bootCount: number|null }>} presses
 *   t = app monotonic receipt time (ms), wallMs = Date.now() at receipt.
 */
export function relayTiming(presses) {
  const withDevice = presses.filter((p) => Number.isFinite(p.deviceTs) && p.deviceTs > 0);
  const withBackend = presses.filter((p) => Number.isFinite(p.receivedAtMs) && Number.isFinite(p.wallMs));

  // Per relay boot, the smallest (app clock - device clock) is the fastest
  // delivery seen; everything else arrived that much later than it could have.
  const excess = [];
  const byBoot = new Map();
  withDevice.forEach((p) => {
    const key = p.bootCount ?? 'unknown';
    if (!byBoot.has(key)) byBoot.set(key, []);
    byBoot.get(key).push(p.t - p.deviceTs);
  });
  byBoot.forEach((offsets) => {
    const best = Math.min(...offsets);
    offsets.forEach((o) => excess.push(o - best));
  });

  // Spacing of consecutive presses as the app saw it minus as the relay sent it.
  const spacingError = [];
  for (let i = 1; i < presses.length; i += 1) {
    const a = presses[i - 1];
    const b = presses[i];
    const comparable = [a, b].every((p) => Number.isFinite(p.deviceTs) && p.deviceTs > 0)
      && (a.bootCount ?? null) === (b.bootCount ?? null) && b.deviceTs >= a.deviceTs;
    if (comparable) spacingError.push((b.t - a.t) - (b.deviceTs - a.deviceTs));
  }

  return {
    presses: presses.length,
    deviceClockPresses: withDevice.length,
    backendClockPresses: withBackend.length,
    absoluteLatencyMs: null,
    note: PRESS_LATENCY_NOTE,
    // Lower bound on delivery jitter. 0 = as fast as the fastest press.
    deliveryExcessMs: summarize(excess, 0),
    spacingErrorMs: summarize(spacingError, 0),
    // Includes the clock offset between the browser machine and the backend.
    backendToAppMs: summarize(withBackend.map((p) => p.wallMs - p.receivedAtMs), 0),
  };
}

/** Drop null/undefined fields so raw mat payloads log compactly. */
export function compactPayload(payload) {
  const out = {};
  Object.entries(payload || {}).forEach(([key, value]) => { if (value != null) out[key] = value; });
  return out;
}
