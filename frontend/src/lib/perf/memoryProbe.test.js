/**
 * Regression guard for DEFECT 1: heap telemetry was dead on Firefox.
 *
 * Every heap probe in the codebase gated on `performance.memory` — a
 * non-standard Chrome-only API. On the garage kiosk (Firefox 152) that meant
 * every sample logged `heapMB: null` and the memory-leak detector never fired,
 * with nothing in the logs to say monitoring was blind.
 *
 * Evidence: homeserver.local media/logs/fitness/2026-07-21T17-53-37.jsonl —
 * 100 minutes of `heapMB: null` / `heapGrowthMB: null`.
 *
 * The contract this file locks down:
 *   1. A reading ALWAYS carries an explicit `heapSource`, never a bare null.
 *   2. `heapSource: 'unavailable'` when no figure is obtainable — a null that
 *      reads like "no growth" is the bug.
 *   3. No fabricated numbers on Firefox.
 *   4. Blindness is announced once, at warn level, so it shows up in the logs.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const warnSpy = vi.fn();
const infoSpy = vi.fn();
const debugSpy = vi.fn();
vi.mock('../logging/Logger.js', () => ({
  default: () => ({
    warn: warnSpy, info: infoSpy, debug: debugSpy, error: vi.fn(), sampled: vi.fn(),
    child: () => ({ warn: warnSpy, info: infoSpy, debug: debugSpy, error: vi.fn(), sampled: vi.fn() })
  }),
  __esModule: true
}));

import {
  readHeap,
  heapFields,
  getMemoryCapability,
  isMemoryMonitoringAvailable,
  reportMemoryMonitoringAvailability,
  __resetMemoryProbeForTests
} from './memoryProbe.js';

const MB = 1048576;

/** Chrome: exposes the non-standard performance.memory. */
function asChrome() {
  globalThis.performance.memory = {
    usedJSHeapSize: 120 * MB,
    totalJSHeapSize: 200 * MB,
    jsHeapSizeLimit: 2048 * MB
  };
}

/** Firefox: no performance.memory at all. */
function asFirefox({ crossOriginIsolated = false, measureApi = false } = {}) {
  delete globalThis.performance.memory;
  globalThis.crossOriginIsolated = crossOriginIsolated;
  if (measureApi) {
    globalThis.performance.measureUserAgentSpecificMemory = vi.fn();
  } else {
    delete globalThis.performance.measureUserAgentSpecificMemory;
  }
}

beforeEach(() => {
  warnSpy.mockClear(); infoSpy.mockClear(); debugSpy.mockClear();
  __resetMemoryProbeForTests();
});

afterEach(() => {
  delete globalThis.performance.memory;
  delete globalThis.performance.measureUserAgentSpecificMemory;
  delete globalThis.crossOriginIsolated;
});

describe('memoryProbe — Chrome (performance.memory present)', () => {
  it('reports a real heap figure and names its source', () => {
    asChrome();
    const reading = readHeap();
    expect(reading.heapMB).toBe(120);
    expect(reading.heapSource).toBe('performance.memory');
    expect(reading.heapTotalMB).toBe(200);
    expect(reading.heapLimitMB).toBe(2048);
  });

  it('reports the capability as available', () => {
    asChrome();
    expect(getMemoryCapability()).toBe('performance.memory');
    expect(isMemoryMonitoringAvailable()).toBe(true);
  });

  it('does not warn about unavailable monitoring', () => {
    asChrome();
    reportMemoryMonitoringAvailability();
    const warned = warnSpy.mock.calls.some(([ev]) => ev === 'perf.memory_monitoring_unavailable');
    expect(warned).toBe(false);
  });
});

describe('memoryProbe — Firefox (no performance.memory)', () => {
  it('says "unavailable" explicitly rather than emitting a bare null', () => {
    asFirefox();
    const reading = readHeap();
    expect(reading.heapMB).toBeNull();
    expect(reading.heapSource).toBe('unavailable');
  });

  it('never fabricates a heap number', () => {
    asFirefox();
    const reading = readHeap();
    expect(typeof reading.heapMB === 'number').toBe(false);
    expect(reading.heapTotalMB).toBeNull();
    expect(reading.heapLimitMB).toBeNull();
  });

  it('does NOT claim measureUserAgentSpecificMemory works outside cross-origin isolation', () => {
    // Firefox exposes the API only in cross-origin-isolated contexts; the
    // garage kiosk is not isolated, so capability must degrade honestly.
    asFirefox({ measureApi: true, crossOriginIsolated: false });
    expect(getMemoryCapability()).toBe('unavailable');
    expect(isMemoryMonitoringAvailable()).toBe(false);
    expect(readHeap().heapSource).toBe('unavailable');
  });

  it('recognises measureUserAgentSpecificMemory when the context IS isolated', () => {
    asFirefox({ measureApi: true, crossOriginIsolated: true });
    expect(getMemoryCapability()).toBe('measureUserAgentSpecificMemory');
    expect(isMemoryMonitoringAvailable()).toBe(true);
    // Still no synchronous figure — that API is async.
    const reading = readHeap();
    expect(reading.heapMB).toBeNull();
    expect(reading.heapSource).toBe('async-only');
  });

  it('announces the blindness exactly once, at warn level', () => {
    asFirefox();
    for (let i = 0; i < 25; i += 1) reportMemoryMonitoringAvailability();
    const calls = warnSpy.mock.calls.filter(([ev]) => ev === 'perf.memory_monitoring_unavailable');
    expect(calls).toHaveLength(1);
    expect(calls[0][1]).toEqual(expect.objectContaining({
      capability: 'unavailable',
      hasPerformanceMemory: false
    }));
  });
});

describe('memoryProbe — heapFields payload helper', () => {
  it('always carries heapSource so a null can never read as "no growth"', () => {
    asFirefox();
    const fields = heapFields();
    expect(fields).toEqual({ heapMB: null, heapSource: 'unavailable' });
    expect('heapSource' in fields).toBe(true);
  });

  it('carries the value and source on Chrome', () => {
    asChrome();
    expect(heapFields()).toEqual({ heapMB: 120, heapSource: 'performance.memory' });
  });

  it('supports renaming the value key for call sites with other conventions', () => {
    asChrome();
    expect(heapFields({ key: 'heapUsedMB' })).toEqual({
      heapUsedMB: 120,
      heapSource: 'performance.memory'
    });
  });
});
