import { describe, expect, it } from 'vitest';
import { LANES, LANE_WIDTH, laneAim, laneOfAim, laneOfX, laneX, nearestThreat, nextTarget, snapLane } from './lanes.js';
import { FIELD } from './threats.js';

describe('lanes', () => {
  it('cuts the aim range into eight equal lanes', () => {
    expect(LANES).toBe(8);
    expect(LANE_WIDTH).toBeCloseTo((FIELD.width - 2 * FIELD.marginX) / 8);
    expect(laneAim(0)).toBeCloseTo(1 / 16);
    expect(laneAim(7)).toBeCloseTo(15 / 16);
    expect(laneX(0)).toBeCloseTo(FIELD.marginX + LANE_WIDTH / 2);
    expect(laneX(7)).toBeCloseTo(FIELD.width - FIELD.marginX - LANE_WIDTH / 2);
  });

  it('finds the lane of an aim or a scene x, clamped to the field', () => {
    expect([0, 0.124, 0.126, 0.5, 0.99, 1].map(laneOfAim)).toEqual([0, 0, 1, 4, 7, 7]);
    expect(laneOfAim(-3)).toBe(0);
    expect(laneOfAim(9)).toBe(7);
    expect(laneOfAim(NaN)).toBe(4);
    for (let lane = 0; lane < LANES; lane += 1) expect(laneOfX(laneX(lane))).toBe(lane);
  });
});

describe('snapLane', () => {
  it('takes the lane the aim is in when the cannon has no lane yet', () => {
    expect(snapLane(0.3, null)).toBe(2);
  });

  it('stays in its lane until the aim is a quarter lane past the edge', () => {
    // Lane 3 spans 0.375..0.5; a quarter lane is 0.03125.
    expect(snapLane(0.51, 3)).toBe(3);
    expect(snapLane(0.53, 3)).toBe(3);
    expect(snapLane(0.532, 3)).toBe(4);
    expect(snapLane(0.36, 3)).toBe(3);
    expect(snapLane(0.34, 3)).toBe(2);
  });

  it('does not flicker when the aim rests on a boundary', () => {
    let lane = 3;
    const seen = new Set();
    for (const aim of [0.499, 0.501, 0.498, 0.503, 0.497, 0.505]) { lane = snapLane(aim, lane); seen.add(lane); }
    expect([...seen]).toEqual([3]);
  });

  it('jumps straight to a far lane and reaches both edge lanes', () => {
    expect(snapLane(0.95, 1)).toBe(7);
    expect(snapLane(0, 1)).toBe(0);
    expect(snapLane(1, 6)).toBe(7);
  });

  it('honours a hysteresis of its own, and holds on an aim that is not a number', () => {
    expect(snapLane(0.51, 3, { hysteresis: 0 })).toBe(4);
    expect(snapLane(NaN, 5)).toBe(5);
  });
});

describe('what a shot from a column will meet', () => {
  const threats = [
    { id: 1, type: 'meteor', x: 500, y: 100 },
    { id: 2, type: 'meteor', x: 510, y: 300 },
    { id: 3, type: 'drone', x: 700, y: 400 },
    { id: 4, type: 'bomb', x: 300, y: 450 },
  ];
  it('picks the lowest threat the shot overlaps', () => {
    expect(nextTarget(threats, 500).id).toBe(2);
    expect(nextTarget(threats, 700).id).toBe(3);
    expect(nextTarget(threats, 300).id).toBe(4);
    expect(nextTarget(threats, 600)).toBeNull();
    expect(nextTarget([], 500)).toBeNull();
  });
  it('reports the nearest threat and the signed miss, bombs aside', () => {
    expect(nearestThreat(threats, 620)).toMatchObject({ id: 3, miss: 80 });
    expect(nearestThreat(threats, 320)).toMatchObject({ id: 1, miss: 180 });
    expect(nearestThreat([threats[3]], 320)).toBeNull();
  });
});
