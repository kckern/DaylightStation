import { describe, it, expect } from 'vitest';
import { computeScaleBasisValue, isExemptEntry } from './logScaleBasis.js';

const entry = (id, lastValue) => ({ id, lastValue });

describe('isExemptEntry', () => {
  it('matches by normalized name (case + whitespace insensitive)', () => {
    const exempt = ['Soren', ' grandpa-kern '];
    expect(isExemptEntry(entry('soren', 12), exempt)).toBe(true);
    expect(isExemptEntry(entry('SOREN', 12), exempt)).toBe(true);
    expect(isExemptEntry(entry('grandpa-kern', 12), exempt)).toBe(true);
    expect(isExemptEntry(entry('kckern', 382), exempt)).toBe(false);
  });

  it('falls back to profileId when id is absent', () => {
    expect(isExemptEntry({ profileId: 'soren', lastValue: 12 }, ['soren'])).toBe(true);
  });

  it('treats an empty/missing exemption list as nobody exempt', () => {
    expect(isExemptEntry(entry('soren', 12), [])).toBe(false);
    expect(isExemptEntry(entry('soren', 12), undefined)).toBe(false);
  });
});

describe('computeScaleBasisValue', () => {
  // The real 2026-07-21 session: four racers 382..463, baby joins at minute 20
  // with 12 coins. 12 as the basis drives k -> ~0.38 and flattens the racers.
  const session = [
    entry('alan', 463),
    entry('felix', 456),
    entry('kckern', 382),
    entry('milo', 401),
    entry('soren', 12)
  ];

  it('excludes exempt participants from the basis', () => {
    expect(computeScaleBasisValue(session, ['soren'], 0)).toBe(382);
  });

  it('is unchanged when no exemptions are configured', () => {
    expect(computeScaleBasisValue(session, [], 0)).toBe(12);
  });

  it('suspends exemptions when every participant is exempt', () => {
    // Mirrors GovernanceEngine._exemptionsApply: with no non-exempt participant
    // the exemption is suspended rather than yielding an empty basis.
    const allExempt = [entry('soren', 12), entry('grandpa-kern', 30)];
    expect(computeScaleBasisValue(allExempt, ['soren', 'grandpa-kern'], 0)).toBe(12);
  });

  it('ignores non-finite lastValue', () => {
    const entries = [entry('alan', 463), entry('felix', null), entry('milo', NaN)];
    expect(computeScaleBasisValue(entries, [], 0)).toBe(463);
  });

  it('falls back to minDataValue when nothing has a finite value', () => {
    expect(computeScaleBasisValue([entry('a', null)], [], 55)).toBe(55);
    expect(computeScaleBasisValue([], [], 55)).toBe(55);
  });

  it('never returns a negative basis', () => {
    expect(computeScaleBasisValue([entry('a', -20)], [], -30)).toBe(0);
  });

  it('keeps the exempt participant out even when it is not the lowest', () => {
    const entries = [entry('soren', 500), entry('kckern', 382)];
    expect(computeScaleBasisValue(entries, ['soren'], 0)).toBe(382);
  });
});
