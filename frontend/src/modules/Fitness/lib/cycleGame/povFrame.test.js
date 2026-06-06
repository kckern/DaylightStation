import { describe, it, expect } from 'vitest';
import { computePovFrame } from './povFrame.js';
import { POV_CAMERA } from './povProjection.js';

const k = 0.0017;
const base = {
  lines: [{ m: 400, x: 0 }, { m: 500, x: 0 }],
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
    expect(a.y).toBeLessThan(b.y);                         // leader higher (smaller y)
    expect(a.y).toBeCloseTo(POV_CAMERA.farFrac, 2);        // leader at the far plane
    expect(b.scale).toBeGreaterThan(a.scale);              // trailer is nearer the camera -> bigger
  });
  it('interpolates the leader between ticks (frac scrolls the road)', () => {
    const at0 = computePovFrame({ ...base, frac: 0 });
    const at1 = computePovFrame({ ...base, frac: 1 });
    const line400at0 = at0.lineSlots.find((s) => s.m === 400);
    const line400at1 = at1.lineSlots.find((s) => s.m === 400);
    expect(line400at1.y).toBeGreaterThan(line400at0.y); // leader advances -> fixed 400m line moves toward camera
  });
  it('returns a slot per input line and a marker per rider', () => {
    const f = computePovFrame({ ...base, frac: 0.5 });
    expect(f.lineSlots).toHaveLength(2);
    expect(f.markers).toHaveLength(2);
  });
});
