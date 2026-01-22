/**
 * Profiling utilities for memory leak detection
 *
 * @example
 * import { MemoryProfiler, TimerTracker, LeakAssertions, TIMER_TRACKER_SCRIPT } from '#fixtures/profiling/index.mjs';
 */

export { MemoryProfiler } from './MemoryProfiler.mjs';
export { TimerTracker, TIMER_TRACKER_SCRIPT } from './TimerTracker.mjs';
export { LeakAssertions, DEFAULT_THRESHOLDS, writeReport } from './LeakAssertions.mjs';
