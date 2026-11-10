import { describe, it, expect } from 'vitest';
import { planSteps, dueAnchoredSteps, advance } from './stepping.mjs';

const S = 1 / 60;

describe('planSteps', () => {
  it('partial: full steps then a short last step', () => {
    const { dts, carryS } = planSteps(0.05, { stepS: S });
    expect(dts).toHaveLength(3);
    expect(dts[0]).toBe(S);
    expect(dts[1]).toBe(S);
    expect(dts[2]).toBeCloseTo(0.05 - 2 / 60, 12);
    expect(carryS).toBe(0);
  });
  it('partial: nothing for zero or negligible elapsed', () => {
    expect(planSteps(0, { stepS: S }).dts).toEqual([]);
    expect(planSteps(1e-10, { stepS: S }).dts).toEqual([]);
  });
  it('carry: exact multiples count, remainder ~0', () => {
    const r = planSteps(0.05, { stepS: S, remainder: 'carry', carryS: 0 });
    expect(r.dts.length).toBe(3);
    expect(r.carryS).toBeCloseTo(0, 9);
  });
  it('carry: folds in prior carry', () => {
    const r = planSteps(0.02, { stepS: S, remainder: 'carry', carryS: 0.015 });
    expect(r.dts.length).toBe(2);
    expect(r.carryS).toBeCloseTo(0.035 - 2 / 60, 9);
  });
});

describe('dueAnchoredSteps', () => {
  it('computes due and capped run', () => {
    expect(dueAnchoredSteps({ sinceAnchor: 5400, stepsTaken: 0, step: 1000, maxSteps: 30 })).toEqual({ due: 5, run: 5 });
    expect(dueAnchoredSteps({ sinceAnchor: 600000, stepsTaken: 0, step: 1000, maxSteps: 30 })).toEqual({ due: 600, run: 30 });
  });
  it('null anchor means one step', () => {
    expect(dueAnchoredSteps({ sinceAnchor: null, stepsTaken: 7, step: 1000 })).toEqual({ due: 1, run: 1 });
  });
  it('never negative', () => {
    expect(dueAnchoredSteps({ sinceAnchor: 500, stepsTaken: 3, step: 1000 }).due).toBe(0);
  });
});

describe('advance', () => {
  it('clears once-per-frame inputs after the first step', () => {
    const seen = [];
    const state = { n: 0 };
    const r = advance(state, { rpm: 80, actions: ['laser'] }, 0.05, {
      stepS: S,
      step: (s, input) => { seen.push(input); return { n: s.n + 1 }; },
    });
    expect(seen.map((i) => i.actions)).toEqual([['laser'], undefined, undefined]);
    expect(seen.map((i) => i.rpm)).toEqual([80, 80, 80]);
    expect(r.steps).toBe(3);
    expect(r.state.n).toBe(3);
  });
  it('zero elapsed steps nothing and keeps the state reference', () => {
    let calls = 0;
    const state = { n: 0 };
    const r = advance(state, {}, 0, { stepS: S, step: (s) => { calls++; return s; } });
    expect(calls).toBe(0);
    expect(r.state).toBe(state);
    expect(r.steps).toBe(0);
  });
});
