// Pose throughput and inference-latency accounting. Pure: callers pass every
// timestamp (performance.now() in the widget), so tests drive it with numbers.

import { percentile, round, summarize, pct } from './stats.js';

export const POSE_FPS_GATE = 20;

/**
 * Collects one sample per pose callback.
 *   add(tMs, latencyMs, hasPose)
 *   live(tNow, windowMs)  -> fps and latency over the trailing window
 *   result(tStart, tEnd)  -> totals for a measurement span
 */
export function createPoseMeter() {
  const ts = [];
  const latencies = [];
  let poseFrames = 0;

  return {
    add(tMs, latencyMs, hasPose) {
      ts.push(tMs);
      latencies.push(Number.isFinite(latencyMs) ? latencyMs : null);
      if (hasPose) poseFrames += 1;
    },

    get frames() { return ts.length; },

    live(tNow, windowMs = 1000) {
      let i = ts.length;
      while (i > 0 && ts[i - 1] > tNow - windowMs) i -= 1;
      const lat = latencies.slice(i).filter((v) => v != null);
      return {
        fps: round(((ts.length - i) * 1000) / windowMs, 1),
        latencyP50: round(percentile(lat, 50), 1),
        latencyP95: round(percentile(lat, 95), 1),
      };
    },

    /**
     * fps is frames delivered inside [tStart, tEnd] divided by that span, so a
     * stall counts against it. minWindowFps is the slowest full 5 s bucket.
     */
    result(tStart, tEnd, bucketMs = 5000) {
      const idx = [];
      ts.forEach((t, i) => { if (t >= tStart && t <= tEnd) idx.push(i); });
      const spanMs = tEnd - tStart;
      const inSpan = idx.map((i) => ts[i]);
      const intervals = inSpan.slice(1).map((t, i) => t - inSpan[i]);
      const buckets = [];
      for (let b = tStart; b + bucketMs <= tEnd; b += bucketMs) {
        buckets.push((inSpan.filter((t) => t >= b && t < b + bucketMs).length * 1000) / bucketMs);
      }
      const fps = spanMs > 0 ? round((inSpan.length * 1000) / spanMs, 1) : null;
      return {
        frames: inSpan.length,
        spanMs: round(spanMs, 0),
        fps,
        minWindowFps: buckets.length ? round(Math.min(...buckets), 1) : null,
        windowS: bucketMs / 1000,
        meetsGate: fps == null ? null : fps >= POSE_FPS_GATE,
        latencyMs: summarize(idx.map((i) => latencies[i])),
        intervalMs: summarize(intervals),
      };
    },

    posePct() { return pct(poseFrames, ts.length); },
  };
}

/** Frame pacing of a requestAnimationFrame loop (the synthetic game load). */
export function createFrameMeter() {
  const ts = [];
  return {
    add(tMs) { ts.push(tMs); },
    result(tStart, tEnd) {
      const inSpan = ts.filter((t) => t >= tStart && t <= tEnd);
      const intervals = inSpan.slice(1).map((t, i) => t - inSpan[i]);
      const spanMs = tEnd - tStart;
      return {
        frames: inSpan.length,
        fps: spanMs > 0 ? round((inSpan.length * 1000) / spanMs, 1) : null,
        frameMs: summarize(intervals),
      };
    },
    live(tNow, windowMs = 1000) { return round((ts.filter((t) => t > tNow - windowMs).length * 1000) / windowMs, 1); },
    trim(tNow, keepMs = 120000) { while (ts.length && ts[0] < tNow - keepMs) ts.shift(); },
  };
}
