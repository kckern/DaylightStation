import { describe, expect, it } from 'vitest';
import { SHOT_TIERS, TOP_WEAPON_LEVEL, WEAPON_LADDER, WEAPON_STEPS, bombReady, weaponTier } from './tiers.js';

describe('weapon ladder', () => {
  it('climbs single, double, spread, and shows the bomb as the last step', () => {
    expect(WEAPON_LADDER).toEqual(['small', 'double', 'spread']);
    expect(TOP_WEAPON_LEVEL).toBe(2);
    expect(WEAPON_STEPS).toEqual(['Single', 'Double', 'Spread', 'Bomb']);
    expect(WEAPON_LADDER.map((id) => SHOT_TIERS[id].label)).toEqual(WEAPON_STEPS.slice(0, 3));
  });
  it('gives each level its volley: one shot, two side by side, three fanned', () => {
    expect(SHOT_TIERS.small.shots).toEqual([{ dx: 0, vx: 0 }]);
    expect(SHOT_TIERS.double.shots.map((shot) => shot.dx)).toEqual([-14, 14]);
    expect(SHOT_TIERS.spread.shots.map((shot) => shot.vx)).toEqual([-150, 0, 150]);
    for (const tier of Object.values(SHOT_TIERS)) expect(tier.damage).toBe(1);
  });
  it('maps a weapon to its tier, clamped to the ladder', () => {
    expect([0, 1, 2, 9, -1].map((level) => weaponTier({ level }))).toEqual(['small', 'double', 'spread', 'spread', 'small']);
    expect(weaponTier(null)).toBe('small');
  });
  it('a bomb is ready only at the top with a full meter', () => {
    expect(bombReady({ level: 2, meter: 1 })).toBe(true);
    expect(bombReady({ level: 2, meter: 0.99 })).toBe(false);
    expect(bombReady({ level: 1, meter: 1 })).toBe(false);
    expect(bombReady(null)).toBe(false);
  });
  it('does not read the heart-rate zone any more', () => {
    expect(Object.keys(SHOT_TIERS)).toEqual(['small', 'double', 'spread']);
  });
});
