/**
 * I2 (final-review fix wave, 2026-08-16): AppsConfigService.writeAppConfig
 * resolved its target from a static APP_CONFIGS map with NO existence guard
 * — if a future config move isn't reflected in that map, an admin write
 * would silently land nowhere anyone reads back (the exact bug class
 * NotificationConfigService hit and fixed the same day, by routing writes
 * through the shared ConfigService#getHouseholdAppConfigPath resolver).
 *
 * A full swap to that shared resolver was ruled out here — it resolves by
 * appId under the household's OWN folder name, and at least 'shopping'
 * (real file: household/harvest/config.yml) and 'media' (real file:
 * household/config/media-app.yml, DISTINCT from the unrelated but
 * real household/media/config.yml) don't fit that shape. So the fix is a
 * guard: writeAppConfig now throws NotFoundError instead of silently
 * `mkdir -p`-ing a new tree when the resolved directory doesn't exist.
 *
 * These tests prove both directions:
 *  - write-then-read agrees for 2 real app ids, one colocated (fitness,
 *    household/fitness/config.yml) and one still-legacy (finance,
 *    household/config/finance.yml) — the same shape of proof that caught
 *    the original NotificationConfigService bug.
 *  - a stale/unrecognized-directory app id throws NotFoundError on write,
 *    rather than writing to nowhere.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { AppsConfigService } from '#apps/admin/AppsConfigService.mjs';
import { YamlConfigFileStore } from '#adapters/persistence/yaml/YamlConfigFileStore.mjs';

let tmpRoot;
let dataRoot;
let service;

function write(rel, content) {
  const abs = path.join(dataRoot, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content, 'utf8');
}

beforeEach(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'apps-cfg-svc-'));
  dataRoot = path.join(tmpRoot, 'data');
  fs.mkdirSync(dataRoot, { recursive: true });

  const configService = { getDataDir: () => dataRoot };
  const configFiles = new YamlConfigFileStore({ logger: { info() {}, warn() {}, error() {} } });
  service = new AppsConfigService({ configFiles, configService, logger: { info() {}, warn() {}, error() {} } });
});

afterEach(() => {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

describe('AppsConfigService — write-then-read agreement (real app ids)', () => {
  it('fitness (colocated: household/fitness/config.yml) — write lands where read looks', () => {
    write('household/fitness/config.yml', 'marker: original\n');

    const res = service.writeAppConfig('fitness', { parsed: { marker: 'updated', governance: { enabled: true } } });
    expect(res.ok).toBe(true);
    expect(res.configPath).toBe('household/fitness/config.yml');

    const readback = service.readAppConfig('fitness');
    expect(readback.parsed).toEqual({ marker: 'updated', governance: { enabled: true } });
  });

  it('finance (still-legacy: household/config/finance.yml) — write lands where read looks', () => {
    write('household/config/finance.yml', 'marker: original\n');

    const res = service.writeAppConfig('finance', { parsed: { marker: 'updated', payroll: { account_id: 732539 } } });
    expect(res.ok).toBe(true);
    expect(res.configPath).toBe('household/config/finance.yml');

    const readback = service.readAppConfig('finance');
    expect(readback.parsed).toEqual({ marker: 'updated', payroll: { account_id: 732539 } });
  });
});

describe('AppsConfigService — stale-map write guard', () => {
  it('throws NotFoundError instead of silently creating a new directory when the resolved config dir does not exist', () => {
    // No household/fitness/ directory was ever created under this tmp root —
    // simulates APP_CONFIGS pointing at a location a config move already
    // walked away from. Before the fix, writeText's mkdirSync(recursive:true)
    // would have silently created household/fitness/ and written the file;
    // nothing would ever read it back from wherever the config ACTUALLY lives.
    expect(fs.existsSync(path.join(dataRoot, 'household/fitness'))).toBe(false);

    let caught;
    try {
      service.writeAppConfig('fitness', { parsed: { marker: 'should-not-land' } });
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeDefined();
    expect(caught.name).toBe('NotFoundError');
    // And, critically, nothing was silently created.
    expect(fs.existsSync(path.join(dataRoot, 'household/fitness'))).toBe(false);
  });

  it('still throws ValidationError for a genuinely unknown app id (pre-existing behavior, unchanged)', () => {
    expect(() => service.writeAppConfig('not-a-real-app', { parsed: {} })).toThrow();
  });
});
