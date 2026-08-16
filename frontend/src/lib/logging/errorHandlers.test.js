import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const logged = [];
const fakeLogger = {
  error: (event, data) => logged.push({ level: 'error', event, data }),
  warn: (event, data) => logged.push({ level: 'warn', event, data }),
  info: (event, data) => logged.push({ level: 'info', event, data }),
  debug: (event, data) => logged.push({ level: 'debug', event, data }),
};

vi.mock('./singleton.js', () => ({ getDaylightLogger: () => fakeLogger }));

import { setupGlobalErrorHandlers } from './errorHandlers.js';

/** Drive the handler the way the browser does. */
const reject = (message) => {
  window.dispatchEvent(Object.assign(new Event('unhandledrejection'), {
    reason: new Error(message),
    promise: 'promise',
  }));
};

const suppressionRollups = () => logged.filter((l) => l.event === 'errors.suppressed');
const rejections = () => logged.filter((l) => l.event === 'unhandledrejection');

let cleanup;
// The suppression window lives in module-level state that outlives a test, so
// each test is placed a clear minute after the last: whatever window the
// previous one left open has expired before this one emits anything.
const EPOCH = Date.parse('2026-08-16T18:00:00Z');
let testIndex = 0;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(EPOCH + (testIndex += 1) * 60000);
  logged.length = 0;
  cleanup = setupGlobalErrorHandlers();
});

afterEach(() => {
  cleanup?.();
  vi.useRealTimers();
});

/**
 * A remount storm IS a fetch-failure storm, so the cascade suppressor was
 * deleting exactly the events that described the incident — and saying nothing
 * about having done it. Keep suppressing the bodies; report the count.
 */
describe('network error cascade suppression', () => {
  it('still lets the first few through untouched', () => {
    for (let i = 0; i < 3; i += 1) reject('Failed to fetch');
    expect(rejections()).toHaveLength(3);
    expect(suppressionRollups()).toHaveLength(0);
  });

  it('suppresses the bodies past the threshold', () => {
    for (let i = 0; i < 20; i += 1) reject('Failed to fetch');
    expect(rejections()).toHaveLength(3);
  });

  it('emits one roll-up per window carrying the count and a representative message', () => {
    for (let i = 0; i < 20; i += 1) reject('Failed to fetch loading /api/v1/play/694719');

    vi.advanceTimersByTime(2500);

    const rollups = suppressionRollups();
    expect(rollups, 'the suppressor never said what it deleted').toHaveLength(1);
    expect(rollups[0].level).toBe('warn');
    expect(rollups[0].data.suppressedCount).toBe(17);
    expect(rollups[0].data.representativeMessage).toContain('694719');
    expect(rollups[0].data.windowMs).toBe(2000);
  });

  it('reports the final burst even when nothing arrives after it', () => {
    // Without a timer the roll-up would wait for a NEXT error to trigger the
    // window rollover — so a storm that ends is a storm never reported, and
    // the last window is usually the biggest one.
    for (let i = 0; i < 10; i += 1) reject('Failed to fetch');
    expect(suppressionRollups()).toHaveLength(0);

    vi.advanceTimersByTime(2100);

    expect(suppressionRollups()).toHaveLength(1);
    expect(suppressionRollups()[0].data.suppressedCount).toBe(7);
  });

  it('leaves non-network rejections entirely alone', () => {
    for (let i = 0; i < 20; i += 1) reject('TypeError: x is not a function');
    expect(rejections()).toHaveLength(20);
    vi.advanceTimersByTime(2500);
    expect(suppressionRollups()).toHaveLength(0);
  });
});
