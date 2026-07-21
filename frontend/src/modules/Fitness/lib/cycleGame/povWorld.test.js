import { describe, it, expect } from 'vitest';
import { povWorld, laneX, displayGap, displayDist, povBadges, resolveBadgeStack } from './povWorld.js';

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

describe('displayGap (gap compression)', () => {
  it('is identity for gaps ≤ 100 m', () => {
    for (const g of [0, 1, 42, 99, 100]) expect(displayGap(g)).toBeCloseTo(g);
  });
  it('is identity for negative gaps (points behind the anchor)', () => {
    for (const g of [-1, -30, -220]) expect(displayGap(g)).toBeCloseTo(g);
  });
  it('compresses gaps beyond 100 m below the raw gap', () => {
    for (const g of [120, 200, 500, 1000]) expect(displayGap(g)).toBeLessThan(g);
  });
  it('is strictly monotonic increasing', () => {
    let prev = -Infinity;
    for (const g of [0, 50, 100, 100.001, 150, 300, 800, 2000]) {
      const d = displayGap(g);
      expect(d).toBeGreaterThan(prev);
      prev = d;
    }
  });
  it('grows slowly (a 1 km gap displays as ~226 m)', () => {
    expect(displayGap(1000)).toBeGreaterThan(200);
    expect(displayGap(1000)).toBeLessThan(240);
  });
  it('matches the spec formula beyond the window', () => {
    expect(displayGap(300)).toBeCloseTo(100 + 40 * Math.log1p((300 - 100) / 40));
  });
  it('has no kink at the compression boundary (continuity)', () => {
    expect(displayGap(100)).toBe(100);
    expect(displayGap(100.001)).toBeCloseTo(100.001, 2);
  });
});

describe('displayDist', () => {
  it('places the anchor itself and near points at true distance', () => {
    expect(displayDist(100, 100)).toBeCloseTo(100); // gap 0
    expect(displayDist(150, 100)).toBeCloseTo(150); // gap 50 (identity)
    expect(displayDist(70, 100)).toBeCloseTo(70);   // 30 m behind (identity)
  });
  it('compresses a far point toward the anchor', () => {
    const d = displayDist(400, 100); // gap 300 → 100 + displayGap(300)
    expect(d).toBeCloseTo(100 + displayGap(300));
    expect(d).toBeLessThan(400);
  });
});

