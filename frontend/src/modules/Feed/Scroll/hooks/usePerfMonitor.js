import { useEffect, useRef } from 'react';
import getLogger from '../../../../lib/logging/Logger.js';

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
  const statsRef = useRef(null);

  useEffect(() => {
    if (!active) return;

    // ── FPS + jank tracking via rAF ──
    let rafId;
    let lastFrameTime = performance.now();
    let frameCount = 0;
    let droppedFrames = 0;
    let worstFrameMs = 0;
    let frameTimes = [];

    const JANK_THRESHOLD_MS = 50; // >50ms = dropped frame (< 20fps)
    const LONG_FRAME_MS = 100;    // >100ms = log individual jank event

    function tick(now) {
      const delta = now - lastFrameTime;
      lastFrameTime = now;
      frameCount++;
      frameTimes.push(delta);

      if (delta > worstFrameMs) worstFrameMs = delta;
      if (delta > JANK_THRESHOLD_MS) droppedFrames++;

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

    // ── Scroll smoothness tracking ──
    let scrollFrames = 0;
    let scrollJanks = 0;
    let isScrolling = false;
    let scrollTimer;

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

    // Track scroll-during-jank correlation
    const origTick = tick;
    tick = function scrollAwareTick(now) {
      const delta = now - lastFrameTime;
      if (isScrolling && delta > JANK_THRESHOLD_MS) scrollJanks++;
      return origTick(now);
    };
    // Restart rAF with scroll-aware tick
    cancelAnimationFrame(rafId);
    lastFrameTime = performance.now();
    rafId = requestAnimationFrame(tick);

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

      // Chrome-only: heap memory
      if (performance.memory) {
        snapshot.heapUsedMB = Math.round(performance.memory.usedJSHeapSize / 1048576);
        snapshot.heapTotalMB = Math.round(performance.memory.totalJSHeapSize / 1048576);
        snapshot.heapLimitMB = Math.round(performance.memory.jsHeapSizeLimit / 1048576);
      }

      log().info('perf.snapshot', snapshot);

      // Reset accumulators
      frameCount = 0;
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
