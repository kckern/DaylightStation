// Recap timelapse ↔ session time.
//
// The recap is rendered on a fixed grid (TimelapseFrameMapper): frame i shows the
// session at elapsed (i / fps) × speedup seconds, so video time t ↔ session elapsed
// t × speedup — exact, no drift, with held frames where captures are missing. The
// charts are on the pane's shared tick axis (sessionTimeline.js), also measured in
// elapsed time from the session start, so the mapping needs no wall clock and no
// timezone: x ↔ elapsed ms ↔ video seconds.
import { axisOpts } from "./sessionTimeline.js";
import { msToTickX } from "./timelineOverlay.js";

/**
 * Session seconds per video second. Recaps since 2026-10-15 store it; for older
 * ones it is derived from the session length and the frame count (exact to one
 * frame — every recap checked derived 10 ± 0.004).
 */
export function recapSpeedup(timelapse, sessionDurationMs) {
  if (Number(timelapse?.speedup) > 0) return Number(timelapse.speedup);
  const fps = Number(timelapse?.fps);
  const frames = Number(timelapse?.frameCount);
  if (!(fps > 0) || !(frames > 0) || !(sessionDurationMs > 0)) return null;
  return (sessionDurationMs / 1000) * fps / frames;
}

/** Pane x → elapsed ms on the shared axis (null outside the plot). */
export function elapsedMsFromX(x, axis, width) {
  if (!axis || !(width > 0)) return null;
  const o = axisOpts(axis, width);
  const frac = (x - o.marginLeft) / o.plotWidth;
  if (!(frac >= 0) || frac > 1) return null;
  return frac * (o.effectiveTicks - 1) * o.intervalMs;
}

/** Elapsed ms → pane x on the shared axis. */
export function xFromElapsedMs(ms, axis, width) {
  if (!axis || !(width > 0) || !Number.isFinite(ms)) return null;
  return msToTickX(ms, axisOpts(axis, width));
}

/** Elapsed ms → recap video seconds, clamped to the video. */
export function videoTimeFromElapsedMs(ms, speedup, videoDurationS) {
  if (!(speedup > 0) || !Number.isFinite(ms)) return null;
  const t = ms / 1000 / speedup;
  const max = Number.isFinite(videoDurationS) && videoDurationS > 0 ? videoDurationS - 0.05 : Infinity;
  return Math.max(0, Math.min(max, t));
}

/** Recap video seconds → elapsed ms. */
export function elapsedMsFromVideoTime(t, speedup) {
  if (!(speedup > 0) || !Number.isFinite(t)) return null;
  return t * speedup * 1000;
}
