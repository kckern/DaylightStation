import { describe, it, expect } from 'vitest';
import { derivePlayBudget, formatClock, STALE_AFTER_MS } from './usePlayBudget.js';

const T = 1_000_000;
const at = (msg, ageMs = 0) => derivePlayBudget({ message: msg, receivedAt: T, now: T + ageMs });

describe('derivePlayBudget', () => {
  it('shows nothing when no session is running', () => {
    expect(at(null)).toMatchObject({ visible: false, mode: 'idle' });
  });

  it('shows ELAPSED play when no budget was granted', () => {
    // Inventing a countdown with nothing to count down from would be a fiction.
    const r = at({ playedMs: 95_000 });
    expect(r).toMatchObject({ mode: 'elapsed', label: 'played' });
    expect(r.ms).toBe(95_000);
  });

  it('counts down when a budget exists', () => {
    const r = at({ playedMs: 60_000, remainingMs: 300_000 });
    expect(r).toMatchObject({ mode: 'remaining', label: 'remaining' });
    expect(r.ms).toBe(300_000);
  });

  it('advances between messages so the clock is not jerky', () => {
    expect(at({ remainingMs: 300_000 }, 5_000).ms).toBe(295_000);
    expect(at({ playedMs: 10_000 }, 5_000).ms).toBe(15_000);
  });

  it('never counts past zero', () => {
    // Inside the live window, so it really does count down to zero — beyond it
    // the clock freezes instead, which the staleness tests cover.
    const r = at({ remainingMs: 1_000 }, 30_000);
    expect(r.ms).toBe(0);
    expect(r.label).toBe("time's up");
  });

  it('escalates urgency as time runs out', () => {
    expect(at({ remainingMs: 600_000 }).urgency).toBeNull();
    expect(at({ remainingMs: 120_000 }).urgency).toBe('warn');
    expect(at({ remainingMs: 30_000 }).urgency).toBe('crit');
  });
});

describe('derivePlayBudget — a stale feed must not keep ticking', () => {
  it('freezes the number rather than extrapolating', () => {
    // Continuing to count on data we no longer have would tell a child they
    // have time they may not.
    const r = at({ remainingMs: 300_000 }, STALE_AFTER_MS + 10_000);
    expect(r.stale).toBe(true);
    expect(r.ms).toBe(300_000);
  });

  it('is not stale while messages are arriving', () => {
    expect(at({ remainingMs: 300_000 }, 10_000).stale).toBe(false);
  });
});

describe('formatClock', () => {
  it('reads as a clock', () => {
    expect(formatClock(0)).toBe('00:00');
    expect(formatClock(95_000)).toBe('01:35');
    expect(formatClock(600_000)).toBe('10:00');
  });

  it('never shows a negative time', () => {
    expect(formatClock(-5_000)).toBe('00:00');
  });
});
