/**
 * `resolveFitPlan` unit tests (spec §7 "Layout manager and fit").
 *
 * Pure decision logic: attempts in, chosen attempt (or a structured overset
 * error) out. Nothing here measures anything.
 */
import { describe, it, expect } from 'vitest';
import { resolveFitPlan } from './fit.mjs';

const attempt = (density, pageCount, oversetPt = 0) => ({ density, pageCount, oversetPt });

describe('resolveFitPlan — fill', () => {
  it('sets BOTH growLastPage and balance', () => {
    const { attempt: chosen } = resolveFitPlan({
      policy: 'fill',
      attempts: [attempt('normal', 2)],
    });

    expect(chosen.growLastPage).toBe(true);
    expect(chosen.balance).toBe(true);
  });

  it('carries the normal-density attempt through untouched apart from those two flags', () => {
    const normal = attempt('normal', 2, 0);
    const { attempt: chosen } = resolveFitPlan({
      policy: 'fill',
      attempts: [normal, attempt('compact', 1, 0)],
    });

    expect(chosen).toEqual({ ...normal, growLastPage: true, balance: true });
    expect(normal).toEqual(attempt('normal', 2, 0)); // input not mutated
  });
});

describe('resolveFitPlan — flow and one-page never request growth or balance', () => {
  it('flow', () => {
    const { attempt: chosen } = resolveFitPlan({
      policy: 'flow',
      attempts: [attempt('normal', 2)],
    });

    expect(chosen.balance).toBeUndefined();
    expect(chosen.growLastPage).toBeUndefined();
  });

  it('one-page', () => {
    const { attempt: chosen } = resolveFitPlan({
      policy: 'one-page',
      attempts: [attempt('normal', 1)],
    });

    expect(chosen.balance).toBeUndefined();
    expect(chosen.growLastPage).toBeUndefined();
  });
});

describe('resolveFitPlan — one-page overset', () => {
  it('picks the first attempt that fits on one page', () => {
    const { attempt: chosen } = resolveFitPlan({
      policy: 'one-page',
      attempts: [attempt('normal', 2, 40), attempt('compact', 1, 0)],
    });

    expect(chosen.density).toBe('compact');
  });

  it('reports the COMPACT overset when no density fits', () => {
    const { error } = resolveFitPlan({
      policy: 'one-page',
      attempts: [attempt('normal', 2, 120), attempt('compact', 2, 40)],
    });

    expect(error).toEqual({ code: 'FIT_OVERSET', oversetPt: 40 });
  });
});

describe('resolveFitPlan — unknown policy', () => {
  it('throws rather than silently defaulting', () => {
    expect(() => resolveFitPlan({ policy: 'nonsense', attempts: [attempt('normal', 1)] }))
      .toThrow(/unknown fit.policy/);
  });
});
