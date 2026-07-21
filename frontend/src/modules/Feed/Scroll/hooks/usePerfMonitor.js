import { useEffect } from 'react';
import getLogger from '../../../../lib/logging/Logger.js';
import { heapSnapshotFields, reportMemoryMonitoringAvailability } from '../../../../lib/perf/memoryProbe.js';

// Lazy init to pick up sessionLog context
function log() { return getLogger().child({ component: 'feed-perf' }); }

/**
 * Performance monitor for feed scroll.
 * Tracks FPS, frame jank, heap memory, DOM node count, and scroll smoothness.
 * Emits periodic snapshots + per-jank events at info level so they reach
 * the backend session log transport.
 *
 * @param {boolean} active - Whether monitoring is active
 * @param {number} [snapshotIntervalMs=5000] - How often to emit a summary snapshot
 */
export function usePerfMonitor(active, snapshotIntervalMs = 5000) {
  useEffect(() => {
    if (!active) return;

    // Say once, up front, whether heap figures are obtainable here. Without
    // this a Firefox session looks identical to a healthy one: heap fields
    // null, no threshold ever crossed, nothing in the logs explaining why.
    reportMemoryMonitoringAvailability({ monitor: 'feed-scroll' });

    // ── FPS + jank tracking via rAF ──
    let rafId;
    let lastFrameTime = performance.now();
    let droppedFrames = 0;
    let worstFrameMs = 0;
    let frameTimes = [];

    // ── Scroll smoothness tracking (correlated inside the single tick) ──
    let scrollFrames = 0;
    let scrollJanks = 0;
    let isScrolling = false;
    let scrollTimer;

    const JANK_THRESHOLD_MS = 50; // >50ms = dropped frame (< 20fps)
    const LONG_FRAME_MS = 100;    // >100ms = log individual jank event

    function tick(now) {
      const delta = now - lastFrameTime;
      lastFrameTime = now;
      frameTimes.push(delta);

      if (delta > worstFrameMs) worstFrameMs = delta;
      if (delta > JANK_THRESHOLD_MS) {
        droppedFrames++;
        if (isScrolling) scrollJanks++;
      }

      if (delta > LONG_FRAME_MS) {
        // Don't querySelectorAll here — it's expensive and would worsen jank.
        // Node count is captured in the periodic snapshot instead.
        log().info('perf.jank', { frameMs: Math.round(delta) });
      }

      rafId = requestAnimationFrame(tick);
    }
    rafId = requestAnimationFrame(tick);

    // ── Long Task observer (tasks > 50ms blocking main thread) ──
    let longTaskCount = 0;
    let longTaskTotalMs = 0;
    let longTaskObserver;
    if (typeof PerformanceObserver !== 'undefined') {
      try {
        longTaskObserver = new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) {
            longTaskCount++;
            longTaskTotalMs += entry.duration;
          }
        });
        longTaskObserver.observe({ type: 'longtask', buffered: false });
      } catch { /* longtask not supported */ }
    }

    // ── Scroll session tracking ──
    function onScroll() {
      if (!isScrolling) {
        isScrolling = true;
        scrollFrames = 0;
        scrollJanks = 0;
      }
      scrollFrames++;
      clearTimeout(scrollTimer);
      scrollTimer = setTimeout(() => {
        if (scrollFrames > 5) {
          log().info('perf.scroll-session', {
            frames: scrollFrames,
            janks: scrollJanks,
            smoothness: scrollFrames > 0 ? Math.round((1 - scrollJanks / scrollFrames) * 100) : 100,
          });
        }
        isScrolling = false;
      }, 150);
    }

    const scrollEl = document.querySelector('.feed-content') || window;
    scrollEl.addEventListener('scroll', onScroll, { passive: true });

    // ── Periodic snapshot ──
    const snapshotId = setInterval(() => {
      const fps = frameTimes.length > 0
        ? Math.round(1000 / (frameTimes.reduce((a, b) => a + b, 0) / frameTimes.length))
        : 0;

      const p50 = percentile(frameTimes, 0.5);
      const p95 = percentile(frameTimes, 0.95);
      const p99 = percentile(frameTimes, 0.99);

      const snapshot = {
        fps,
        frameP50Ms: p50,
        frameP95Ms: p95,
        frameP99Ms: p99,
        droppedFrames,
        worstFrameMs: Math.round(worstFrameMs),
        longTasks: longTaskCount,
        longTaskMs: Math.round(longTaskTotalMs),
        nodeCount: document.querySelectorAll('*').length,
      };

      // Heap figures where the browser provides them. Always carries
      // heapSource so a null is never mistaken for a real reading.
      Object.assign(snapshot, heapSnapshotFields({ precision: 0 }));

      log().info('perf.snapshot', snapshot);

      // Reset accumulators
      droppedFrames = 0;
      worstFrameMs = 0;
      frameTimes = [];
      longTaskCount = 0;
      longTaskTotalMs = 0;
    }, snapshotIntervalMs);

    // ── Cleanup ──
    return () => {
      cancelAnimationFrame(rafId);
      clearInterval(snapshotId);
      clearTimeout(scrollTimer);
      scrollEl.removeEventListener('scroll', onScroll);
      longTaskObserver?.disconnect();
    };
  }, [active, snapshotIntervalMs]);
}

function percentile(arr, p) {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const idx = Math.ceil(sorted.length * p) - 1;
  return Math.round(sorted[Math.max(0, idx)]);
}
