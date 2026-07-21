/**
 * memoryProbe — one honest answer to "how much heap are we using?"
 *
 * Background: every heap probe in this codebase used to gate on
 * `performance.memory`, a non-standard Chrome-only API. The garage fitness
 * kiosk runs Firefox, which does not implement it, so 100-minute sessions
 * logged `heapMB: null` on every sample and the memory-leak detector never
 * fired. A bare `null` in a growth field reads like "no growth" — the logs
 * looked healthy while telemetry was blind.
 *
 * This module reports what the current browser can actually provide, and says
 * so explicitly. Rules it enforces:
 *
 *   - A reading ALWAYS carries `heapSource`. Callers spread `heapFields()` into
 *     their payload so a missing figure is self-describing, never ambiguous.
 *   - No fabricated numbers. If the browser will not tell us, we say
 *     `heapSource: 'unavailable'`.
 *   - `performance.measureUserAgentSpecificMemory()` exists in Firefox and
 *     Chrome but ONLY resolves in cross-origin-isolated contexts, and only
 *     asynchronously. We probe for isolation before claiming it, and report
 *     `'async-only'` for synchronous reads so nobody mistakes it for a value.
 *   - Blindness is announced once, at warn level, via
 *     `reportMemoryMonitoringAvailability()` — so threshold logic that can
 *     never fire leaves a trace in the logs instead of silently no-opping.
 *
 * Capability values: 'performance.memory' | 'measureUserAgentSpecificMemory' | 'unavailable'
 */
import getLogger from '../logging/Logger.js';

let _logger;
function logger() {
  if (!_logger) _logger = getLogger().child({ component: 'memory-probe' });
  return _logger;
}

const BYTES_PER_MB = 1048576;

/** Announce-once latch for the unavailable warning. */
let availabilityReported = false;

const perf = () => (typeof performance !== 'undefined' ? performance : null);

const toMB = (bytes, precision = 0) => {
  if (!Number.isFinite(bytes)) return null;
  const mb = bytes / BYTES_PER_MB;
  const factor = 10 ** precision;
  return Math.round(mb * factor) / factor;
};

/**
 * What can this browser actually tell us about the heap?
 * Probed fresh each call — the kiosk's capabilities do not change mid-session,
 * but tests and cross-origin-isolation upgrades both benefit from not caching.
 */
export function getMemoryCapability() {
  const p = perf();
  if (!p) return 'unavailable';

  // Chrome / Chromium: non-standard but synchronous and cheap.
  if (p.memory && Number.isFinite(p.memory.usedJSHeapSize)) {
    return 'performance.memory';
  }

  // Standardised replacement — Firefox and Chrome both expose it, but it
  // rejects outside a cross-origin-isolated context. Presence alone is not
  // permission, so require isolation before claiming the capability.
  const isolated = typeof globalThis !== 'undefined' && globalThis.crossOriginIsolated === true;
  if (isolated && typeof p.measureUserAgentSpecificMemory === 'function') {
    return 'measureUserAgentSpecificMemory';
  }

  return 'unavailable';
}

/** True when some heap figure is obtainable (synchronously or asynchronously). */
export function isMemoryMonitoringAvailable() {
  return getMemoryCapability() !== 'unavailable';
}

/**
 * Synchronous heap reading.
 *
 * @returns {{heapMB: number|null, heapTotalMB: number|null, heapLimitMB: number|null, heapSource: string}}
 *   `heapSource` is 'performance.memory' when the numbers are real,
 *   'async-only' when a figure exists but only via the async API, and
 *   'unavailable' when the browser will not say.
 */
export function readHeap({ precision = 0 } = {}) {
  const capability = getMemoryCapability();

  if (capability === 'performance.memory') {
    const mem = perf().memory;
    return {
      heapMB: toMB(mem.usedJSHeapSize, precision),
      heapTotalMB: toMB(mem.totalJSHeapSize, precision),
      heapLimitMB: toMB(mem.jsHeapSizeLimit, precision),
      heapSource: 'performance.memory'
    };
  }

  // measureUserAgentSpecificMemory cannot answer synchronously. Saying
  // 'async-only' keeps the distinction between "we can't see" and "we could
  // see, but not on this code path".
  const heapSource = capability === 'measureUserAgentSpecificMemory' ? 'async-only' : 'unavailable';
  return { heapMB: null, heapTotalMB: null, heapLimitMB: null, heapSource };
}

/**
 * Asynchronous heap reading via the standardised API, where permitted.
 * Resolves to the same shape as `readHeap()`; never throws.
 */
export async function measureHeapAsync() {
  if (getMemoryCapability() !== 'measureUserAgentSpecificMemory') {
    return readHeap();
  }
  try {
    const result = await perf().measureUserAgentSpecificMemory();
    return {
      heapMB: toMB(result?.bytes, 0),
      heapTotalMB: null,
      heapLimitMB: null,
      heapSource: 'measureUserAgentSpecificMemory'
    };
  } catch (err) {
    logger().debug('memory_probe.async_measure_failed', { error: err?.message });
    return { heapMB: null, heapTotalMB: null, heapLimitMB: null, heapSource: 'unavailable' };
  }
}

/**
 * Payload helper — spread into a log event so the heap figure can never be
 * mistaken for "no growth".
 *
 *   logger.warn('some.event', { ...heapFields(), otherStuff });
 *   // Chrome:  { heapMB: 120, heapSource: 'performance.memory' }
 *   // Firefox: { heapMB: null, heapSource: 'unavailable' }
 *
 * @param {{key?: string, precision?: number}} [opts] `key` renames the value
 *   field for call sites that log e.g. `heapUsedMB`.
 */
export function heapFields({ key = 'heapMB', precision = 0 } = {}) {
  const { heapMB, heapSource } = readHeap({ precision });
  return { [key]: heapMB, heapSource };
}

/**
 * Full heap detail for snapshot-style payloads that want total and limit too.
 * Returns `null` values plus an explicit source rather than omitting the keys,
 * so a Firefox snapshot is visibly different from a snapshot that forgot to
 * measure.
 */
export function heapSnapshotFields({ precision = 1 } = {}) {
  const { heapMB, heapTotalMB, heapLimitMB, heapSource } = readHeap({ precision });
  return {
    heapUsedMB: heapMB,
    heapTotalMB,
    heapLimitMB,
    heapSource
  };
}

/**
 * Announce, exactly once per page load, whether memory monitoring works.
 *
 * Call this from any code path whose threshold/warning logic depends on a heap
 * figure. Without it, a leak detector on Firefox is indistinguishable in the
 * logs from a leak detector that is passing.
 *
 * @returns {boolean} whether monitoring is available.
 */
export function reportMemoryMonitoringAvailability(context = {}) {
  const capability = getMemoryCapability();
  const available = capability !== 'unavailable';

  if (!available && !availabilityReported) {
    availabilityReported = true;
    const p = perf();
    logger().warn('perf.memory_monitoring_unavailable', {
      capability,
      hasPerformanceMemory: !!(p && p.memory),
      hasMeasureApi: !!(p && typeof p.measureUserAgentSpecificMemory === 'function'),
      crossOriginIsolated: typeof globalThis !== 'undefined' ? globalThis.crossOriginIsolated === true : false,
      userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : null,
      consequence: 'heap growth thresholds cannot fire; heapMB will report null with heapSource=unavailable',
      ...context
    });
  }

  return available;
}

/** Test seam — clears the announce-once latch and cached child logger. */
export function __resetMemoryProbeForTests() {
  availabilityReported = false;
  _logger = undefined;
}
