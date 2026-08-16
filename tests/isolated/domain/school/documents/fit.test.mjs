/**
 * Fit policy decision (spec §7) — pure: given ordered, already-measured
 * attempts (one per density), pick which one satisfies the document's
 * `fit.policy`. The measurement itself (rendering) and the orchestration
 * loop across densities (Task 8's use case) live elsewhere; this is just the
 * decision table.
 */
import { describe, it, expect } from 'vitest';
import { resolveFitPlan } from '#domains/school/documents/fit.mjs';

const normalFits = { density: 'normal', pageCount: 1, oversetPt: 0 };
const normalOverset = { density: 'normal', pageCount: 2, oversetPt: 340 };
const compactFits = { density: 'compact', pageCount: 1, oversetPt: 0 };
const compactOverset = { density: 'compact', pageCount: 2, oversetPt: 90 };

describe('resolveFitPlan — policy: flow', () => {
  it('always returns the normal-density attempt as-is, regardless of pageCount', () => {
    const result = resolveFitPlan({ policy: 'flow', attempts: [normalOverset, compactFits] });
    expect(result).toEqual({ attempt: normalOverset });
  });

  it('never marks growLastPage', () => {
    const result = resolveFitPlan({ policy: 'flow', attempts: [normalFits, compactFits] });
    expect(result.attempt.growLastPage).toBeUndefined();
  });
});

describe('resolveFitPlan — policy: fill', () => {
  // `fill` asks for two things, and both ride on the attempt: `growLastPage`
  // lets the LAST page bottom out its answer spaces, and `balance` asks
  // placement to redistribute fragments evenly across the page count the
  // greedy pass produced rather than front-loading them.
  it('always returns the normal-density attempt marked growLastPage + balance', () => {
    const result = resolveFitPlan({ policy: 'fill', attempts: [normalOverset, compactFits] });
    expect(result).toEqual({ attempt: { ...normalOverset, growLastPage: true, balance: true } });
  });

  it('marks them even when the normal attempt already fits on one page', () => {
    const result = resolveFitPlan({ policy: 'fill', attempts: [normalFits, compactFits] });
    expect(result.attempt).toEqual({ ...normalFits, growLastPage: true, balance: true });
  });
});

describe('resolveFitPlan — policy: one-page', () => {
  it('picks the FIRST attempt whose pageCount is 1 — normal density, when normal already fits', () => {
    const result = resolveFitPlan({ policy: 'one-page', attempts: [normalFits, compactFits] });
    expect(result).toEqual({ attempt: normalFits });
  });

  it('falls through to compact density when normal overflows but compact fits', () => {
    const result = resolveFitPlan({ policy: 'one-page', attempts: [normalOverset, compactFits] });
    expect(result).toEqual({ attempt: compactFits });
  });

  it('errors FIT_OVERSET reporting the COMPACT attempt’s oversetPt when neither density fits', () => {
    const result = resolveFitPlan({ policy: 'one-page', attempts: [normalOverset, compactOverset] });
    expect(result).toEqual({ error: { code: 'FIT_OVERSET', oversetPt: 90 } });
  });

  it('never returns growLastPage on a one-page attempt', () => {
    const result = resolveFitPlan({ policy: 'one-page', attempts: [normalFits, compactFits] });
    expect(result.attempt.growLastPage).toBeUndefined();
  });
});

describe('resolveFitPlan — attempt ordering is not assumed', () => {
  it('one-page still finds the fitting attempt when attempts arrive compact-first', () => {
    const result = resolveFitPlan({ policy: 'one-page', attempts: [compactFits, normalOverset] });
    expect(result).toEqual({ attempt: compactFits });
  });

  it('FIT_OVERSET still reports the COMPACT attempt’s oversetPt when compact is listed first', () => {
    const result = resolveFitPlan({ policy: 'one-page', attempts: [compactOverset, normalOverset] });
    expect(result).toEqual({ error: { code: 'FIT_OVERSET', oversetPt: 90 } });
  });
});
