import { describe, expect, it } from 'vitest';
import { BOOST_KINDS, FIRE_KEYS, boostRules, fireRules, nukeRules } from './rules.js';
import { INVADERS_TUNABLES } from './tunables.js';

describe('level rules', () => {
  it('gives every level the default nuke and boost balance', () => {
    expect(nukeRules({})).toEqual({ radius: 160, damage: 3 });
    expect(boostRules(null)).toMatchObject({ fill_s: 20, duration_s: 8, min_rpm: 40, full_rpm: 90, rapid_interval_s: 0.125, rotation: ['rapid', 'shield', 'twin'] });
  });
  it('lets a level override single knobs and keeps the rest', () => {
    expect(nukeRules({ nuke: { radius: 90 } })).toEqual({ radius: 90, damage: 3 });
    expect(boostRules({ boost: { fill_s: 5 } })).toMatchObject({ fill_s: 5, duration_s: 8 });
  });
  it('takes the fire rules from the tunables and lets a level override single knobs', () => {
    expect(fireRules(null)).toEqual({
      fuel_per_step_s: INVADERS_TUNABLES.fuelPerStepS, fuel_cap_s: INVADERS_TUNABLES.fuelCapS, stream_interval_s: INVADERS_TUNABLES.streamIntervalS,
      power_per_kill: INVADERS_TUNABLES.powerPerKill, power_per_firing_s: INVADERS_TUNABLES.powerPerFiringS, idle_drop_s: INVADERS_TUNABLES.weaponIdleDropS,
    });
    expect(fireRules({ fire: { fuel_cap_s: 8 } })).toMatchObject({ fuel_cap_s: 8, fuel_per_step_s: 1.5 });
    expect(FIRE_KEYS).toContain('stream_interval_s');
  });
  it('names the three boosts', () => {
    expect(BOOST_KINDS).toEqual(['rapid', 'shield', 'twin']);
  });
});
