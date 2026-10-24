/**
 * Frame-timing probe for the governance warning overlay.
 *
 * `playback.render_fps` counts DECODED video frames; it read 59-60 through the
 * 2026-10-23 warnings while the owner saw the chips flicker soft. What the page
 * actually presents is the requestAnimationFrame cadence. Paired with
 * event-loop lag it separates the two failure classes:
 *   long frames + high loop lag  -> our main thread is busy (a JS/render storm)
 *   long frames + low loop lag   -> the compositor/GPU is struggling (paint thrash)
 *
 * Self-contained on purpose: the Logger's jankProbes are a module singleton the
 * piano diagnostics lifecycle owns, and Firefox has no 'longtask' observer.
 * Runs only while a warning is on screen.
 */

const round1 = (n) => Math.round(n * 10) / 10;

const percentile = (sorted, p) => sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1))];

/** @param {number[]} intervals - ms between consecutive frames */
export function summarizeFrameIntervals(intervals) {
  if (!intervals.length) return null;
  const sorted = [...intervals].sort((a, b) => a - b);
  const total = intervals.reduce((sum, v) => sum + v, 0);
  return {
    frames: intervals.length,
    fps: total > 0 ? round1((intervals.length * 1000) / total) : null,
    p50Ms: round1(percentile(sorted, 0.5)),
    p95Ms: round1(percentile(sorted, 0.95)),
    p99Ms: round1(percentile(sorted, 0.99)),
    maxMs: round1(sorted[sorted.length - 1]),
    over50Ms: intervals.filter((v) => v > 50).length,
    over100Ms: intervals.filter((v) => v > 100).length,
  };
}

const MAX_SAMPLES = 2000; // ~30s at 60fps; a window is read every 5s

export function createFrameTimingProbe({
  now = () => performance.now(),
  raf = (cb) => requestAnimationFrame(cb),
  caf = (id) => cancelAnimationFrame(id),
  setInterval: setIv = (cb, ms) => setInterval(cb, ms),
  clearInterval: clearIv = (id) => clearInterval(id),
  lagIntervalMs = 250,
} = {}) {
  let intervals = [];
  let lastFrame = null;
  let rafId = null;
  let lagTimer = null;
  let lastTick = 0;
  let loopLagMaxMs = 0;
  let windowStart = 0;

  const onFrame = (ts) => {
    const t = Number.isFinite(ts) ? ts : now();
    if (lastFrame != null && intervals.length < MAX_SAMPLES) intervals.push(t - lastFrame);
    lastFrame = t;
    rafId = raf(onFrame);
  };

  return {
    start() {
      windowStart = now();
      lastTick = windowStart;
      rafId = raf(onFrame);
      lagTimer = setIv(() => {
        const t = now();
        const lag = Math.max(0, t - lastTick - lagIntervalMs);
        if (lag > loopLagMaxMs) loopLagMaxMs = lag;
        lastTick = t;
      }, lagIntervalMs);
    },
    /** Stats since the previous read (null when no frames), then reset. */
    read() {
      const summary = summarizeFrameIntervals(intervals);
      const t = now();
      const out = summary ? { ...summary, loopLagMaxMs: round1(loopLagMaxMs), windowMs: Math.round(t - windowStart) } : null;
      intervals = [];
      loopLagMaxMs = 0;
      windowStart = t;
      return out;
    },
    stop() {
      if (rafId != null) caf(rafId);
      if (lagTimer != null) clearIv(lagTimer);
      rafId = null;
      lagTimer = null;
      lastFrame = null;
    },
  };
}

export default createFrameTimingProbe;
