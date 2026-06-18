import { describe, it, expect } from 'vitest';
import { eligibleByRecency } from '../../../backend/src/2_domains/art/recencyWindow.mjs';

const pool = (...ids) => ids.map((id) => ({ id }));
const ids = (arr) => arr.map((c) => c.id).sort();

describe('eligibleByRecency', () => {
  it('returns the whole pool when nothing has been shown', () => {
    const cands = pool('a', 'b', 'c', 'd');
    expect(ids(eligibleByRecency(cands, new Map()))).toEqual(['a', 'b', 'c', 'd']);
  });

  it('benches the most-recently-shown floor(fraction*n) items', () => {
    const cands = pool('a', 'b', 'c', 'd');           // n=4, fraction .55 → window 2
    const recency = new Map([
      ['a', '2026-06-17T10:00:00Z'],                  // oldest
      ['b', '2026-06-17T12:00:00Z'],
      ['c', '2026-06-17T13:00:00Z'],                  // most recent two: c, d
      ['d', '2026-06-17T14:00:00Z'],
    ]);
    // c and d are benched; a (oldest) and b stay eligible.
    expect(ids(eligibleByRecency(cands, recency, 0.55))).toEqual(['a', 'b']);
  });

  it('never benches the entire pool (cap at n-1)', () => {
    const cands = pool('a', 'b');
    const recency = new Map([['a', '2026-06-17T10:00:00Z'], ['b', '2026-06-17T11:00:00Z']]);
    // fraction 1.0 would bench both; capped so the most-eligible (oldest) survives.
    expect(eligibleByRecency(cands, recency, 1).length).toBe(1);
    expect(eligibleByRecency(cands, recency, 1)[0].id).toBe('a');
  });

  it('treats never-shown items as eligible regardless of fraction', () => {
    const cands = pool('a', 'b', 'c', 'd');
    const recency = new Map([['a', '2026-06-17T14:00:00Z']]);   // only a has shown
    const out = ids(eligibleByRecency(cands, recency, 0.55));    // window 2, but only 1 shown
    expect(out).toEqual(['b', 'c', 'd']);                        // a benched; rest eligible
  });

  it('accepts a plain object recency map as well as a Map', () => {
    const cands = pool('a', 'b', 'c', 'd');
    const recency = { c: '2026-06-17T13:00:00Z', d: '2026-06-17T14:00:00Z' };
    expect(ids(eligibleByRecency(cands, recency, 0.55))).toEqual(['a', 'b']);
  });

  it('returns single-item and empty pools untouched', () => {
    expect(eligibleByRecency([], new Map())).toEqual([]);
    expect(ids(eligibleByRecency(pool('only'), new Map([['only', 'x']]), 0.9))).toEqual(['only']);
  });
});
