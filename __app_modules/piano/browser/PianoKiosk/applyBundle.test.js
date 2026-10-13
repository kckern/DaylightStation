import { describe, it, expect } from 'vitest';
import { planBundleOps } from './applyBundle.js';

const bundle = {
  voice: { pc: 16, bank: 0, name: 'Upright' },
  reverb: { type: 3, level: 72, on: true },
  chorus: { type: 0, level: 0, on: false },
};
describe('planBundleOps', () => {
  it('emits voice → reverb → chorus in order and ignores legacy volume', () => {
    expect(planBundleOps(bundle)).toEqual([
      { kind: 'voice', pc: 16, bank: 0 },
      { kind: 'reverb', type: 3, level: 72, on: true },
      { kind: 'chorus', type: 0, level: 0, on: false },
    ]);
  });
  it('skips legs missing from a partial bundle but keeps order', () => {
    expect(planBundleOps({ voice: { pc: 1, bank: 0 }, volume: 90 }))
      .toEqual([{ kind: 'voice', pc: 1, bank: 0 }]);
  });
  it('returns [] for a null/empty bundle', () => {
    expect(planBundleOps(null)).toEqual([]);
    expect(planBundleOps({})).toEqual([]);
  });
});
