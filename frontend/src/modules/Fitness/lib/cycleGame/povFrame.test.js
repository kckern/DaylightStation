import { describe, it, expect } from 'vitest';
import { computePovFrame } from './povFrame.js';
import { POV_CAMERA } from './povProjection.js';

const k = 0.0017;
const base = {
  riders: [
    { id: 'a', idx: 0, laneX: 12, prev: 480, cur: 500 },  // leader
    { id: 'b', idx: 1, laneX: 88, prev: 380, cur: 400 }   // trailer
  ],
  leaderPrev: 480, leaderCur: 500, k
};

describe('computePovFrame', () => {
  it('places the leader near the far plane (top) and the trailer lower', () => {
    const f = computePovFrame({ ...base, frac: 1 });
    const a = f.markers.find((m) => m.id === 'a');
    const b = f.markers.find((m) => m.id === 'b');
    expect(a.y).toBeLessThan(b.y);                  // leader higher (smaller y)
    expect(a.y).toBeCloseTo(POV_CAMERA.farFrac, 2); // leader at the far plane
    expect(b.scale).toBeGreaterThan(a.scale);       // trailer is nearer the camera -> bigger
  });

  it('interpolates the leader so a fixed 400 m line scrolls toward the camera', () => {
    const at0 = computePovFrame({ ...base, frac: 0 });
    const at1 = computePovFrame({ ...base, frac: 1 });
    const l0 = at0.lineSlots.find((s) => s.m === 400);
    const l1 = at1.lineSlots.find((s) => s.m === 400);
    expect(l1.y).toBeGreaterThan(l0.y); // leader advances -> the 400 m line moves down
  });

  it('emits a fixed 10 m / 50 m grid (major on every 50 m) plus a marker per rider', () => {
    const f = computePovFrame({ ...base, frac: 1 }); // leader = 500
    expect(f.markers).toHaveLength(2);
    const ms = f.lineSlots.map((s) => s.m);
    expect(ms).toContain(500); expect(ms).toContain(490); expect(ms).toContain(450);
    // 10 m spacing; majors are the multiples of 50
    expect(f.lineSlots.find((s) => s.m === 450).major).toBe(true);
    expect(f.lineSlots.find((s) => s.m === 490).major).toBe(false);
    // stable recycling slot = (m / 10) % 50
    expect(f.lineSlots.find((s) => s.m === 500).slot).toBe(0);
    expect(f.lineSlots.find((s) => s.m === 490).slot).toBe(49);
  });

  it('parks (opacity 0) a mark that is off the road, never piling it at an edge', () => {
    // very zoomed-in (large k): only the nearest few 10 m marks are on the road.
    const f = computePovFrame({ ...base, frac: 1, k: 0.02 });
    const near = f.lineSlots.find((s) => s.m === 480);    // just behind the leader, mid-band
    const farBack = f.lineSlots.find((s) => s.m === 200); // 300 m back -> off the near edge
    expect(near.opacity).toBeGreaterThan(0);
    expect(farBack.opacity).toBe(0);
  });
});
