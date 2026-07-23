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
