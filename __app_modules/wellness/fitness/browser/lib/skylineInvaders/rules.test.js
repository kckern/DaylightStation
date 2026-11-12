import { describe, expect, it } from 'vitest';
import { BOOST_KINDS, boostRules, nukeRules } from './rules.js';

describe('level rules', () => {
  it('gives every level the default nuke and boost balance', () => {
    expect(nukeRules({})).toEqual({ radius: 160, damage: 3 });
    expect(boostRules(null)).toMatchObject({ fill_s: 20, duration_s: 8, min_rpm: 40, full_rpm: 90, rapid_interval_s: 0.25, rotation: ['rapid', 'shield', 'twin'] });
  });
  it('lets a level override single knobs and keeps the rest', () => {
    expect(nukeRules({ nuke: { radius: 90 } })).toEqual({ radius: 90, damage: 3 });
    expect(boostRules({ boost: { fill_s: 5 } })).toMatchObject({ fill_s: 5, duration_s: 8 });
  });
  it('names the three boosts', () => {
    expect(BOOST_KINDS).toEqual(['rapid', 'shield', 'twin']);
  });
});
