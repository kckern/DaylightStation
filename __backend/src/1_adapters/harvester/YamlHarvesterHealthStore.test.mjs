import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { YamlHarvesterHealthStore } from './YamlHarvesterHealthStore.mjs';

const dirs = [];
const tempDir = () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'harvester-health-')); dirs.push(d); return d; };
afterEach(() => { for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true }); });

describe('YamlHarvesterHealthStore', () => {
  it('loads null before anything is saved', () => {
    expect(new YamlHarvesterHealthStore({ path: path.join(tempDir(), 'harvester-health') }).load()).toBe(null);
  });
  it('round-trips state through a .yml file', () => {
    const dir = tempDir();
    const store = new YamlHarvesterHealthStore({ path: path.join(dir, 'harvester-health') });
    const state = { withings: { status: 'failing', failures: 3, lastSuccessAt: '2026-10-01T19:00:00.000Z', latestDate: '2026-10-01' } };
    store.save(state);
    expect(fs.existsSync(path.join(dir, 'harvester-health.yml'))).toBe(true);
    expect(new YamlHarvesterHealthStore({ path: path.join(dir, 'harvester-health') }).load()).toEqual(state);
  });
});
