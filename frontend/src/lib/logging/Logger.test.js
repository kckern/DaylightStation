import { describe, it, expect } from 'vitest';
import getLogger, { getRecentEvents } from './Logger.js';

// The recent-events ring buffer tails every emitted event, so counting
// 'session-log.start' before/after a child creation is a clean way to assert how
// many starts a given child chain fired — no transport spy or postMessage needed.
const countStarts = () => getRecentEvents(300).filter((e) => e.event === 'session-log.start').length;

describe('Logger.child — session-log.start emission', () => {
  it('emits session-log.start once for a directly-created sessionLog child', () => {
    const before = countStarts();
    getLogger().child({ component: 'x', app: 'piano-composer', sessionLog: true });
    expect(countStarts() - before).toBe(1);
  });

  it('does NOT re-emit session-log.start for a child derived from a sessionLog child', () => {
    const before = countStarts();
    const modeLogger = getLogger().child({ component: 'm', app: 'piano-composer', sessionLog: true }); // 1 start
    modeLogger.child({ component: 'editor' }); // must NOT emit a 2nd start
    expect(countStarts() - before).toBe(1);
  });
});

describe('Logger.sampled — level option', () => {
  it('emits at the requested level (default info)', () => {
    const log = getLogger().child({ component: 'sampled-level-test' });
    const name = `sampled-level-${Date.now()}`;
    log.sampled(`${name}.warn`, { a: 1 }, { maxPerMinute: 5, level: 'warn' });
    log.sampled(`${name}.info`, { a: 1 }, { maxPerMinute: 5 });
    const recent = getRecentEvents(300);
    expect(recent.find((e) => e.event === `${name}.warn`)?.level).toBe('warn');
    expect(recent.find((e) => e.event === `${name}.info`)?.level).toBe('info');
  });
});

describe('Logger — device identity in context', () => {
  it('stamps ?device= from the page URL on every event as context.deviceId', async () => {
    const { vi } = await import('vitest');
    window.history.replaceState(null, '', '/fitness?device=garage-tv');
    vi.resetModules();
    const fresh = await import('./Logger.js');
    window.history.replaceState(null, '', '/fitness/home'); // the router drops it
    const name = `device-ctx-${Date.now()}`;
    fresh.default().child({ component: 'device-test' }).info(name, {});
    const evt = fresh.getRecentEvents(50).find((e) => e.event === name);
    expect(evt.context.deviceId).toBe('garage-tv');
    window.localStorage.removeItem('daylight.log.deviceId');
  });
});

describe('Logger.sampled — aggregation survives a field changing type', () => {
  it('does not throw when a field is a number in one sample and a string in the next', () => {
    const log = getLogger().child({ component: 'sampled-mixed-test' });
    const name = `sampled-mixed-${Date.now()}`;
    expect(() => {
      for (let i = 0; i < 6; i++) {
        log.sampled(name, { rule: i % 2 ? 'some' : 1 }, { maxPerMinute: 1, aggregate: true });
      }
    }).not.toThrow();
  });
});

describe('flushLogs', () => {
  it('never throws and resolves within its timeout', async () => {
    const { flushLogs } = await import('./Logger.js');
    const t0 = Date.now();
    const ok = await flushLogs({ timeoutMs: 50, wsService: { ws: { readyState: 1, bufferedAmount: 999 } } });
    expect(typeof ok).toBe('boolean');
    expect(Date.now() - t0).toBeLessThan(1000);
  });
});
