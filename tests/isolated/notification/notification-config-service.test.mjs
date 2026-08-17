import { describe, it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, readFileSync, existsSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ConfigService } from '#system/config/ConfigService.mjs';
import { NotificationConfigService } from '#apps/notification/NotificationConfigService.mjs';
import { YamlConfigFileStore } from '#adapters/persistence/yaml/YamlConfigFileStore.mjs';

// task-13 review, Critical 2: the previous version of this file built its
// OWN hand-rolled configService mock with a hardcoded legacy `config/`
// write target. That mock could never disagree with itself, so it could
// never catch NotificationConfigService writing to a path its own read side
// (reloadHouseholdAppConfig, via the REAL colocated-first ConfigService
// resolver) had already stopped reading from. This file now runs against
// the real ConfigService so read and write resolution can actually drift
// apart if the production code regresses.

/**
 * @param {string} dir - temp data root
 * @param {'colocated'|'legacy'|'both'|'neither'} fixture - where the
 *   notifications.yml starting file (if any) lives, before updateConfig() runs.
 */
function make(fixture) {
  const dir = mkdtempSync(path.join(tmpdir(), 'ncfg-'));
  const householdDir = path.join(dir, 'household');
  mkdirSync(householdDir, { recursive: true });

  const seed = { quiet_hours: { enabled: true, start: '21:00', end: '07:00' }, cooldowns: { ceremony: 1200, default: 60 } };
  const dump = (obj) => `quiet_hours:\n  enabled: ${obj.quiet_hours.enabled}\n  start: "${obj.quiet_hours.start}"\n  end: "${obj.quiet_hours.end}"\ncooldowns:\n  ceremony: ${obj.cooldowns.ceremony}\n  default: ${obj.cooldowns.default}\n`;

  const colocatedDir = path.join(householdDir, 'notifications');
  const colocatedFile = path.join(colocatedDir, 'config.yml');
  const legacyDir = path.join(householdDir, 'config');
  const legacyFile = path.join(legacyDir, 'notifications.yml');

  if (fixture === 'colocated' || fixture === 'both') {
    mkdirSync(colocatedDir, { recursive: true });
    writeFileSync(colocatedFile, dump(seed));
  }
  if (fixture === 'legacy' || fixture === 'both') {
    mkdirSync(legacyDir, { recursive: true });
    writeFileSync(legacyFile, dump(seed));
  }

  const configService = new ConfigService({
    system: { dataDir: dir, defaultHouseholdId: 'household' },
    households: { household: { _folderName: 'household' } },
  });
  // Real store — the service writes through `configFiles.writeYaml`, and
  // these tests assert on the bytes/location that land on disk.
  const configFiles = new YamlConfigFileStore({ logger: { warn() {}, info() {} } });
  const svc = new NotificationConfigService({ configFiles, configService, logger: { warn() {} } });
  return { svc, dir, colocatedFile, legacyFile };
}

describe('NotificationConfigService', () => {
  it('returns config with defaults filled (colocated fixture)', () => {
    const { svc } = make('colocated');
    const c = svc.getConfig();
    expect(c.quiet_hours.start).toBe('21:00');
    expect(c.cooldowns.default).toBe(60);
  });

  it('CRITICAL 2 regression: write-then-read round-trips through the COLOCATED file when it exists — the write must not land in a legacy shadow copy nothing reads', () => {
    const { svc, colocatedFile, legacyFile } = make('colocated');

    const written = svc.updateConfig({
      quiet_hours: { enabled: false, start: '22:00', end: '06:00' },
      cooldowns: { ceremony: 600, default: 30 },
    });

    // The write landed in the SAME file getConfig()/reloadHouseholdAppConfig
    // reads — this is the exact assertion that would have caught the bug:
    // the old code wrote to legacyFile while reads resolved colocatedFile.
    expect(existsSync(colocatedFile)).toBe(true);
    expect(readFileSync(colocatedFile, 'utf8')).toContain('22:00');
    // No stale shadow copy left behind at the legacy path.
    expect(existsSync(legacyFile)).toBe(false);

    // updateConfig()'s own return value reflects the write, not a stale cache.
    expect(written.quiet_hours.start).toBe('22:00');
    expect(written.cooldowns.ceremony).toBe(600);

    // A fully independent getConfig() call after the write sees it too —
    // this is the "silently discarded" failure mode: before the fix, this
    // would still show 21:00 because the read resolved colocatedFile (which
    // updateConfig never touched) while the write landed at legacyFile.
    const again = svc.getConfig();
    expect(again.quiet_hours.start).toBe('22:00');
    expect(again.cooldowns.ceremony).toBe(600);
  });

  it('falls back to the legacy path for an app that has not been colocated yet', () => {
    const { svc, colocatedFile, legacyFile } = make('legacy');

    const written = svc.updateConfig({
      quiet_hours: { enabled: false, start: '23:00', end: '05:00' },
      cooldowns: { default: 45 },
    });

    expect(existsSync(legacyFile)).toBe(true);
    expect(readFileSync(legacyFile, 'utf8')).toContain('23:00');
    expect(existsSync(colocatedFile)).toBe(false);
    expect(written.quiet_hours.start).toBe('23:00');
    expect(svc.getConfig().quiet_hours.start).toBe('23:00');
  });

  it('prefers the colocated file over a legacy shadow when both exist', () => {
    const { svc, colocatedFile, legacyFile } = make('both');

    svc.updateConfig({
      quiet_hours: { enabled: true, start: '20:00', end: '08:00' },
      cooldowns: { default: 90 },
    });

    expect(readFileSync(colocatedFile, 'utf8')).toContain('20:00');
    // The legacy file is untouched (still holds the seed value) — proves the
    // write went to colocated only, not both.
    expect(readFileSync(legacyFile, 'utf8')).toContain('21:00');
    expect(svc.getConfig().quiet_hours.start).toBe('20:00');
  });

  it('rejects a bad time with a VALIDATION error', () => {
    const { svc } = make('colocated');
    expect(() => svc.updateConfig({ quiet_hours: { enabled: true, start: '9am', end: '07:00' }, cooldowns: { default: 60 } }))
      .toThrowError(/time/i);
  });
  it('rejects a negative cooldown', () => {
    const { svc } = make('colocated');
    expect(() => svc.updateConfig({ quiet_hours: { enabled: true, start: '21:00', end: '07:00' }, cooldowns: { ceremony: -5, default: 60 } }))
      .toThrowError(/cooldown/i);
  });
});
