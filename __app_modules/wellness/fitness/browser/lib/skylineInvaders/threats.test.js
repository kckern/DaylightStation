import { describe, expect, it } from 'vitest';
import { FIELD, LEVEL_THREAT_TYPES, THREATS, aimToX, xToAim, moveThreat, threatBox } from './threats.js';

const threat = (type, over = {}) => ({ id: 1, type, x: 500, y: 100, originX: 500, hp: THREATS[type].hp, age: 0, phase: 0, dir: 1, bombIn: 4, ...over });

describe('threats', () => {
  it('has the four spec threats with their hit points, plus the bomber bomb', () => {
    expect(Object.fromEntries(['meteor', 'drone', 'pod', 'bomber'].map((t) => [t, THREATS[t].hp]))).toEqual({ meteor: 1, drone: 1, pod: 2, bomber: 4 });
    expect(THREATS.pod.splitsInto).toEqual(['drone', 'drone']);
    expect(THREATS.bomb.countsAsKill).toBe(false);
  });
  it('lets a level spawn the four threats but never a bare bomb', () => {
    expect(LEVEL_THREAT_TYPES).toEqual(['meteor', 'drone', 'pod', 'bomber']);
  });
  it('maps aim 0..1 onto the cannon range and back', () => {
    expect(aimToX(0)).toBe(FIELD.marginX);
    expect(aimToX(1)).toBe(FIELD.width - FIELD.marginX);
    expect(aimToX(7)).toBe(FIELD.width - FIELD.marginX);
    expect(aimToX(-3)).toBe(FIELD.marginX);
    expect(xToAim(aimToX(0.25))).toBeCloseTo(0.25);
  });
  it('centres the cannon when the aim is not a number', () => {
    for (const junk of [NaN, undefined, null, 'left']) expect(aimToX(junk)).toBe(FIELD.width / 2);
  });
  it('drops a meteor straight down', () => {
    const next = moveThreat(threat('meteor'), 1);
    expect(next.x).toBe(500);
    expect(next.y).toBeCloseTo(100 + THREATS.meteor.fall);
  });
  it('zigzags a drone around the column it spawned in, inside the field', () => {
    const quarter = moveThreat(threat('drone'), THREATS.drone.zigzag.period_s / 4);
    expect(quarter.x).toBeCloseTo(500 + THREATS.drone.zigzag.amplitude);
    const edge = moveThreat(threat('drone', { originX: FIELD.width - 10, x: FIELD.width - 10 }), THREATS.drone.zigzag.period_s / 4);
    expect(edge.x).toBeLessThanOrEqual(FIELD.width - FIELD.marginX);
  });
  it('moves the same distance in one long step as in many short ones', () => {
    for (const type of ['meteor', 'drone', 'pod']) {
      let stepped = threat(type, { phase: 1.3 });
      for (let i = 0; i < 13; i += 1) stepped = moveThreat(stepped, 1 / 13);
      const whole = moveThreat(threat(type, { phase: 1.3 }), 1);
      expect(stepped.x).toBeCloseTo(whole.x, 6);
      expect(stepped.y).toBeCloseTo(whole.y, 6);
    }
  });
  it('drifts a bomber sideways at a fixed height and turns it at the edges', () => {
    const next = moveThreat(threat('bomber', { x: FIELD.width - FIELD.marginX - 1, y: FIELD.bomberY }), 1);
    expect(next.y).toBe(FIELD.bomberY);
    expect(next.dir).toBe(-1);
    expect(next.x).toBe(FIELD.width - FIELD.marginX);
    const left = moveThreat(threat('bomber', { x: FIELD.marginX + 1, y: FIELD.bomberY, dir: -1 }), 1);
    expect([left.x, left.dir]).toEqual([FIELD.marginX, 1]);
  });
  it('does not change the threat it was given', () => {
    const before = threat('drone');
    const copy = { ...before };
    moveThreat(before, 0.5);
    expect(before).toEqual(copy);
  });
  it('gives each threat a box centred on its position', () => {
    const b = threatBox(threat('meteor'));
    expect([b.x1 - b.x0, b.y1 - b.y0]).toEqual([THREATS.meteor.width, THREATS.meteor.height]);
    expect([(b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2]).toEqual([500, 100]);
  });
});
