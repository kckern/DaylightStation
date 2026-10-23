import { describe, it, expect, vi } from 'vitest';
vi.mock('../../../../../../frontend/src/lib/logging/Logger.js', () => {
  const noop = () => {};
  const logger = { child: () => logger, debug: noop, info: noop, warn: noop, error: noop, sampled: noop };
  return { default: () => logger };
});
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
  it.each([undefined, 'invalid', -1, Infinity, NaN])('credits immediately with default/invalid hold %s', (setting) => {
    const { engine } = engineAt(setting);
    expect(eval1(engine, { zone: 'warm', rule: 1 }, { a: 'warm' }).satisfied).toBe(true);
  });
  it('reports personal timing for staggered riders without cross-challenge credit', () => {
    const { engine, advance } = engineAt(10);
    const challenge = { zone: 'warm', rule: 'all' };
    eval1(engine, challenge, { a: 'warm', b: 'active' });
    advance(4000);
    const result = eval1(engine, challenge, { a: 'warm', b: 'warm' });
    expect(result.holdProgressByUser).toEqual({
      a: { elapsedMs: 4000, remainingMs: 6000, totalMs: 10000 },
      b: { elapsedMs: 0, remainingMs: 10000, totalMs: 10000 },
    });
    const other = eval1(engine, { zone: 'warm', rule: 'all' }, { a: 'warm', b: 'warm' });
    expect(other.holdProgressByUser.a.elapsedMs).toBe(0);
    advance(6000);
    expect(eval1(engine, challenge, { a: 'warm', b: 'warm' }).missingUsers).toEqual(['b']);
  });
  it('supports an explicit one-second uninterrupted hold', () => {
    const { engine, advance } = engineAt(1);
    const challenge = { zone: 'warm', rule: 1 };
    expect(eval1(engine, challenge, { a: 'warm' }).satisfied).toBe(false);
    advance(999); expect(eval1(engine, challenge, { a: 'warm' }).satisfied).toBe(false);
    advance(1); expect(eval1(engine, challenge, { a: 'warm' }).satisfied).toBe(true);
  });
  it('a rider already in zone counts only after 10 continuous seconds', () => {
    const { engine, advance } = engineAt(10);
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
  it('a missing committed zone cannot satisfy even a Cool base requirement', () => {
    const { engine } = engineAt(0);
    expect(engine._evaluateZoneRequirement('cool', 'all', ['a'], { a: null }, ZONES, {}, 1).satisfied).toBe(false);
  });
  it('never credits an untrusted null committed zone even for a Cool target', () => {
    const { engine } = engineAt(0);
    expect(eval1(engine, { zone: 'cool', rule: 1 }, { a: null }).satisfied).toBe(false);
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
