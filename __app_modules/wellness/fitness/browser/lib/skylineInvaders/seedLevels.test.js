// The seed levels that ship to the household data tree. The fixtures under
// tests/_fixtures are the tested source; the installed copies are plain copies.
import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';
import { describe, expect, it } from 'vitest';
import { checkReachability, simulateBot, validateLevel } from './levels.js';
import { levelOutcome } from './scoring.js';
import { INVADERS_TUNABLES } from './tunables.js';

const root = path.resolve(__dirname, '../../../../../../tests/_fixtures/fitness/skyline-invaders');
const read = (relative) => yaml.load(fs.readFileSync(path.join(root, relative), 'utf8'));
const files = fs.readdirSync(path.join(root, 'levels')).filter((name) => name.endsWith('.yml')).sort();
const load = (name) => validateLevel(read(`levels/${name}`), { reachability: false }).level;
// The shell seeds every round differently, so a level has to hold on any seed.
const SEEDS = Array.from({ length: 12 }, (_, i) => i + 1);

describe('seed levels', () => {
  it('ships four levels, all named in world.yml in order', () => {
    expect(files).toEqual(['invaders-1-1.yml', 'invaders-1-2.yml', 'invaders-1-3.yml', 'invaders-1-4.yml']);
    expect(read('world.yml').levels).toEqual(files.map((name) => name.replace('.yml', '')));
  });

  it.each(files)('%s is valid and reachable at the current spike tunables', (name) => {
    const result = validateLevel(read(`levels/${name}`), { reachability: true, tunables: INVADERS_TUNABLES });
    expect(result.errors).toEqual([]);
    expect(result.level.id).toBe(name.replace('.yml', ''));
  });

  it.each(files)('%s leaves headroom: the pass target is at most 80%% of what is reachable', (name) => {
    const level = load(name);
    expect(level.pass.kills).toBeLessThanOrEqual(Math.floor(checkReachability(level, INVADERS_TUNABLES).reachableKills * 0.8));
  });

  it.each(files)('%s is passable by the cool-tier bot on every seed, with base HP to spare', (name) => {
    const level = load(name);
    for (const seed of SEEDS) {
      const bot = simulateBot(level, { fireIntervalS: INVADERS_TUNABLES.fireIntervalS, seed });
      const reachableKills = Math.floor(bot.kills * INVADERS_TUNABLES.reachabilityHitRate);
      expect({ seed, killsReachable: reachableKills >= level.pass.kills }).toEqual({ seed, killsReachable: true });
      // 15 points of slack: one bomb, or one meteor and a half.
      expect({ seed, baseHpHeld: bot.base.hp >= level.pass.base_hp_min + 15 }).toEqual({ seed, baseHpHeld: true });
    }
  });

  it('level 1 passes for a slow shooter: one small shot every two seconds', () => {
    const level = load('invaders-1-1.yml');
    for (const seed of SEEDS) {
      const outcome = levelOutcome(simulateBot(level, { fireIntervalS: 2, seed }), level);
      expect({ seed, passed: outcome.passed }).toEqual({ seed, passed: true });
      expect(outcome.baseHpPct).toBeGreaterThanOrEqual(70);
    }
  });

  it('level 1 is sparse: under one threat every three seconds', () => {
    const level = load('invaders-1-1.yml');
    const spawns = level.waves.reduce((sum, wave, i) => sum + ((level.waves[i + 1]?.at ?? level.duration_s) - wave.at) / wave.rate_s, 0);
    expect(spawns / level.duration_s).toBeLessThan(1 / 3);
  });

  it('introduces one threat at a time and stays single-cannon', () => {
    const types = files.map((name) => new Set(read(`levels/${name}`).waves.flatMap((wave) => Object.keys(wave.spawn))));
    expect([...types[0]]).toEqual(['meteor']);
    expect(types[1].has('drone')).toBe(true);
    expect(types[1].has('pod') || types[1].has('bomber')).toBe(false);
    expect(types[2].has('pod')).toBe(true);
    expect(types[2].has('bomber')).toBe(false);
    expect(types[3].has('bomber')).toBe(true);
    for (const name of files) expect(read(`levels/${name}`).cannons ?? 1).toBe(1);
  });

  it('level 4 sends exactly two bombers on every seed', () => {
    const level = load('invaders-1-4.yml');
    const bomberWaves = level.waves.filter((wave) => wave.spawn.bomber);
    expect(bomberWaves).toHaveLength(2);
    for (const wave of bomberWaves) {
      expect(Object.keys(wave.spawn)).toEqual(['bomber']);
      const next = level.waves[level.waves.indexOf(wave) + 1];
      expect(next.at - wave.at).toBeLessThanOrEqual(wave.rate_s);   // one beat only
    }
  });
});
