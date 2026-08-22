/**
 * task-13 review, Important 6: configLoader's colocated directory scan
 * (loadHouseholdApps's `appsFromColocated`, the NON_APP_DIRS exclusion, and
 * the colocated branches of loadAllHouseholds / loadHouseholdIntegrations /
 * loadHouseholdDevices) had zero test coverage — the existing suite only
 * covered ConfigService#reloadHouseholdAppConfig, which is NOT what
 * populates the boot-cached snapshot most consumers (getHouseholdAppConfig,
 * getHouseholdIntegrations, getHouseholdDevices) actually read from.
 *
 * These tests exercise the real, exported `loadConfig(dataDir)` entry point
 * against a temp data dir — no mocking of the loader internals — because
 * the merge-precedence and exclusion logic lives in module-private
 * functions only `loadConfig` calls.
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import loadConfig from '#system/config/configLoader.mjs';

let dataDir;

function write(rel, content) {
  const abs = path.join(dataDir, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content, 'utf8');
}

beforeEach(() => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'configloader-colocated-'));
});

afterEach(() => {
  fs.rmSync(dataDir, { recursive: true, force: true });
});

describe('configLoader — colocated household app scan (task-13)', () => {
  it('colocated <app>/config.yml wins over both legacy config/<app>.yml and apps/<app>/config.yml for the same app name', () => {
    write('household/household.yml', 'name: Test\nusers: [alice]\n');
    write('household/apps/piano/config.yml', 'source: legacy-apps\n');
    write('household/config/piano.yml', 'source: legacy-config\n');
    write('household/piano/config.yml', 'source: colocated\n');

    const config = loadConfig(dataDir);
    expect(config.households.default.apps.piano.source).toBe('colocated');
    // NON_APP_DIRS: household/config/ and household/apps/ are populated
    // (with real per-app files, the exact production shape) alongside
    // colocated app folders, and neither directory name itself becomes a
    // spurious app key.
    expect(config.households.default.apps.config).toBeUndefined();
    expect(config.households.default.apps.apps).toBeUndefined();
  });

  // INVERTED in Phase E (was 'an app present ONLY via the legacy config/
  // directory still loads (fallback union)'). The config/ scan is gone: a flat
  // file is no longer a source of app config, and — more importantly — no
  // longer a source of app NAMES. Kept rather than deleted so a reintroduced
  // scan fails here.
  it('an app present ONLY via the retired config/ directory does NOT load', () => {
    write('household/household.yml', 'name: Test\nusers: [alice]\n');
    write('household/config/finance.yml', 'source: legacy-config\n');
    // No household/finance/config.yml at all.

    const config = loadConfig(dataDir);
    expect(config.households.default.apps.finance).toBeUndefined();
  });

  it('an app present ONLY via the legacy apps/ directory still loads (fallback union)', () => {
    write('household/household.yml', 'name: Test\nusers: [alice]\n');
    write('household/apps/chatbots.yml', 'source: legacy-apps-toplevel\n');

    const config = loadConfig(dataDir);
    expect(config.households.default.apps.chatbots).toEqual({ source: 'legacy-apps-toplevel' });
  });

  it('excludes NON_APP_DIRS ("apps") from the colocated scan — household/apps/ is never itself treated as a colocated app domain named "apps"', () => {
    // Isolating this from the pre-existing legacy `apps/` loader needs a file
    // whose two possible readings produce DIFFERENT keys, so a passing
    // assertion actually distinguishes "colocated scan skipped it" from "no
    // mechanism read it at all":
    //   - the colocated scanner (if NOT excluded) treats 'apps' as a subdir
    //     of the household root and reads household/apps/config.yml into
    //     key 'apps' (the subdir's own name).
    //   - the PRE-EXISTING, unrelated "top-level YAML files in apps/" loader
    //     (loadAppsFromDir) reads the exact same file into key 'config' (the
    //     file's basename) — unaffected by NON_APP_DIRS either way.
    // So: key 'apps' must be absent (proves the guard fired) while key
    // 'config' must still be present with this file's content (proves the
    // unrelated mechanism wasn't collaterally broken).
    write('household/household.yml', 'name: Test\nusers: [alice]\n');
    write('household/apps/config.yml', 'marker: from-apps-toplevel-scan\n');

    const config = loadConfig(dataDir);
    expect(config.households.default.apps.apps).toBeUndefined();
    expect(config.households.default.apps.config).toEqual({ marker: 'from-apps-toplevel-scan' });
  });

  it('a colocated app config with no legacy counterpart loads correctly (the common post-migration case)', () => {
    write('household/household.yml', 'name: Test\nusers: [alice]\n');
    write('household/gratitude/config.yml', 'streak_reset_hour: 4\n');

    const config = loadConfig(dataDir);
    expect(config.households.default.apps.gratitude).toEqual({ streak_reset_hour: 4 });
  });

  it('a colocated config.yaml (not .yml) still loads — task-13 review Minor M5: ConfigService#getHouseholdAppConfigPath resolves .yaml via yamlExists on reload, so the boot-time colocated scan must too, or a .yaml file resolves on reload but silently does not exist at boot', () => {
    write('household/household.yml', 'name: Test\nusers: [alice]\n');
    write('household/media/config.yaml', 'streaming_quality: high\n');

    const config = loadConfig(dataDir);
    expect(config.households.default.apps.media).toEqual({ streaming_quality: 'high' });
  });
});

describe('configLoader — colocated household.yml / integrations.yml / devices.yml (task-13)', () => {
  it('loads household.yml from the household root (colocated), not config/', () => {
    write('household/household.yml', 'name: ColocatedHousehold\nusers: [alice]\n');
    write('household/config/household.yml', 'name: LegacyHousehold\nusers: [bob]\n');

    const config = loadConfig(dataDir);
    expect(config.households.default.name).toBe('ColocatedHousehold');
  });

  it('falls back to config/household.yml when no colocated household.yml exists', () => {
    write('household/config/household.yml', 'name: LegacyOnlyHousehold\nusers: [carol]\n');

    const config = loadConfig(dataDir);
    expect(config.households.default.name).toBe('LegacyOnlyHousehold');
  });

  it('loads integrations.yml from the household root (colocated) over config/integrations.yml', () => {
    write('household/household.yml', 'name: Test\nusers: [alice]\n');
    write('household/integrations.yml', 'plex:\n  enabled: true\n');
    write('household/config/integrations.yml', 'plex:\n  enabled: false\n');

    const config = loadConfig(dataDir);
    expect(config.households.default.integrations.plex.enabled).toBe(true);
  });

  it('loads hardware/devices.yml (colocated) over config/devices.yml', () => {
    write('household/household.yml', 'name: Test\nusers: [alice]\n');
    write('household/hardware/devices.yml', 'devices:\n  officetv:\n    type: linux-pc\n');
    write('household/config/devices.yml', 'devices:\n  officetv:\n    type: legacy-should-not-win\n');

    const config = loadConfig(dataDir);
    expect(config.households.default.devices.devices.officetv.type).toBe('linux-pc');
  });

  // INVERTED in Phase E (was 'falls back to config/integrations.yml and
  // config/devices.yml when un-migrated'). Both fallbacks are gone; a tree that
  // only has the retired copies must read as UNCONFIGURED (empty), never as
  // configured from a directory that no longer exists in production.
  it('IGNORES config/integrations.yml and config/devices.yml', () => {
    write('household/household.yml', 'name: Test\nusers: [alice]\n');
    write('household/config/integrations.yml', 'plex:\n  enabled: true\n');
    write('household/config/devices.yml', 'devices:\n  officetv:\n    type: shield-tv\n');

    const config = loadConfig(dataDir);
    expect(config.households.default.integrations).toEqual({});
    expect(config.households.default.devices).toEqual({});
  });
});
