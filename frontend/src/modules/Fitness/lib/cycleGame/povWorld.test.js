import { describe, it, expect } from 'vitest';
import { povWorld, laneX } from './povWorld.js';

const mk = (id, idx, prev, cur, isGhost = false) => ({ id, idx, prev, cur, isGhost });

describe('laneX', () => {
  it('centres a single rider', () => {
    expect(laneX(0, 1, 4, 0.85)).toBe(0);
  });
  it('spreads N riders symmetrically across ±halfW*inset', () => {
    const n = 3, hw = 4, inset = 0.85;
    const xs = [0, 1, 2].map((i) => laneX(i, n, hw, inset));
    expect(xs[0]).toBeCloseTo(-hw * inset);
    expect(xs[2]).toBeCloseTo(hw * inset);
    expect(xs[1]).toBeCloseTo(0);
    expect(xs[0] + xs[2]).toBeCloseTo(0); // symmetric
  });
});

describe('povWorld', () => {
  const base = { lapLengthM: 100, finishM: null, aheadM: 25, gridMinorM: 1, gridMajorM: 10, fogFarM: 220, roadHalfW: 4, laneInset: 0.85 };

  it('places riders at z = -interpolated distance', () => {
    const riders = [mk('a', 0, 40, 50), mk('b', 1, 10, 20)];
    const w = povWorld({ ...base, riders, frac: 0.5, laneCount: 2 });
    expect(w.riders.find((r) => r.id === 'a').z).toBeCloseTo(-45);
    expect(w.riders.find((r) => r.id === 'b').z).toBeCloseTo(-15);
    expect(w.riders.find((r) => r.id === 'a').distM).toBeCloseTo(45);
  });

  it('reports leaderZ (furthest = most negative) and lastZ', () => {
    const riders = [mk('a', 0, 50, 50), mk('b', 1, 20, 20)];
    const w = povWorld({ ...base, riders, frac: 1, laneCount: 2 });
    expect(w.leaderZ).toBeCloseTo(-50);
    expect(w.lastZ).toBeCloseTo(-20);
  });

  it('returns an empty world for no riders', () => {
    const w = povWorld({ ...base, riders: [], frac: 0, laneCount: 0 });
    expect(w.riders).toEqual([]);
    expect(w.marks).toEqual([]);
    expect(w.gates).toEqual([]);
    expect(w.leaderZ).toBe(0);
    expect(w.lastZ).toBe(0);
  });

  it('emits minor marks at 1m and flags/labels 10m majors', () => {
    const riders = [mk('a', 0, 25, 25)];
    const w = povWorld({ ...base, riders, frac: 1, laneCount: 1 });
    const m20 = w.marks.find((x) => x.m === 20);
    const m21 = w.marks.find((x) => x.m === 21);
    expect(m20.major).toBe(true);
    expect(m20.label).toBe('20m');
    expect(m21.major).toBe(false);
    expect(m21.label).toBe(null);
    expect(m20.z).toBeCloseTo(-20);
  });

  it('culls marks farther than fogFarM behind the leader', () => {
    const riders = [mk('a', 0, 300, 300)];
    const w = povWorld({ ...base, riders, frac: 1, laneCount: 1, fogFarM: 220 });
    expect(w.marks.every((x) => x.m >= 300 - 220 - 1e-6)).toBe(true);
    expect(w.marks.some((x) => x.m < 80)).toBe(false);
  });

  it('emits marks ahead of the leader up to aheadM', () => {
    const riders = [mk('a', 0, 50, 50)];
    const w = povWorld({ ...base, riders, frac: 1, laneCount: 1, aheadM: 25 });
    expect(w.marks.some((x) => x.m > 50 && x.m <= 75 + 1e-6)).toBe(true);
    expect(w.marks.some((x) => x.m > 75 + 1e-6)).toBe(false);
  });

  it('emits lap gates behind and ahead (bounded by aheadM), none past finish', () => {
    // leader 190: lap 1 (100m) is behind, lap 2 (200m) is 10m ahead (≤ aheadM=25),
    // lap 3 (300m) is beyond the ahead window so it is not emitted. Finish always shows.
    const riders = [mk('a', 0, 190, 190)];
    const w = povWorld({ ...base, riders, frac: 1, laneCount: 1, lapLengthM: 100, finishM: 400 });
    const laps = w.gates.filter((g) => !g.isFinish).map((g) => g.lap).sort((p, q) => p - q);
    expect(laps).toContain(1); // behind
    expect(laps).toContain(2); // ahead, within aheadM
    expect(laps).not.toContain(3); // beyond the ahead window
    expect(w.gates.every((g) => g.isFinish || g.lap * 100 <= 400 + 1e-6)).toBe(true);
    const finish = w.gates.find((g) => g.isFinish);
    expect(finish.label).toBe('FINISH');
    expect(finish.z).toBeCloseTo(-400);
  });

  it('omits gates when no lap length', () => {
    const riders = [mk('a', 0, 50, 50)];
    const w = povWorld({ ...base, riders, frac: 1, laneCount: 1, lapLengthM: 0 });
    expect(w.gates).toEqual([]);
  });
});
