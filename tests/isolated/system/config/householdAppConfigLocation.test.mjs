import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { ConfigService } from '#system/config/ConfigService.mjs';

// Task 13: retire household/config/, colocate each app's config with its own
// domain folder (household/<app>/config.yml). reloadHouseholdAppConfig is the
// one method that does I/O.
//
// Phase E finished the job: the household/config/<app>.yml fallback is deleted,
// so the colocated path is not merely PREFERRED — it is the only one. The
// fallback cases below are inverted rather than removed, because a test that
// the retired path is ignored is what catches the fallback coming back.
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

  // INVERTED in Phase E (was 'falls back to <household>/config/<app>.yml when
  // nothing has been colocated yet').
  it('IGNORES <household>/config/<app>.yml — a flat-only config reads as absent', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cfg-loc-'));
    const configDir = path.join(tmp, 'household', 'config');
    fs.mkdirSync(configDir, { recursive: true });
    fs.writeFileSync(path.join(configDir, 'fitness.yml'), 'marker: legacy\n');

    const svc = new ConfigService({
      system: { dataDir: tmp, defaultHouseholdId: 'household' },
      households: { household: { _folderName: 'household' } },
    });
    expect(svc.reloadHouseholdAppConfig(null, 'fitness')).toBeNull();
    // And the WRITE side must not aim at the retired directory either — that is
    // how it would get recreated.
    expect(svc.getHouseholdAppConfigPath(null, 'fitness'))
      .toBe(path.join(tmp, 'household', 'fitness', 'config.yml'));

    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('reads only the colocated file when both locations exist', () => {
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
