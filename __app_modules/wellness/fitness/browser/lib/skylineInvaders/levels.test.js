import { describe, expect, it } from 'vitest';
import { LEVEL_SCHEMA, checkReachability, simulateBot, validateLevel } from './levels.js';
import { INVADERS_TUNABLES } from './tunables.js';

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
  it('accepts the optional fire rules, fall speeds and spawn lanes', () => {
    const result = validateLevel(level({ fire: { fuel_per_step_s: 2, fuel_cap_s: 6 }, fall: { meteor: 50, drone: 40 }, spawn_lanes: [1, 6] }), { reachability: false });
    expect(result.errors).toEqual([]);
    expect(result.level).toMatchObject({ fire: { fuel_per_step_s: 2 }, fall: { meteor: 50 }, spawn_lanes: [1, 6] });
  });
  it.each([
    [{ fire: 'fast' }, /fire must be an object/],
    [{ fire: { fuel_per_step_s: 0 } }, /fire\.fuel_per_step_s/],
    [{ fire: { shots: 3 } }, /fire\.shots is not a fire rule/],
    [{ fall: 50 }, /fall must be an object/],
    [{ fall: { meteor: 0 } }, /fall\.meteor/],
    [{ fall: { bomber: 20 } }, /fall\.bomber is not a falling threat/],
    [{ fall: { squid: 20 } }, /fall\.squid/],
    [{ spawn_lanes: [6, 1] }, /spawn_lanes/],
    [{ spawn_lanes: [0, 8] }, /spawn_lanes/],
    [{ spawn_lanes: [1.5, 3] }, /spawn_lanes/],
    [{ spawn_lanes: 3 }, /spawn_lanes/],
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

describe('reachability', () => {
  const tunables = INVADERS_TUNABLES;
  const easy = level({ duration_s: 120, pass: { kills: 10, base_hp_min: 0 }, waves: [{ at: 0, spawn: { meteor: 1 }, rate_s: 2.5 }] });
  const perfect = { ...tunables, botLaneErrorRate: 0 };

  it('the bot is deterministic for a seed and differs across seeds', () => {
    const a = simulateBot(easy, { seed: 4, tunables });
    expect(simulateBot(easy, { seed: 4, tunables })).toEqual(a);
    expect(a.phase).toBe('ended');
    expect(simulateBot(easy, { seed: 5, tunables }).score).not.toBe(a.score);
  });
  it('the bot fires the way a child does: it steps for fuel and the stream does the shooting', () => {
    const bot = simulateBot(easy, { tunables });
    expect(bot.steps).toBeGreaterThan(20);
    expect(bot.steps).toBeLessThanOrEqual(Math.ceil(easy.duration_s / tunables.botStepIntervalS) + 1);
    expect(bot.shotsFired).toBeGreaterThan(bot.steps);            // a stream, not one shot per step
    expect(bot.firingS).toBeLessThanOrEqual(bot.steps * tunables.fuelPerStepS + 1e-6);
    expect(bot.weapon.peak).toBeGreaterThan(0);                   // the power meter is in play
  });
  it('the bot has no partner and never drops a bomb', () => {
    const mixed = level({ duration_s: 120, waves: [{ at: 0, spawn: { meteor: 2, drone: 1, pod: 1, bomber: 1 }, rate_s: 2 }] });
    const bot = simulateBot(mixed, { tunables });
    expect(bot).toMatchObject({ bombs: 0, boost: { used: 0, meter: 0 } });
    expect(bot.kills).toBeGreaterThan(0);
  });
  it('a bot that never misreads a lane holds the whole skyline on a sparse level', () => {
    const bot = simulateBot(easy, { tunables: perfect });
    expect(bot.base.hp).toBe(100);
    expect(bot.kills).toBeGreaterThanOrEqual(46);
  });
  it('the realistic bot lets threats through: it misses, where the perfect one never does', () => {
    for (const seed of [1, 2, 3, 4]) {
      const real = simulateBot(easy, { seed, tunables });
      expect(real.base.hp).toBeLessThan(100);
      expect(real.kills).toBeLessThan(simulateBot(easy, { seed, tunables: perfect }).kills);
    }
  });
  it('a higher lane-error rate makes the same level harder', () => {
    const hp = (rate) => [1, 2, 3, 4, 5, 6].reduce((sum, seed) => sum + simulateBot(easy, { seed, tunables: { ...tunables, botLaneErrorRate: rate } }).base.hp, 0);
    expect(hp(0.6)).toBeLessThan(hp(0.2));
  });
  it('accepts a level a child on the mat can pass', () => {
    expect(checkReachability(easy, tunables)).toMatchObject({ reachable: true, errors: [], reachableKills: expect.any(Number), botBaseHpPct: expect.any(Number), reachableBaseHp: expect.any(Number) });
    expect(validateLevel(easy, { tunables }).valid).toBe(true);
    expect(checkReachability(easy)).toEqual(checkReachability(easy, INVADERS_TUNABLES));
  });
  it('rejects a kill target above what the bot reaches, and says how many are reachable', () => {
    const greedy = { ...easy, pass: { kills: 200, base_hp_min: 0 } };
    const result = validateLevel(greedy, { tunables });
    expect(result.valid).toBe(false);
    expect(result.level).toBeNull();
    expect(result.errors.join('\n')).toMatch(/pass\.kills 200 is not reachable.*at most \d+/);
  });
  it('holds a level to the worst seed, and to the share of the bot\'s kills a person can be asked for', () => {
    const worst = Math.min(...tunables.reachabilitySeeds.map((seed) => simulateBot(easy, { seed, tunables }).kills));
    const reach = checkReachability(easy, tunables);
    expect(reach.reachableKills).toBe(Math.floor(worst * 0.6));
    expect(validateLevel({ ...easy, pass: { kills: reach.reachableKills, base_hp_min: 0 } }, { tunables }).valid).toBe(true);
    expect(validateLevel({ ...easy, pass: { kills: reach.reachableKills + 1, base_hp_min: 0 } }, { tunables }).valid).toBe(false);
  });
  it('holds the skyline floor to what the realistic bot kept, less the margin', () => {
    const reach = checkReachability(easy, tunables);
    expect(reach.reachableBaseHp).toBe(Math.max(0, reach.botBaseHpPct - tunables.reachabilityBaseHpMargin));
    expect(validateLevel({ ...easy, pass: { kills: 5, base_hp_min: reach.reachableBaseHp } }, { tunables }).valid).toBe(true);
    const over = validateLevel({ ...easy, pass: { kills: 5, base_hp_min: reach.reachableBaseHp + 1 } }, { tunables });
    expect(over.valid).toBe(false);
    expect(over.errors.join('\n')).toMatch(/base_hp_min/);
  });
  it('rejects the level that shipped unpassable: 18 kills and 40% skyline on full-speed meteors in every lane', () => {
    const shipped = level({
      id: 'invaders-1-1', duration_s: 180, pass: { kills: 18, base_hp_min: 40 },
      waves: [{ at: 0, spawn: { meteor: 1 }, rate_s: 4.5 }, { at: 60, spawn: { meteor: 1 }, rate_s: 4.0 }, { at: 120, spawn: { meteor: 1 }, rate_s: 3.5 }],
    });
    const result = validateLevel(shipped, { tunables });
    expect(result.valid).toBe(false);
    expect(result.errors.join('\n')).toMatch(/base_hp_min 40 is above what a shooter on the mat holds/);
    // The perfect bot is what let it through.
    expect(validateLevel(shipped, { tunables: perfect }).valid).toBe(true);
  });
  it('skips the bot when asked for structure only, and when the structure is already wrong', () => {
    const greedy = { ...easy, pass: { kills: 200 } };
    expect(validateLevel(greedy, { reachability: false }).valid).toBe(true);
    expect(validateLevel({ ...greedy, duration_s: 5 }, { tunables }).errors.join('\n')).not.toMatch(/reachable/);
  });
});
