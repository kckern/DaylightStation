/**
 * Menu Performance Monitor
 *
 * Tracks FPS, frame jank, long tasks, and per-navigation timing
 * for screen-framework menu browsing. Writes to media/logs/screens/
 * via the session file transport.
 *
 * Metrics captured:
 * - FPS + frame time percentiles (p50/p95/p99)
 * - Dropped frames (>50ms) and worst frame
 * - Long tasks (>50ms main thread blocking)
 * - Per-navigation render duration (selection change → next paint)
 * - DOM node count + heap memory (Chrome)
 */

import { useEffect, useRef, useCallback } from 'react';
import getLogger from '../../../lib/logging/Logger.js';

let _logger;
function log() {
  if (!_logger) _logger = getLogger().child({
    component: 'menu-perf',
    app: 'screens',
    sessionLog: true
  });
  return _logger;
}

const JANK_THRESHOLD_MS = 50;
const LONG_FRAME_MS = 100;
const SNAPSHOT_INTERVAL_MS = 5000;

/**
 * @param {boolean} active - Whether monitoring is active
 * @param {number} selectedIndex - Current menu selection index (triggers nav timing)
 */
export function useMenuPerfMonitor(active, selectedIndex) {
  const statsRef = useRef({
    lastFrameTime: 0,
    frameCount: 0,
    droppedFrames: 0,
    worstFrameMs: 0,
    frameTimes: [],
    longTaskCount: 0,
    longTaskTotalMs: 0,
  });

  // Track per-navigation render time
  const navTimingRef = useRef({ pending: false, startTime: 0 });

  // Mark navigation start when selectedIndex changes
  useEffect(() => {
    if (!active) return;
    navTimingRef.current = { pending: true, startTime: performance.now() };

    // Measure time to next paint via rAF double-buffer
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (navTimingRef.current.pending) {
          const duration = performance.now() - navTimingRef.current.startTime;
          navTimingRef.current.pending = false;
          if (duration > 8) { // Skip trivial (< half frame)
            log().info('menu-perf.nav', {
              renderMs: Math.round(duration),
              index: selectedIndex,
              jank: duration > JANK_THRESHOLD_MS,
            });
          }
        }
      });
    });
  }, [active, selectedIndex]);

  // Main monitoring loop
  useEffect(() => {
    if (!active) return;

    const stats = statsRef.current;
    stats.lastFrameTime = performance.now();
    stats.frameCount = 0;
    stats.droppedFrames = 0;
    stats.worstFrameMs = 0;
    stats.frameTimes = [];
    stats.longTaskCount = 0;
    stats.longTaskTotalMs = 0;

    // Emit session start
    log().info('session-log.start', { screen: 'menu-perf' });

    // rAF tick
    let rafId;
    function tick(now) {
      const delta = now - stats.lastFrameTime;
      stats.lastFrameTime = now;
      stats.frameCount++;
      stats.frameTimes.push(delta);

      if (delta > stats.worstFrameMs) stats.worstFrameMs = delta;
      if (delta > JANK_THRESHOLD_MS) stats.droppedFrames++;

      if (delta > LONG_FRAME_MS) {
        log().info('menu-perf.jank', { frameMs: Math.round(delta) });
      }

      rafId = requestAnimationFrame(tick);
    }
    rafId = requestAnimationFrame(tick);

    // Long task observer
    let longTaskObserver;
    if (typeof PerformanceObserver !== 'undefined') {
      try {
        longTaskObserver = new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) {
            stats.longTaskCount++;
            stats.longTaskTotalMs += entry.duration;
          }
        });
        longTaskObserver.observe({ type: 'longtask', buffered: false });
      } catch { /* longtask not supported */ }
    }

    // Periodic snapshot
    const snapshotId = setInterval(() => {
      const ft = stats.frameTimes;
      const fps = ft.length > 0
        ? Math.round(1000 / (ft.reduce((a, b) => a + b, 0) / ft.length))
        : 0;

      const snapshot = {
        fps,
        frameP50Ms: percentile(ft, 0.5),
        frameP95Ms: percentile(ft, 0.95),
        frameP99Ms: percentile(ft, 0.99),
        droppedFrames: stats.droppedFrames,
        worstFrameMs: Math.round(stats.worstFrameMs),
        longTasks: stats.longTaskCount,
        longTaskMs: Math.round(stats.longTaskTotalMs),
        nodeCount: document.querySelectorAll('*').length,
      };

      if (performance.memory) {
        snapshot.heapUsedMB = Math.round(performance.memory.usedJSHeapSize / 1048576);
      }

      log().info('menu-perf.snapshot', snapshot);

      // Reset
      stats.frameCount = 0;
      stats.droppedFrames = 0;
      stats.worstFrameMs = 0;
      stats.frameTimes = [];
      stats.longTaskCount = 0;
      stats.longTaskTotalMs = 0;
    }, SNAPSHOT_INTERVAL_MS);

    return () => {
      cancelAnimationFrame(rafId);
      clearInterval(snapshotId);
      longTaskObserver?.disconnect();
    };
  }, [active]);
}

function percentile(arr, p) {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const idx = Math.ceil(sorted.length * p) - 1;
  return Math.round(sorted[Math.max(0, idx)]);
}
