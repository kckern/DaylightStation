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
  it('always returns the normal-density attempt marked growLastPage: true', () => {
    const result = resolveFitPlan({ policy: 'fill', attempts: [normalOverset, compactFits] });
    expect(result).toEqual({ attempt: { ...normalOverset, growLastPage: true } });
  });

  it('marks growLastPage even when the normal attempt already fits on one page', () => {
    const result = resolveFitPlan({ policy: 'fill', attempts: [normalFits, compactFits] });
    expect(result.attempt).toEqual({ ...normalFits, growLastPage: true });
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

// `prefer-one-page`: the household rule this policy exists to satisfy has two
// halves — "we can only use two pages if we have an exceptionally long
// number of questions" (try hard to land on one page, same normal-then-
// compact search `one-page` already does) AND "within each page there should
// be right sizing" (even the pages that DO get produced must not be loosely
// spaced). Unlike `one-page`, it must never hard-fail — a genuinely long
// document still has to print, just spilled rather than rejected. These
// three describe blocks are the three outcomes TDD'd for this policy: fits
// at normal, fits only at compact, fits at neither (spills).
describe('resolveFitPlan — policy: prefer-one-page', () => {
  describe('outcome 1: fits at normal', () => {
    it('picks the normal attempt directly, same as one-page would', () => {
      const result = resolveFitPlan({ policy: 'prefer-one-page', attempts: [normalFits, compactFits] });
      expect(result).toEqual({ attempt: normalFits });
    });
  });

  describe('outcome 2: fits only at compact', () => {
    it('falls through to the compact attempt when normal overflows but compact fits', () => {
      const result = resolveFitPlan({ policy: 'prefer-one-page', attempts: [normalOverset, compactFits] });
      expect(result).toEqual({ attempt: compactFits });
    });
  });

  describe('outcome 3: fits at neither — spills instead of failing', () => {
    it('never returns an error — the one-page/prefer-one-page divergence', () => {
      const result = resolveFitPlan({ policy: 'prefer-one-page', attempts: [normalOverset, compactOverset] });
      expect(result.error).toBeUndefined();
    });

    it('spills using the COMPACT attempt (right-sized even while spilled), not the loosely-spaced normal one', () => {
      const result = resolveFitPlan({ policy: 'prefer-one-page', attempts: [normalOverset, compactOverset] });
      expect(result).toEqual({ attempt: compactOverset });
    });

    it('falls back to the normal attempt if no compact attempt was ever measured (defensive — the real orchestration loop always measures compact when normal overflows for this policy)', () => {
      const result = resolveFitPlan({ policy: 'prefer-one-page', attempts: [normalOverset] });
      expect(result).toEqual({ attempt: normalOverset });
    });
  });

  it('never marks growLastPage — unlike `fill`, right-sizing here means density, not answer-space growth', () => {
    const result = resolveFitPlan({ policy: 'prefer-one-page', attempts: [normalOverset, compactOverset] });
    expect(result.attempt.growLastPage).toBeUndefined();
  });

  it('attempt ordering is not assumed, same as one-page', () => {
    const result = resolveFitPlan({ policy: 'prefer-one-page', attempts: [compactFits, normalOverset] });
    expect(result).toEqual({ attempt: compactFits });
  });
});
