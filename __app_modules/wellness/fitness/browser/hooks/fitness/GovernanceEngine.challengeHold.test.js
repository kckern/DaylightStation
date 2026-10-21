import { describe, it, expect } from 'vitest';
import { GovernanceEngine } from './GovernanceEngine.js';

const ZONES = { cool: 0, active: 1, warm: 2, hot: 3, fire: 4 };
function engineAt(holdSeconds) {
  let now = 1_000_000;
  const engine = new GovernanceEngine(null, { now: () => now });
  engine.config = holdSeconds == null ? {} : { challenge_hold_seconds: holdSeconds };
  engine._latestInputs = { ...(engine._latestInputs || {}), zoneRankMap: ZONES, guestIds: [] };
  return { engine, advance: (ms) => { now += ms; } };
}
const eval1 = (engine, challenge, zones) =>
  engine.evaluateChallengeZone(challenge, Object.keys(zones), zones, Object.keys(zones).length);

describe('challenge hold', () => {
  it('a rider already in zone counts only after 10 continuous seconds', () => {
    const { engine, advance } = engineAt(undefined);
    const ch = { zone: 'warm', rule: 1 };
    expect(eval1(engine, ch, { a: 'warm' }).satisfied).toBe(false);
    advance(9_000); expect(eval1(engine, ch, { a: 'warm' }).satisfied).toBe(false);
    advance(1_000); expect(eval1(engine, ch, { a: 'warm' }).satisfied).toBe(true);
  });
  it('dropping out resets the hold', () => {
    const { engine, advance } = engineAt(10);
    const ch = { zone: 'warm', rule: 1 };
    eval1(engine, ch, { a: 'warm' }); advance(9_000);
    eval1(engine, ch, { a: 'active' }); advance(1_000);
    expect(eval1(engine, ch, { a: 'warm' }).satisfied).toBe(false);
    advance(10_000); expect(eval1(engine, ch, { a: 'warm' }).satisfied).toBe(true);
  });
  it('hold 0 keeps instant completion', () => {
    const { engine } = engineAt(0);
    expect(eval1(engine, { zone: 'warm', rule: 1 }, { a: 'warm' }).satisfied).toBe(true);
  });
  it('reports riders mid-hold and the time until the earliest hold ends', () => {
    const { engine, advance } = engineAt(10);
    const ch = { zone: 'warm', rule: 'all' };
    eval1(engine, ch, { a: 'warm', b: 'cool' });
    advance(4_000);
    const r = eval1(engine, ch, { a: 'warm', b: 'warm' });
    expect(r.metUsers).toEqual([]);
    expect(r.holding).toEqual(['a', 'b']);
    expect(r.holdRemainingMs).toBe(6_000);
    advance(6_000);
    const r2 = eval1(engine, ch, { a: 'warm', b: 'warm' });
    expect(r2.metUsers).toEqual(['a']);
    expect(r2.holding).toEqual(['b']);
    expect(r2.holdRemainingMs).toBe(4_000);
    expect(r2.satisfied).toBe(false);
  });
});
