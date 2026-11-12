import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { YamlSkylineInvadersRunDatastore } from './YamlSkylineInvadersRunDatastore.mjs';
import { YamlSkylineInvadersProgressDatastore } from './YamlSkylineInvadersProgressDatastore.mjs';

let root;
const configService = () => ({ getHouseholdPath: (relative) => path.join(root, relative) });
beforeEach(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), 'invaders-store-')); });
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

const record = (over = {}) => ({ schema: 'skyline-invaders-run/v1', run: { id: 'run-1', level_id: 'invaders-1-1', started_at: '2026-11-11T17:00:00.000Z', ended_at: '2026-11-11T17:03:00.000Z', status: 'completed', duration_s: 180, score: 340, kills: 12, stars: 2, ...over }, rider: { user_id: 'test-rider' } });

describe('Skyline Invaders datastores', () => {
  it('round-trips a run under its start date in the fitness log', async () => {
    const store = new YamlSkylineInvadersRunDatastore({ configService: configService() });
    const file = await store.create(record(), 'home');
    expect(file).toBe(path.join(root, 'fitness/log/skyline-invaders/2026-11-11/run-1.yml'));
    expect(await store.findById('run-1', 'home')).toEqual(record());
    expect(await store.findByDate('2026-11-11', 'home')).toEqual([record()]);
    expect(await store.findAll('home')).toEqual([record()]);
    expect(await store.findById('missing', 'home')).toBeNull();
  });
  it('finds nothing before any run was ever saved', async () => {
    const store = new YamlSkylineInvadersRunDatastore({ configService: configService() });
    expect(await store.findById('run-1', 'home')).toBeNull();
    expect(await store.findByDate('2026-11-11', 'home')).toEqual([]);
    expect(await store.findAll('home')).toEqual([]);
  });
  it('stores one progress file per rider', async () => {
    const store = new YamlSkylineInvadersProgressDatastore({ configService: configService() });
    expect(await store.find('test-rider', 'home')).toBeFalsy();
    await store.save('test-rider', { schema: 'skyline-invaders-progress/v1', completed: {}, unlocked: [] }, 'home');
    expect(fs.existsSync(path.join(root, 'fitness/skyline-invaders/progress/test-rider.yml'))).toBe(true);
    expect(await store.find('test-rider', 'home')).toMatchObject({ schema: 'skyline-invaders-progress/v1' });
  });
  it('requires a config service', () => {
    expect(() => new YamlSkylineInvadersRunDatastore()).toThrow(/configService/);
    expect(() => new YamlSkylineInvadersProgressDatastore()).toThrow(/configService/);
  });
});
