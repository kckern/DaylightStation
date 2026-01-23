/**
 * useRenderProfiler - Production Logging Hook for Render Performance
 *
 * Tracks render frequency and mount cycles to detect:
 * - Render thrashing (>10 renders/sec for 2s)
 * - Excessive remounts (>3 mounts in 60s)
 * - Effect cascades (>20 triggers in 10s)
 *
 * Exposes stats via window.__fitnessRenderProfilerStats for cross-component correlation.
 *
 * Usage:
 *   useRenderProfiler('FitnessPlayer');
 */

import { useRef, useEffect, useCallback } from 'react';
import getLogger from '../../lib/logging/Logger.js';

const logger = getLogger('RenderProfiler');

// Global registry for all profiled components
const componentRegistry = {
  renderTimestamps: {},    // componentName -> timestamp[]
  mountTimestamps: {},     // componentName -> timestamp[]
  thrashingReported: {},   // componentName -> lastReportTime (rate limit)
  remountReported: {}      // componentName -> lastReportTime (rate limit)
};

// Thresholds from design doc
const THRASHING_THRESHOLD = 10;        // renders/sec
const THRASHING_WINDOW_MS = 5000;      // 5s window for render tracking
const THRASHING_SUSTAINED_MS = 2000;   // Must sustain for 2s to report
const REMOUNT_THRESHOLD = 3;           // mounts in 60s
const REMOUNT_WINDOW_MS = 60000;       // 60s window for mount tracking
const REPORT_COOLDOWN_MS = 30000;      // Don't report same issue within 30s

/**
 * Calculate aggregate stats across all profiled components
 */
function calculateGlobalStats() {
  const now = performance.now();
  let totalRenders5s = 0;
  let totalRemounts60s = 0;

  for (const timestamps of Object.values(componentRegistry.renderTimestamps)) {
    const recent = timestamps.filter(t => t > now - THRASHING_WINDOW_MS);
    totalRenders5s += recent.length;
  }

  for (const timestamps of Object.values(componentRegistry.mountTimestamps)) {
    const recent = timestamps.filter(t => t > now - REMOUNT_WINDOW_MS);
    totalRemounts60s += recent.length;
  }

  return {
    ratePer5s: totalRenders5s,
    remountCount: totalRemounts60s,
    componentCount: Object.keys(componentRegistry.renderTimestamps).length
  };
}

/**
 * Update global window stats for cross-component correlation
 */
function updateGlobalState() {
  if (typeof window !== 'undefined') {
    // Use separate global from FitnessContext's __fitnessRenderStats (which is a function)
    window.__fitnessRenderProfilerStats = calculateGlobalStats();
  }
}

/**
 * useRenderProfiler - Track render and mount patterns for a component
 *
 * @param {string} componentName - Name of the component being profiled
 */
