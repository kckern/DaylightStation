import fs from 'fs';
import os from 'os';
import path from 'path';
import yaml from 'js-yaml';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createFitnessServices } from './runtime.mjs';

// The real services over a temporary household tree. No Home Assistant
// gateway is supplied, so no controller is built and nothing leaves the disk.
let root;
const logger = { info() {}, warn() {}, error() {}, debug() {} };
const services = () => createFitnessServices({
  configService: { getHouseholdPath: (relative) => path.join(root, relative) },
  mediaRoot: path.join(root, 'media'),
  defaultHouseholdId: 'home',
  logger,
});
const record = { schema: 'skyline-invaders-run/v1', run: { id: 'run-1', level_id: 'invaders-1-1', started_at: '2026-11-11T17:00:00.000Z', ended_at: '2026-11-11T17:03:00.000Z', status: 'completed', duration_s: 180, score: 340, kills: 12, stars: 2, partner_id: 'test-partner' }, rider: { user_id: 'test-rider' } };
const putLevel = (id) => {
  const file = path.join(root, 'fitness/skyline-invaders/levels', `${id}.yml`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, yaml.dump({ schema: 'skyline-invaders-level/v1', id, name: id, duration_s: 60, pass: { kills: 3 }, waves: [{ at: 0, spawn: { meteor: 1 }, rate_s: 2 }] }));
};

beforeEach(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), 'invaders-wiring-')); });
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

describe('Skyline Invaders service wiring', () => {
  it('a saved run lands in the run log and advances the rider through the household levels', async () => {
    const { skylineInvadersRunService, skylineInvadersProgressService, skylineInvadersLevelCatalog } = services();
    putLevel('invaders-1-1');
    putLevel('invaders-1-2');

    expect((await skylineInvadersRunService.save(record, 'home')).created).toBe(true);
    expect(fs.existsSync(path.join(root, 'fitness/log/skyline-invaders/2026-11-11/run-1.yml'))).toBe(true);
    expect(fs.existsSync(path.join(root, 'fitness/skyline-invaders/progress/test-rider.yml'))).toBe(true);

    const world = await skylineInvadersProgressService.worldFor(skylineInvadersLevelCatalog.world('home'), 'test-rider', 'home');
    expect(world).toEqual({
      controls: null,
      next: 'invaders-1-2',
      levels: [
        { id: 'invaders-1-1', name: 'invaders-1-1', status: 'completed', best: { stars: 2, score: 340 } },
        { id: 'invaders-1-2', name: 'invaders-1-2', status: 'open' },
      ],
    });
  });

  // The record exactly as the browser's run builder shapes it (plan Task 11),
  // after the JSON hop the HTTP route puts it through. A retry of the same
  // save must read back equal from YAML, or the reward retry would be a 409.
  it('a retried save of the full run record is a repeat on disk, and a changed one conflicts', async () => {
    const metrics = { duration_s: 179.87, score: 340, kills: 12, stars: 2, base_hp: 80, shots_fired: 40, hits: 14, best_combo: 6, nukes: 1, boosts_used: 2 };
    const full = JSON.parse(JSON.stringify({
      schema: 'skyline-invaders-run/v1',
      run: { id: 'run-full', level_id: 'invaders-1-1', started_at: '2026-11-11T17:00:00.000Z', ended_at: '2026-11-11T17:03:00.000Z', status: 'completed', ...metrics, reward_rings: 20, fitness_session_id: 'fs-1', mat_equipment_id: 'step-mat', partner_id: 'test-partner' },
      rider: { user_id: 'test-rider' },
      result: { schema: 'gaming-result/v1', experience_id: 'skyline-invaders', status: 'completed', started_at: '2026-11-11T17:00:00.000Z', ended_at: '2026-11-11T17:03:00.000Z', participants: [{ id: 'test-rider' }, { id: 'test-partner' }], outcome: { kind: 'completed', score: 340, winner_ids: ['test-rider'] }, metrics },
    }));
    const { skylineInvadersRunService } = services();
    expect((await skylineInvadersRunService.save(full, 'home')).created).toBe(true);
    expect((await services().skylineInvadersRunService.save(structuredClone(full), 'home')).created).toBe(false);
    expect(await skylineInvadersRunService.get('run-full', 'home')).toEqual(full);
    await expect(skylineInvadersRunService.save({ ...full, run: { ...full.run, score: 341 } }, 'home')).rejects.toMatchObject({ code: 'RUN_CONFLICT' });
  });

  // createFitnessApiRouter needs the whole application graph, so it is not
  // built here. A mistyped service key would hand the router `undefined` and
  // every route would answer 503; this pins the three hand-offs to real keys.
  it('the API composition hands the router services that exist', () => {
    const built = services();
    const source = fs.readFileSync(new URL('./fitnessApi.mjs', import.meta.url), 'utf8');
    const handOffs = Object.fromEntries([...source.matchAll(/^\s*(skylineInvaders\w+): fitnessServices\.(\w+),$/gm)].map(([, option, key]) => [option, key]));
    expect(handOffs).toEqual({
      skylineInvadersLevels: 'skylineInvadersLevelCatalog',
      skylineInvadersRuns: 'skylineInvadersRunService',
      skylineInvadersProgress: 'skylineInvadersProgressService',
    });
    for (const key of Object.values(handOffs)) expect(built[key]).toBeTruthy();
  });

  it('a round shows up as a session activity for the shooter and the partner', async () => {
    const { skylineInvadersRunService, sessionGroupingService } = services();
    await skylineInvadersRunService.save(record, 'home');
    const group = { startTime: Date.parse('2026-11-11T16:55:00Z'), endTime: Date.parse('2026-11-11T17:10:00Z'), date: '2026-11-11' };
    const activities = await sessionGroupingService.activityRegistry.enrich(group, 'home');
    expect(activities.find((activity) => activity.type === 'skyline-invaders')).toMatchObject({ count: 1, items: [{ participants: ['test-rider', 'test-partner'], meta: { runId: 'run-1', stars: 2 } }] });
  });
});
