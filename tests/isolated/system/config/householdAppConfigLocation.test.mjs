import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { ConfigService } from '#system/config/ConfigService.mjs';

// Task 13: retire household/config/, colocate each app's config with its own
// domain folder (household/<app>/config.yml). reloadHouseholdAppConfig is the
// one method that does I/O — it must prefer the colocated location and fall
// back to the legacy household/config/<app>.yml for anything not yet moved.
describe('getHouseholdAppConfig resolution', () => {
  it('reads <household>/<app>/config.yml, not <household>/config/<app>.yml', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cfg-loc-'));
    const appDir = path.join(tmp, 'household', 'fitness');
    fs.mkdirSync(appDir, { recursive: true });
    fs.writeFileSync(path.join(appDir, 'config.yml'), 'marker: colocated\n');

    const svc = new ConfigService({
      system: { dataDir: tmp, defaultHouseholdId: 'household' },
      households: { household: { _folderName: 'household' } },
    });
    expect(svc.reloadHouseholdAppConfig(null, 'fitness')?.marker).toBe('colocated');

    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('falls back to <household>/config/<app>.yml when nothing has been colocated yet', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cfg-loc-'));
    const configDir = path.join(tmp, 'household', 'config');
    fs.mkdirSync(configDir, { recursive: true });
    fs.writeFileSync(path.join(configDir, 'fitness.yml'), 'marker: legacy\n');

    const svc = new ConfigService({
      system: { dataDir: tmp, defaultHouseholdId: 'household' },
      households: { household: { _folderName: 'household' } },
    });
    expect(svc.reloadHouseholdAppConfig(null, 'fitness')?.marker).toBe('legacy');

    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('prefers the colocated file when both locations exist', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cfg-loc-'));
    const appDir = path.join(tmp, 'household', 'fitness');
    const configDir = path.join(tmp, 'household', 'config');
    fs.mkdirSync(appDir, { recursive: true });
    fs.mkdirSync(configDir, { recursive: true });
    fs.writeFileSync(path.join(appDir, 'config.yml'), 'marker: colocated\n');
    fs.writeFileSync(path.join(configDir, 'fitness.yml'), 'marker: legacy\n');

    const svc = new ConfigService({
      system: { dataDir: tmp, defaultHouseholdId: 'household' },
      households: { household: { _folderName: 'household' } },
    });
    expect(svc.reloadHouseholdAppConfig(null, 'fitness')?.marker).toBe('colocated');

    fs.rmSync(tmp, { recursive: true, force: true });
  });
});
