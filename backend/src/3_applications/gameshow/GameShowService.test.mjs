// @vitest-environment node
import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { GameShowService } from './GameShowService.mjs';

const FIXTURES = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../tests/_fixtures/gameshow');
const NOOP = { info() {}, warn() {}, error() {}, debug() {} };

const HOUSEHOLD_CFG = {
  buzzers: [{ id: 'living_room', mqtt_topic: 'zigbee2mqtt/GameShow Buzzers', buttons: { '1_single': 'slot_1' } }],
  team_presets: [
    { id: 'kids_vs_parents', name: 'Kids vs Parents', teams: [
      { name: 'Kids', color: '#e6b325', members: ['felix'] },
      { name: 'Parents', color: '#3273dc', members: ['kckern', 'ghost_user'] },
    ] },
  ],
  defaults: { timer_seconds: 15 },
  sounds: { pack: 'classic' },
};

function makeService({ cfg = HOUSEHOLD_CFG, dataDir } = {}) {
  const configService = {
    getHouseholdAppConfig: () => cfg,
    getDataDir: () => dataDir,
  };
  const userService = {
    getProfile: (u) => {
      if (u === 'ghost_user') return null;
      if (u === 'kckern') return { username: u, display_name: 'KC Kern', group_label: 'Dad' };
      return { username: u, display_name: u.toUpperCase() };
    },
  };
  return new GameShowService({ configService, userService, logger: NOOP });
}

describe('GameShowService', () => {
  let dataDir;
  beforeEach(() => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gameshow-data-'));
    const setsDir = path.join(dataDir, 'content/games/jeopardy');
    fs.mkdirSync(setsDir, { recursive: true });
    fs.copyFileSync(path.join(FIXTURES, 'valid-set.yml'), path.join(setsDir, 'valid-set.yml'));
    fs.copyFileSync(path.join(FIXTURES, 'invalid-set.yml'), path.join(setsDir, 'invalid-set.yml'));
  });

  it('getConfig hydrates preset members via userService and applies defaults', () => {
    const cfg = makeService({ dataDir }).getConfig();
    expect(cfg.team_presets[0].teams[0].members[0]).toEqual(
      { id: 'felix', name: 'FELIX', avatar: '/api/v1/static/users/felix' });
    // contextual label (group_label) wins over display_name
    expect(cfg.team_presets[0].teams[1].members[0]).toEqual(
      { id: 'kckern', name: 'Dad', avatar: '/api/v1/static/users/kckern' });
    // unknown user passes through, no avatar
    expect(cfg.team_presets[0].teams[1].members[1]).toEqual(
      { id: 'ghost_user', name: 'ghost_user', avatar: null });
    expect(cfg.defaults.timer_seconds).toBe(15);
    expect(cfg.defaults.mute).toBe(false);
    expect(cfg.buzzers).toHaveLength(1);
  });

  it('getConfig tolerates a missing household config', () => {
    const cfg = makeService({ cfg: null, dataDir }).getConfig();
    expect(cfg.buzzers).toEqual([]);
    expect(cfg.team_presets).toEqual([]);
    expect(cfg.defaults.timer_seconds).toBe(12);
    expect(cfg.sounds.pack).toBe('classic');
  });

  it('listSets reports valid and invalid sets without throwing', () => {
    const sets = makeService({ dataDir }).listSets('jeopardy');
    const valid = sets.find((s) => s.id === 'valid-set');
    const invalid = sets.find((s) => s.id === 'invalid-set');
    expect(valid).toMatchObject({ title: 'Fixture Night', roundCount: 1, valid: true, error: null });
    expect(invalid.valid).toBe(false);
    expect(invalid.error).toMatch(/karaoke|categories/);
  });

  it('getSet returns the normalized set; throws on missing/invalid', () => {
    const svc = makeService({ dataDir });
    const set = svc.getSet('jeopardy', 'valid-set');
    expect(set.rounds[0].categories[0].clues[1].daily_double).toBe(true);
    expect(() => svc.getSet('jeopardy', 'nope')).toThrow(/not found/);
    expect(() => svc.getSet('jeopardy', 'invalid-set')).toThrow(/invalid/);
    expect(() => svc.getSet('../../etc', 'x')).toThrow(/game/);
  });
});
