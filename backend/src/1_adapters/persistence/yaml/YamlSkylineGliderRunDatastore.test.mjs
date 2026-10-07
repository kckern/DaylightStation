import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { YamlSkylineGliderRunDatastore } from './YamlSkylineGliderRunDatastore.mjs';

let root;
let store;
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'glider-runs-'));
  store = new YamlSkylineGliderRunDatastore({ configService: { getHouseholdPath: (relative) => path.join(root, relative) } });
});
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

const record = (over = {}) => ({ schema: 'skyline-glider-run/v1', run: { id: 'run-1', course_id: 'mountain-pass', started_at: '2026-10-06T17:00:00.000Z', ended_at: '2026-10-06T17:05:00.000Z', status: 'completed', duration_s: 300, ...over }, rider: { user_id: 'dad' }, collectibles: ['bell-1'] });

describe('YamlSkylineGliderRunDatastore', () => {
  it('round-trips a run and lists its local date', async () => {
    await store.create(record(), 'home');
    expect(await store.findById('run-1', 'home')).toEqual(record());
    expect(await store.findByDate('2026-10-06', 'home')).toEqual([record()]);
  });
});
