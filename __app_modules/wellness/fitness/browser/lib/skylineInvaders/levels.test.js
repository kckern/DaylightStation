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

describe('reachability', () => {
  const tunables = { ...INVADERS_TUNABLES, fireIntervalS: 1.5, reachabilityHitRate: 0.6 };
  const easy = level({ duration_s: 120, pass: { kills: 10, base_hp_min: 50 }, waves: [{ at: 0, spawn: { meteor: 1 }, rate_s: 2.5 }] });

  it('the bot is deterministic and limited by the fire interval', () => {
    const a = simulateBot(easy, tunables);
    expect(simulateBot(easy, tunables)).toEqual(a);
    expect(a.phase).toBe('ended');
    expect(a.shotsFired).toBeLessThanOrEqual(Math.ceil(easy.duration_s / tunables.fireIntervalS));
    expect(a.kills).toBeGreaterThan(20);
  });
  it('the bot plays at cool tier with no partner: small shots, no nukes, no boosts', () => {
    const mixed = level({ duration_s: 120, waves: [{ at: 0, spawn: { meteor: 2, drone: 1, pod: 1, bomber: 1 }, rate_s: 2 }] });
    const bot = simulateBot(mixed, tunables);
    expect(bot).toMatchObject({ nukes: 0, boost: { used: 0, meter: 0 } });
    expect(bot.kills).toBeGreaterThan(0);
    expect(bot.hits).toBeLessThanOrEqual(bot.shotsFired);
  });
  it('the bot leads a zigzagging drone instead of shooting where it was', () => {
    const drones = level({ duration_s: 120, waves: [{ at: 0, spawn: { drone: 1 }, rate_s: 3 }] });
    const bot = simulateBot(drones, tunables);
    expect(bot.hits / bot.shotsFired).toBeGreaterThan(0.8);
  });
  it('accepts a level a cool-tier shooter can pass', () => {
    expect(checkReachability(easy, tunables)).toMatchObject({ reachable: true, errors: [], reachableKills: expect.any(Number), botBaseHpPct: expect.any(Number) });
    expect(validateLevel(easy, { tunables }).valid).toBe(true);
  });
  it('checks against the garage fire rate when no tunables are given', () => {
    expect(checkReachability(easy)).toEqual(checkReachability(easy, INVADERS_TUNABLES));
    expect(validateLevel(easy).valid).toBe(true);
  });
  it('rejects a kill target above what the fire rate allows, and says how many are reachable', () => {
    const greedy = { ...easy, pass: { kills: 200, base_hp_min: 50 } };
    const result = validateLevel(greedy, { tunables });
    expect(result.valid).toBe(false);
    expect(result.level).toBeNull();
    expect(result.errors.join('\n')).toMatch(/pass\.kills 200 is not reachable.*at most \d+/);
  });
  it('allows a level only the share of the bot\'s kills a person can be asked for', () => {
    const bot = simulateBot(easy, tunables);
    const reach = checkReachability(easy, tunables);
    expect(reach.reachableKills).toBe(Math.floor(bot.kills * 0.6));
    expect(validateLevel({ ...easy, pass: { kills: reach.reachableKills, base_hp_min: 0 } }, { tunables }).valid).toBe(true);
    expect(validateLevel({ ...easy, pass: { kills: reach.reachableKills + 1, base_hp_min: 0 } }, { tunables }).valid).toBe(false);
  });
  it('rejects a base floor the bot cannot hold', () => {
    const flood = level({ duration_s: 120, pass: { kills: 5, base_hp_min: 100 }, waves: [{ at: 0, spawn: { meteor: 1 }, rate_s: 0.4 }] });
    expect(validateLevel(flood, { tunables }).errors.join('\n')).toMatch(/base_hp_min/);
  });
  it('a slower spike fire rate makes the same level harder to pass', () => {
    const slow = simulateBot(easy, { ...tunables, fireIntervalS: 4 });
    expect(slow.kills).toBeLessThan(simulateBot(easy, tunables).kills);
  });
  it('skips the bot when asked for structure only, and when the structure is already wrong', () => {
    const greedy = { ...easy, pass: { kills: 200 } };
    expect(validateLevel(greedy, { reachability: false }).valid).toBe(true);
    expect(validateLevel({ ...greedy, duration_s: 5 }, { tunables }).errors.join('\n')).not.toMatch(/reachable/);
  });
});
