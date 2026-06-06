import { describe, it, expect } from 'vitest';
import { computeGates } from './povGates.js';
import { BASE_CAMERA } from './povCamera.js';

// k=0.01, rightPct 0.88, aheadT 4 ⇒ window ≈ [leader−88, leader+264].
const cam = BASE_CAMERA;
const K = 0.01;

describe('computeGates', () => {
  it('emits lap gates across the whole window — behind AND ahead of the leader', () => {
    const gates = computeGates(200, K, cam, { lapLengthM: 50, finishM: null });
    const ds = gates.map((g) => g.d);
    expect(ds).toContain(150); // behind the leader
    expect(ds).toContain(250); // ahead of the leader
    expect(ds).toContain(450); // near the ahead horizon
    expect(gates.every((g) => g.isFinish === false)).toBe(true);
  });

  it('a behind gate is on-road; an ahead gate is in the headroom (t>1) and still visible', () => {
    const gates = computeGates(200, K, cam, { lapLengthM: 50, finishM: null });
    const behind = gates.find((g) => g.d === 150);
    const ahead = gates.find((g) => g.d === 250);
    expect(behind.t).toBeLessThan(1);
    expect(behind.opacity).toBeGreaterThan(0);
    expect(ahead.t).toBeGreaterThan(1);            // past the leader, in the headroom
    expect(ahead.opacity).toBeGreaterThan(0);      // now visible (the new road-ahead)
  });

  it('makes the finish gate visible in the headroom as the leader approaches it', () => {
    const gates = computeGates(200, K, cam, { lapLengthM: 50, finishM: 250 });
    const fin = gates.find((g) => g.isFinish);
    expect(fin.d).toBe(250);
    expect(fin.t).toBeGreaterThan(1);
    expect(fin.opacity).toBeGreaterThan(0);        // ahead but within aheadT → drawn
  });

  it('keeps a far-off finish off-road (opacity 0) until it enters the ahead window', () => {
    const gates = computeGates(200, K, cam, { lapLengthM: 50, finishM: 2000 });
    const fin = gates.find((g) => g.isFinish);
    expect(fin.opacity).toBe(0);                   // 2000 m is well beyond the visible horizon
  });

  it('does not double-draw a lap multiple that equals the finish', () => {
    const gates = computeGates(200, K, cam, { lapLengthM: 50, finishM: 200 });
    const at200 = gates.filter((g) => g.d === 200);
    expect(at200).toHaveLength(1);
    expect(at200[0].isFinish).toBe(true);
  });

  it('draws no lap gates past the finish', () => {
    const gates = computeGates(200, K, cam, { lapLengthM: 50, finishM: 250 });
    expect(gates.filter((g) => !g.isFinish).every((g) => g.d <= 250)).toBe(true);
  });

  it('returns nothing when there is no lap length or no zoom', () => {
    expect(computeGates(200, K, cam, { lapLengthM: 0 })).toEqual([]);
    expect(computeGates(200, 0, cam, { lapLengthM: 50 })).toEqual([]);
  });
});
