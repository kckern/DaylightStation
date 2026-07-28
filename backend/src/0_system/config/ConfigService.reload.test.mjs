import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { ConfigService } from './ConfigService.mjs';

// reloadHouseholdAppConfig must write the fresh config back into the served
// snapshot — getHouseholdAppConfig() consumers (e.g. the piano poster-wall
// progress use case) read #config, so a reload that only RETURNS the fresh
// copy leaves every other caller on boot-time values.
test('reloadHouseholdAppConfig updates what getHouseholdAppConfig serves', () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cfg-reload-'));
  fs.mkdirSync(path.join(dataDir, 'household', 'config'), { recursive: true });
  fs.writeFileSync(path.join(dataDir, 'household', 'config', 'piano.yml'), 'videos:\n  progress_overlay:\n    recency_days: 7\n');

  const svc = new ConfigService({
    system: { dataDir, defaultHouseholdId: 'household' },
    households: { household: { _folderName: 'household', apps: { piano: { videos: { progress_overlay: { recency_days: 7 } } } } } },
  });
  assert.equal(svc.getHouseholdAppConfig(null, 'piano').videos.progress_overlay.recency_days, 7);

  fs.writeFileSync(path.join(dataDir, 'household', 'config', 'piano.yml'), 'videos:\n  progress_overlay:\n    recency_days: 90\n');
  const fresh = svc.reloadHouseholdAppConfig(null, 'piano');
  assert.equal(fresh.videos.progress_overlay.recency_days, 90);
  assert.equal(svc.getHouseholdAppConfig(null, 'piano').videos.progress_overlay.recency_days, 90);
});

test('reloadHouseholdAppConfig on a missing file returns null and keeps the snapshot', () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cfg-reload-'));
  fs.mkdirSync(path.join(dataDir, 'household', 'config'), { recursive: true });
  const svc = new ConfigService({
    system: { dataDir, defaultHouseholdId: 'household' },
    households: { household: { _folderName: 'household', apps: { piano: { videos: {} } } } },
  });
  assert.equal(svc.reloadHouseholdAppConfig(null, 'nope'), null);
  assert.deepEqual(svc.getHouseholdAppConfig(null, 'piano'), { videos: {} });
});
