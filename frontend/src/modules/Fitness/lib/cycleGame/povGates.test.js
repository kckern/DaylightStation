import { describe, it, expect } from 'vitest';
import { computeGates } from './povGates.js';
import { BASE_CAMERA } from './povCamera.js';

// k=0.01 with rightPct 0.88 ⇒ visible window ≈ 88 m behind the leader.
const cam = BASE_CAMERA;
const K = 0.01;

describe('computeGates', () => {
  it('places a gate at each lap multiple in the visible window behind the leader', () => {
    const gates = computeGates(200, K, cam, { lapLengthM: 50, finishM: null });
    expect(gates.map((g) => g.d)).toEqual([150, 200]); // window [112,200]: 150, 200
    expect(gates.map((g) => g.lap)).toEqual([3, 4]);
    expect(gates.every((g) => g.isFinish === false)).toBe(true);
  });

  it('a mid-road lap gate is on-road (opacity > 0), the one at the horizon fades', () => {
    const gates = computeGates(200, K, cam, { lapLengthM: 50, finishM: null });
    const mid = gates.find((g) => g.d === 150);
    expect(mid.opacity).toBeGreaterThan(0);
    expect(mid.scale).toBeGreaterThan(0);
  });

  it('adds a finish gate; while it is ahead of the leader it is off-road (opacity 0)', () => {
    const gates = computeGates(200, K, cam, { lapLengthM: 50, finishM: 250 });
    const fin = gates.find((g) => g.isFinish);
    expect(fin).toBeTruthy();
    expect(fin.d).toBe(250);
    expect(fin.opacity).toBe(0); // 250 is ahead of the leader at 200 → beyond the horizon
  });

  it('does not double-draw a lap multiple that equals the finish', () => {
    const gates = computeGates(200, K, cam, { lapLengthM: 50, finishM: 200 });
    const at200 = gates.filter((g) => g.d === 200);
    expect(at200).toHaveLength(1);
    expect(at200[0].isFinish).toBe(true); // drawn as FINISH, not a LAP gate
  });

  it('draws no lap gates past the finish', () => {
    const gates = computeGates(300, K, cam, { lapLengthM: 50, finishM: 250 });
    expect(gates.filter((g) => !g.isFinish).every((g) => g.d <= 250)).toBe(true);
  });

  it('returns nothing when there is no lap length or no zoom', () => {
    expect(computeGates(200, K, cam, { lapLengthM: 0 })).toEqual([]);
    expect(computeGates(200, 0, cam, { lapLengthM: 50 })).toEqual([]);
  });
});