describe('povWorld', () => {
  const base = { lapLengthM: 100, finishM: null, aheadM: 25, behindM: 30, gridMinorM: 1, gridMajorM: 10, roadHalfW: 4, laneInset: 0.85 };

  it('places riders at z = -interpolated distance (identity within the window)', () => {
    const riders = [mk('a', 0, 40, 50), mk('b', 1, 10, 20)];
    const w = povWorld({ ...base, riders, frac: 0.5, laneCount: 2 });
    // anchor = last (15); a is 30 m ahead → identity → z = -45.
    expect(w.riders.find((r) => r.id === 'a').z).toBeCloseTo(-45);
    expect(w.riders.find((r) => r.id === 'b').z).toBeCloseTo(-15);
    expect(w.riders.find((r) => r.id === 'a').distM).toBeCloseTo(45);
  });

  it('reports leaderZ/lastZ (compressed) and leaderM/lastM (true)', () => {
    const riders = [mk('a', 0, 50, 50), mk('b', 1, 20, 20)];
    const w = povWorld({ ...base, riders, frac: 1, laneCount: 2 });
    expect(w.leaderZ).toBeCloseTo(-50); // gap 30 → identity
    expect(w.lastZ).toBeCloseTo(-20);
    expect(w.leaderM).toBeCloseTo(50);
    expect(w.lastM).toBeCloseTo(20);
  });

  it('compresses a far leader so it renders much nearer than its true z', () => {
    const riders = [mk('a', 0, 400, 400), mk('b', 1, 100, 100)];
    const w = povWorld({ ...base, riders, frac: 1, laneCount: 2 });
    expect(w.leaderM).toBeCloseTo(400);          // true distance preserved
    expect(-w.leaderZ).toBeLessThan(400);        // displayed nearer than true
    expect(-w.leaderZ).toBeCloseTo(100 + displayGap(300));
  });

  it('returns an empty world for no riders', () => {
    const w = povWorld({ ...base, riders: [], frac: 0, laneCount: 0 });
    expect(w.riders).toEqual([]);
    expect(w.marks).toEqual([]);
    expect(w.gates).toEqual([]);
    expect(w.leaderZ).toBe(0);
    expect(w.lastZ).toBe(0);
  });

  it('parks not-yet-moved riders at z=0 (start-line lineup) while framing the movers', () => {
    const riders = [mk('a', 0, 40, 40), mk('b', 1, 0, 0)]; // b has not moved
    const w = povWorld({ ...base, riders, frac: 1, laneCount: 2, framingMoved: true });
    expect(w.riders.find((r) => r.id === 'b').z).toBeCloseTo(0); // parked on the line
    expect(w.leaderM).toBeCloseTo(40);
    expect(w.lastM).toBeCloseTo(40); // framing anchors on the mover, not the parked rider
  });

  it('frames the whole grid (incl. parked riders) when framingMoved is false', () => {
    const riders = [mk('a', 0, 40, 40), mk('b', 1, 0, 0)];
    const w = povWorld({ ...base, riders, frac: 1, laneCount: 2, framingMoved: false });
    expect(w.lastM).toBeCloseTo(0); // parked rider included in the start-line frame
    expect(w.leaderM).toBeCloseTo(40);
  });

  it('emits minor marks at 1m and flags/labels 10m majors (true metre value)', () => {
    const riders = [mk('a', 0, 25, 25)];
    const w = povWorld({ ...base, riders, frac: 1, laneCount: 1 });
    const m20 = w.marks.find((x) => x.m === 20);
    const m21 = w.marks.find((x) => x.m === 21);
    expect(m20.major).toBe(true);
    expect(m20.label).toBe('20m');
    expect(m21.major).toBe(false);
    expect(m21.label).toBe(null);
    expect(m20.z).toBeCloseTo(-20); // within the identity window
  });

  it('generates marks rider-anchored across [lastPlaceM − behindM, leaderM + aheadM]', () => {
    const riders = [mk('a', 0, 300, 300), mk('b', 1, 100, 100)]; // spread 200 m
    const w = povWorld({ ...base, riders, frac: 1, laneCount: 2, behindM: 30, aheadM: 25 });
    const ms = w.marks.map((x) => x.m);
    expect(Math.min(...ms)).toBeCloseTo(100 - 30); // behind LAST place (70), not leader − fog
    expect(Math.max(...ms)).toBeLessThanOrEqual(300 + 25 + 1e-6);
    expect(ms).toContain(100); // last-place rider's road is labelled (audit C5)
    expect(ms.some((m) => m < 70)).toBe(false);
  });

  it('emits marks ahead of the leader up to aheadM', () => {
    const riders = [mk('a', 0, 50, 50)];
    const w = povWorld({ ...base, riders, frac: 1, laneCount: 1, aheadM: 25 });
    expect(w.marks.some((x) => x.m > 50 && x.m <= 75 + 1e-6)).toBe(true);
    expect(w.marks.some((x) => x.m > 75 + 1e-6)).toBe(false);
  });

  it('emits lap gates across the rider-anchored window, none past finish', () => {
    // last = 210, leader = 210 (single). window [180, 235]. lap 100 → k=2 (200) in,
    // k=3 (300) beyond ahead. Finish always shows.
    const riders = [mk('a', 0, 210, 210)];
    const w = povWorld({ ...base, riders, frac: 1, laneCount: 1, lapLengthM: 100, finishM: 400 });
    const laps = w.gates.filter((g) => !g.isFinish).map((g) => g.lap).sort((p, q) => p - q);
    expect(laps).toContain(2);      // 200 m, 10 m behind last
    expect(laps).not.toContain(3);  // 300 m, beyond the ahead window
    expect(w.gates.every((g) => g.isFinish || g.lap * 100 <= 400 + 1e-6)).toBe(true);
    const finish = w.gates.find((g) => g.isFinish);
    expect(finish.label).toBe('FINISH');
  });

  it('compresses gate z the same way as riders (a far finish sits nearer)', () => {
    const riders = [mk('a', 0, 90, 90)]; // anchor 90; finish 400 → gap 310 compressed
    const w = povWorld({ ...base, riders, frac: 1, laneCount: 1, lapLengthM: 0, finishM: 400 });
    const finish = w.gates.find((g) => g.isFinish);
    expect(-finish.z).toBeCloseTo(displayDist(400, 90));
    expect(-finish.z).toBeLessThan(400);
  });

  it('places a near finish gate at its true z (identity window)', () => {
    const riders = [mk('a', 0, 380, 380)]; // finish 400 is 20 m ahead → identity
    const w = povWorld({ ...base, riders, frac: 1, laneCount: 1, lapLengthM: 0, finishM: 400 });
    const finish = w.gates.find((g) => g.isFinish);
    expect(finish.z).toBeCloseTo(-400);
  });

  it('omits gates when no lap length', () => {
    const riders = [mk('a', 0, 50, 50)];
    const w = povWorld({ ...base, riders, frac: 1, laneCount: 1, lapLengthM: 0 });
    expect(w.gates).toEqual([]);
  });
});

