import { describe, expect, it } from 'vitest';
import { LEVEL_SCHEMA, validateLevel } from './levels.js';

const level = (over = {}) => ({
  schema: LEVEL_SCHEMA, id: 'invaders-test', name: 'Test', duration_s: 60,
  pass: { kills: 3, base_hp_min: 50 }, cannons: 1,
  waves: [{ at: 0, spawn: { meteor: 1 }, rate_s: 2 }],
  ...over,
});
const errors = (over) => validateLevel(level(over), { reachability: false }).errors;

describe('validateLevel (structure)', () => {
  it('accepts a minimal level and fills defaults', () => {
    const result = validateLevel(level({ cannons: undefined, pass: { kills: 3 } }), { reachability: false });
    expect(result).toMatchObject({ valid: true, errors: [] });
    expect(result.level).toMatchObject({ cannons: 1, max_bombers: 2, pass: { kills: 3, base_hp_min: 0 } });
  });
  it('accepts the optional nuke and boost overrides', () => {
    const result = validateLevel(level({ nuke: { radius: 120, damage: 4 }, boost: { fill_s: 15, duration_s: 6, rotation: ['shield', 'rapid'] } }), { reachability: false });
    expect(result.errors).toEqual([]);
    expect(result.level).toMatchObject({ nuke: { radius: 120, damage: 4 }, boost: { fill_s: 15, rotation: ['shield', 'rapid'] } });
  });
  it.each([
    [{ schema: 'nope' }, /schema/],
    [{ id: 'Bad Id' }, /id/],
    [{ id: 7 }, /id/],
    [{ name: '  ' }, /name/],
    [{ duration_s: 5 }, /duration_s/],
    [{ duration_s: 901 }, /duration_s/],
    [{ pass: { kills: 0 } }, /pass\.kills/],
    [{ pass: { kills: 2.5 } }, /pass\.kills/],
    [{ pass: undefined }, /pass\.kills/],
    [{ pass: { kills: 3, base_hp_min: 140 } }, /base_hp_min/],
    [{ cannons: 3 }, /cannons/],
    [{ max_bombers: -1 }, /max_bombers/],
    [{ waves: [] }, /waves/],
    [{ waves: [null] }, /waves\[0\]/],
    [{ waves: [{ at: -1, spawn: { meteor: 1 }, rate_s: 2 }] }, /waves\[0\]\.at/],
    [{ waves: [{ at: 0, spawn: {}, rate_s: 2 }] }, /at least one threat/],
    [{ waves: [{ at: 0, spawn: { squid: 1 }, rate_s: 2 }] }, /unknown threat squid/],
    [{ waves: [{ at: 0, spawn: { bomb: 1 }, rate_s: 2 }] }, /unknown threat bomb/],
    [{ waves: [{ at: 0, spawn: { meteor: 0 }, rate_s: 2 }] }, /weight/],
    [{ waves: [{ at: 0, spawn: { meteor: 1 }, rate_s: 0.1 }] }, /rate_s/],
    [{ waves: [{ at: 10, spawn: { meteor: 1 }, rate_s: 2 }, { at: 10, spawn: { drone: 1 }, rate_s: 2 }] }, /increasing/],
    [{ waves: [{ at: 90, spawn: { meteor: 1 }, rate_s: 2 }] }, /before the level ends/],
    [{ nuke: { radius: 0, damage: 3 } }, /nuke/],
    [{ nuke: 5 }, /nuke/],
    [{ boost: { fill_s: 'fast' } }, /boost/],
    [{ boost: 'on' }, /boost/],
    [{ boost: { rotation: [] } }, /boost\.rotation/],
    [{ boost: { rotation: ['rapid', 'laser'] } }, /boost\.rotation/],
    [{ boost: { min_rpm: 90, full_rpm: 90 } }, /full_rpm/],
    [{ boost: { min_rpm: 95 } }, /full_rpm/],
  ])('rejects %j', (over, message) => {
    const found = errors(over);
    expect(found.join('\n')).toMatch(message);
  });
  it('reports every problem at once', () => {
    expect(errors({ id: 'Bad Id', duration_s: 5, cannons: 3 })).toHaveLength(3);
  });
  it('never throws on junk', () => {
    for (const junk of [null, 7, 'x', [], { waves: 'x' }]) {
      const result = validateLevel(junk, { reachability: false });
      expect(result).toMatchObject({ valid: false, level: null });
      expect(result.errors.length).toBeGreaterThan(0);
    }
  });
  it('does not change the level it was given', () => {
    const raw = level({ pass: { kills: 3 } });
    const copy = JSON.parse(JSON.stringify(raw));
    validateLevel(raw, { reachability: false });
    expect(raw).toEqual(copy);
  });
});