export function useRenderProfiler(componentName) {
  const renderStartTime = useRef(null);
  const sustainedThrashingStart = useRef(null);

  // Initialize registry entries for this component
  if (!componentRegistry.renderTimestamps[componentName]) {
    componentRegistry.renderTimestamps[componentName] = [];
  }
  if (!componentRegistry.mountTimestamps[componentName]) {
    componentRegistry.mountTimestamps[componentName] = [];
  }

  // Track this render
  const now = performance.now();
  componentRegistry.renderTimestamps[componentName].push(now);

  // Prune old timestamps (keep last 5s for renders)
  const cutoff = now - THRASHING_WINDOW_MS;
  componentRegistry.renderTimestamps[componentName] =
    componentRegistry.renderTimestamps[componentName].filter(t => t > cutoff);

  // Calculate render rate for this component
  const timestamps = componentRegistry.renderTimestamps[componentName];
  const renderRate = timestamps.length / (THRASHING_WINDOW_MS / 1000); // renders per second

  // Check for sustained thrashing
  if (renderRate > THRASHING_THRESHOLD) {
    if (!sustainedThrashingStart.current) {
      sustainedThrashingStart.current = now;
    } else if (now - sustainedThrashingStart.current >= THRASHING_SUSTAINED_MS) {
      // Thrashing sustained for 2s - check if we should report
      const lastReport = componentRegistry.thrashingReported[componentName] || 0;
      if (now - lastReport > REPORT_COOLDOWN_MS) {
        componentRegistry.thrashingReported[componentName] = now;

        const governance = typeof window !== 'undefined' ? window.__fitnessGovernance : null;
        logger.warn('fitness.render_thrashing', {
          component: componentName,
          rendersInWindow: timestamps.length,
          renderRate: Math.round(renderRate * 10) / 10,
          windowMs: THRASHING_WINDOW_MS,
          sustainedMs: Math.round(now - sustainedThrashingStart.current),
          governancePhase: governance?.phase || null,
          governanceWarningDurationMs: governance?.warningDuration || 0,
          heapMB: typeof performance !== 'undefined' && performance.memory
            ? Math.round(performance.memory.usedJSHeapSize / 1024 / 1024)
            : null
        });
      }
    }
  } else {
    // Reset sustained tracking if rate drops below threshold
    sustainedThrashingStart.current = null;
  }

  // Update global stats
  updateGlobalState();

  // Track mounts/unmounts
  useEffect(() => {
    const mountTime = performance.now();
    componentRegistry.mountTimestamps[componentName].push(mountTime);

    // Prune old mount timestamps (keep last 60s)
    const mountCutoff = mountTime - REMOUNT_WINDOW_MS;
    componentRegistry.mountTimestamps[componentName] =
      componentRegistry.mountTimestamps[componentName].filter(t => t > mountCutoff);

    const mountCount = componentRegistry.mountTimestamps[componentName].length;

    // Check for excessive remounts
    if (mountCount > REMOUNT_THRESHOLD) {
      const lastReport = componentRegistry.remountReported[componentName] || 0;
      if (mountTime - lastReport > REPORT_COOLDOWN_MS) {
        componentRegistry.remountReported[componentName] = mountTime;

        const governance = typeof window !== 'undefined' ? window.__fitnessGovernance : null;
        logger.warn('fitness.component_remount', {
          component: componentName,
          mountCount,
          windowMs: REMOUNT_WINDOW_MS,
          governancePhase: governance?.phase || null,
          heapMB: typeof performance !== 'undefined' && performance.memory
            ? Math.round(performance.memory.usedJSHeapSize / 1024 / 1024)
            : null
        });
      }
    }

    updateGlobalState();

    return () => {
      // Cleanup on unmount - update global stats
      updateGlobalState();
    };
  }, []); // Empty deps = track mount/unmount only
}

/**
 * useEffectProfiler - Track effect trigger frequency
 *
 * Wrap useEffect callbacks to detect effect cascades.
 *
 * @param {string} effectName - Name for this effect
 * @param {Function} callback - Effect callback
 * @param {Array} deps - Effect dependencies
 */
export function useEffectProfiler(effectName, callback, deps) {
  const triggerTimestamps = useRef([]);
  const lastReport = useRef(0);

  useEffect(() => {
    const now = performance.now();
    triggerTimestamps.current.push(now);

    // Keep last 10s of triggers
    const cutoff = now - 10000;
    triggerTimestamps.current = triggerTimestamps.current.filter(t => t > cutoff);

    const triggerCount = triggerTimestamps.current.length;

    // Check for effect cascade (>20 triggers in 10s)
    if (triggerCount > 20 && now - lastReport.current > REPORT_COOLDOWN_MS) {
      lastReport.current = now;

      const governance = typeof window !== 'undefined' ? window.__fitnessGovernance : null;
      logger.warn('fitness.effect_cascade', {
        effectName,
        triggerCount,
        windowMs: 10000,
        dependencies: deps?.length || 0,
        governancePhase: governance?.phase || null
      });
    }

    // Run the actual effect
    return callback();
  }, deps);
}

export default useRenderProfiler;