describe('povBadges (rank + gap-to-next)', () => {
  const riders = {
    a: { displayName: 'Ada', cumulativeDistanceM: 120 },
    b: { displayName: 'Ben', cumulativeDistanceM: 80 },
    c: { displayName: 'Cy', cumulativeDistanceM: 50 },
  };

  it('gives the leader their own total and chasers a gap-to-above (distance race)', () => {
    const riderLive = { a: { placement: 1 }, b: { placement: 2 }, c: { placement: 3 } };
    const badges = povBadges({ riderIds: ['a', 'b', 'c'], riders, riderLive, winCondition: 'distance' });
    expect(badges.a.text).toBe('1st · 120 m');
    expect(badges.b.text).toBe('2nd · −40 m'); // 120 − 80
    expect(badges.c.text).toBe('3rd · −30 m'); // 80 − 50
  });

  it('falls back to live distance order when placement is absent', () => {
    const badges = povBadges({ riderIds: ['c', 'a', 'b'], riders, riderLive: {}, winCondition: 'distance' });
    expect(badges.a.rank).toBe(1);
    expect(badges.b.rank).toBe(2);
    expect(badges.c.rank).toBe(3);
  });

  it('projects the gap through the above rider\'s pace for a time race', () => {
    const riderLive = {
      a: { placement: 1, speedKmh: 18 }, // 5 m/s
      b: { placement: 2, speedKmh: 18 },
    };
    const badges = povBadges({ riderIds: ['a', 'b'], riders, riderLive, winCondition: 'time' });
    // gap 40 m ÷ 5 m/s = 8 s
    expect(badges.b.text).toBe('2nd · −0:08');
  });

  it('shows DNF/overtime riders their state without a gap', () => {
    const riderLive = { a: { placement: 1 }, b: { dnf: true }, c: { overtime: true } };
    const badges = povBadges({ riderIds: ['a', 'b', 'c'], riders, riderLive });
    expect(badges.b.gapText).toBe('DNF');
    expect(badges.c.gapText).toBe('50 m'); // overtime shows real distance
  });

  // T9 review: a finished (non-DNF, non-overtime) rider's badge always showed
  // formatDistance(distanceM) — but every finisher in a distance race has
  // covered the SAME distance (the goal line), so all finishers displayed the
  // identical "3000 m" instead of what actually differentiates them: finish
  // time. The tower (StandingsTower.jsx) already branched correctly; the POV
  // badge must match.
  it('shows a finished rider their finish TIME in a distance race, not the identical goal distance', () => {
    const finishRiders = {
      a: { displayName: 'Ada', cumulativeDistanceM: 3000, finishTimeS: 272 }, // 4:32
      b: { displayName: 'Ben', cumulativeDistanceM: 3000, finishTimeS: 310 }, // 5:10
    };
    const riderLive = { a: { placement: 1, finished: true }, b: { placement: 2, finished: true } };
    const badges = povBadges({ riderIds: ['a', 'b'], riders: finishRiders, riderLive, winCondition: 'distance' });
    expect(badges.a.text).toBe('1st · 4:32');
    expect(badges.b.text).toBe('2nd · 5:10');
  });

  it('shows a finished rider their distance covered in a time race (everyone shares the same finish TIME instead)', () => {
    const finishRiders = {
      a: { displayName: 'Ada', cumulativeDistanceM: 820, finishTimeS: 600 },
    };
    const riderLive = { a: { placement: 1, finished: true } };
    const badges = povBadges({ riderIds: ['a'], riders: finishRiders, riderLive, winCondition: 'time' });
    expect(badges.a.text).toBe('1st · 820 m');
  });
});

describe('resolveBadgeStack (POV badge de-collision)', () => {
  // Boxes are centred on x, top-anchored at y — matching the renderer's
  // translate(-50%,0). A 100-wide badge at x=0 spans [-50, +50].
  const box = (x, y, dist, w = 100, h = 26) => ({ x, y, w, h, dist });

  it('leaves badges alone when they do not overlap', () => {
    const out = resolveBadgeStack([box(0, 100, 10), box(200, 100, 20)]);
    expect(out.map((b) => b.y)).toEqual([100, 100]);
  });

  it('leaves badges alone when they share x but are vertically clear', () => {
    const out = resolveBadgeStack([box(0, 100, 10), box(0, 200, 20)]);
    expect(out.map((b) => b.y)).toEqual([100, 200]);
  });

  it('pushes an overlapping badge below the one it hit', () => {
    // Same row, centres 80 apart — closer than (100+100)/2 = 100, so they collide.
    const out = resolveBadgeStack([box(0, 100, 10), box(80, 100, 20)], 3);
    expect(out[0].y).toBe(100);        // nearest keeps its natural spot
    expect(out[1].y).toBe(129);        // 100 + h(26) + gap(3)
  });

  it('resolves nearest-first regardless of input order', () => {
    const far = box(80, 100, 20);
    const near = box(0, 100, 10);
    const out = resolveBadgeStack([far, near], 3);
    expect(out[0].dist).toBe(10);
    expect(out[0].y).toBe(100);
    expect(out[1].y).toBe(129);        // the FAR one yields, not the near one
  });

  it('cascades a third badge clear of the two already stacked', () => {
    const out = resolveBadgeStack([box(0, 100, 10), box(40, 100, 20), box(70, 100, 30)], 3);
    expect(out.map((b) => b.y)).toEqual([100, 129, 158]);
  });

  it('does not mutate the input boxes', () => {
    const input = [box(0, 100, 10), box(80, 100, 20)];
    resolveBadgeStack(input, 3);
    expect(input.map((b) => b.y)).toEqual([100, 100]);
  });

  it('handles an empty field', () => {
    expect(resolveBadgeStack([])).toEqual([]);
  });
});
