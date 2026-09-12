import { describe, it, expect } from 'vitest';
import { assessBudget, describeRemaining, DEFAULT_WARNING_LADDER_MS } from './playBudget.mjs';

const MIN = 60_000;

describe('assessBudget', () => {
  it('reports what is left', () => {
    const r = assessBudget({ playedMs: 10 * MIN, grantedMs: 15 * MIN });
    expect(r.remainingMs).toBe(5 * MIN);
    expect(r.expired).toBe(false);
  });

  it('expires at zero and never goes negative', () => {
    const r = assessBudget({ playedMs: 20 * MIN, grantedMs: 15 * MIN });
    expect(r.remainingMs).toBe(0);
    expect(r.expired).toBe(true);
  });

  it('an unlimited grant never counts down, warns, or expires', () => {
    const r = assessBudget({ playedMs: 10 * 60 * MIN, grantedMs: null });
    expect(r).toEqual({ remainingMs: null, expired: false, dueWarningMs: null, unlimited: true });
  });
});

describe('assessBudget — the warning ladder', () => {
  it('says nothing while there is plenty of time', () => {
    expect(assessBudget({ playedMs: 0, grantedMs: 30 * MIN }).dueWarningMs).toBeNull();
  });

  it('fires the five-minute rung when it is crossed', () => {
    expect(assessBudget({ playedMs: 25 * MIN + 1, grantedMs: 30 * MIN }).dueWarningMs).toBe(300_000);
  });

  it('does not repeat a rung that already fired', () => {
    const r = assessBudget({ playedMs: 26 * MIN, grantedMs: 30 * MIN, warnedMs: [300_000] });
    expect(r.dueWarningMs).toBeNull();
  });

  it('fires the next rung down as time runs out', () => {
    const r = assessBudget({ playedMs: 29 * MIN + 30_000, grantedMs: 30 * MIN, warnedMs: [300_000] });
    expect(r.dueWarningMs).toBe(60_000);
  });

  it('after a blind spot crossing several rungs, says the MOST urgent', () => {
    // Ten seconds left having warned about nothing: "five minutes" would be a
    // lie, and the useful thing to say is the one that is still true.
    const r = assessBudget({ playedMs: 30 * MIN - 10_000, grantedMs: 30 * MIN });
    expect(r.dueWarningMs).toBe(20_000);
  });

  it('stops warning once expired — there is nothing left to warn about', () => {
    const r = assessBudget({ playedMs: 31 * MIN, grantedMs: 30 * MIN });
    expect(r.dueWarningMs).toBeNull();
    expect(r.expired).toBe(true);
  });

  it('gives enough lead time to save, because ending destroys unsaved progress', () => {
    expect(Math.max(...DEFAULT_WARNING_LADDER_MS)).toBeGreaterThanOrEqual(300_000);
  });

  it('rejects nonsense input rather than silently billing it', () => {
    expect(() => assessBudget({ playedMs: -1, grantedMs: MIN })).toThrow(/playedMs/);
    expect(() => assessBudget({ playedMs: 0, grantedMs: -1 })).toThrow(/grantedMs/);
  });
});

describe('describeRemaining', () => {
  it('speaks in units a child hears correctly', () => {
    expect(describeRemaining(300_000)).toBe('5 minutes');
    expect(describeRemaining(60_000)).toBe('1 minute');
    expect(describeRemaining(20_000)).toBe('20 seconds');
  });
});
