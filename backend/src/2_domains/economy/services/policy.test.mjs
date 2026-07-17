import { describe, it, expect } from 'vitest';
import { resolvePolicy, inBlackout, drainPerSecond } from './policy.mjs';

const CONFIG = {
  earn: { 'piano-lesson-complete': { reward: 5, per: 'completion', daily_cap: 20 } },
  spend: { 'arcade-play': { cost: 2, per: '10min', self_serve: true, auth: 'identify', blackout: ['22:00-07:00'] } },
  users: {
    jimmy: { 'arcade-play': { blackout: ['22:00-07:00', '15:00-17:00'], daily_cap: 6 } },
  },
};

describe('resolvePolicy', () => {
  it('returns household default when no override', () => {
    const p = resolvePolicy(CONFIG, 'susie', 'arcade-play');
    expect(p).toMatchObject({ cost: 2, per: '10min', auth: 'identify' });
    expect(p.blackout).toEqual(['22:00-07:00']);
  });
  it('merges per-kid override, most-specific-wins', () => {
    const p = resolvePolicy(CONFIG, 'jimmy', 'arcade-play');
    expect(p.blackout).toEqual(['22:00-07:00', '15:00-17:00']);
    expect(p.daily_cap).toBe(6);
    expect(p.cost).toBe(2); // inherited
  });
  it('finds earn actions too, and returns null for unknown actions', () => {
    expect(resolvePolicy(CONFIG, 'jimmy', 'piano-lesson-complete')).toMatchObject({ reward: 5 });
    expect(resolvePolicy(CONFIG, 'jimmy', 'nope')).toBeNull();
  });
});

describe('inBlackout', () => {
  it('handles overnight ranges', () => {
    expect(inBlackout(['22:00-07:00'], new Date('2026-07-17T23:30:00'))).toBe(true);
    expect(inBlackout(['22:00-07:00'], new Date('2026-07-17T06:15:00'))).toBe(true);
    expect(inBlackout(['22:00-07:00'], new Date('2026-07-17T12:00:00'))).toBe(false);
  });
  it('handles same-day ranges and empty lists', () => {
    expect(inBlackout(['15:00-17:00'], new Date('2026-07-17T16:00:00'))).toBe(true);
    expect(inBlackout([], new Date())).toBe(false);
    expect(inBlackout(undefined, new Date())).toBe(false);
  });
  it('treats start as inclusive and end as exclusive at exact boundaries', () => {
    // overnight 22:00-07:00
    expect(inBlackout(['22:00-07:00'], new Date('2026-07-17T22:00:00'))).toBe(true);
    expect(inBlackout(['22:00-07:00'], new Date('2026-07-17T07:00:00'))).toBe(false);
    // same-day 15:00-17:00
    expect(inBlackout(['15:00-17:00'], new Date('2026-07-17T15:00:00'))).toBe(true);
    expect(inBlackout(['15:00-17:00'], new Date('2026-07-17T17:00:00'))).toBe(false);
  });
});

describe('drainPerSecond', () => {
  it('converts cost/per into coins-per-second', () => {
    expect(drainPerSecond({ cost: 2, per: '10min' })).toBeCloseTo(2 / 600);
    expect(drainPerSecond({ cost: 3, per: '20min' })).toBeCloseTo(3 / 1200);
  });
});
