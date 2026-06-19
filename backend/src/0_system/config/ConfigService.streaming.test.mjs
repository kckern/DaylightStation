import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { ConfigService } from './ConfigService.mjs';

test('getStreamingProfiles globs streaming/*.yml as raw objects', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cfg-'));
  fs.mkdirSync(path.join(dir, 'streaming'));
  fs.writeFileSync(path.join(dir, 'streaming', 'soccerfull.yml'),
    'name: soccerfull\nstrategy: scrape\nformat: hls_video\nmatch:\n  hosts: [soccerfull.net]\n');
  const svc = new ConfigService({ system: { configDir: dir } });
  const profiles = svc.getStreamingProfiles();
  assert.equal(profiles.length, 1);
  assert.equal(profiles[0].name, 'soccerfull');
  assert.equal(profiles[0].strategy, 'scrape');
});

test('getStreamingProfiles returns [] when dir absent', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cfg-'));
  const svc = new ConfigService({ system: { configDir: dir } });
  assert.deepEqual(svc.getStreamingProfiles(), []);
});
