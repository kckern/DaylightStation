import { describe, it, expect, vi } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { loadYaml } from '#system/utils/FileIO.mjs';
import { NotificationConfigService } from '#apps/notification/NotificationConfigService.mjs';

// Mirrors the real ConfigService split: getHouseholdAppConfig is a STALE
// in-memory-cache read (fixed at construction, never updated by writes),
// while reloadHouseholdAppConfig genuinely re-reads notifications.yml from
// disk on every call — exactly like ConfigService#reloadHouseholdAppConfig.
// NotificationConfigService must read via the latter for updateConfig()'s
// round-trip to work; if it reads via getHouseholdAppConfig, this test fails.
function make() {
  const dir = mkdtempSync(path.join(tmpdir(), 'ncfg-'));
  mkdirSync(path.join(dir, 'config'), { recursive: true });

  const staleConfig = { quiet_hours: { enabled: true, start: '21:00', end: '07:00' }, cooldowns: { ceremony: 1200, default: 60 } };
  const reload = vi.fn(() => loadYaml(path.join(dir, 'config', 'notifications')) ?? null);
  const configService = {
    getHouseholdAppConfig: () => staleConfig,
    getHouseholdPath: (sub) => path.join(dir, sub),
    reloadHouseholdAppConfig: reload,
  };
  return { svc: new NotificationConfigService({ configService, logger: { warn() {} } }), dir, reload };
}

describe('NotificationConfigService', () => {
  it('returns config with defaults filled', () => {
    const { svc } = make();
    const c = svc.getConfig();
    expect(c.quiet_hours.start).toBe('21:00');
    expect(c.cooldowns.default).toBe(60);
  });
  it('writes notifications.yml and reloads on update', () => {
    const { svc, dir, reload } = make();
    svc.updateConfig({ quiet_hours: { enabled: false, start: '22:00', end: '06:00' }, cooldowns: { ceremony: 600, default: 30 } });
    const file = path.join(dir, 'config', 'notifications.yml');
    expect(existsSync(file)).toBe(true);
    expect(readFileSync(file, 'utf8')).toContain('22:00');
    expect(reload).toHaveBeenCalled();
  });

  it('round-trips: updateConfig()\'s return reflects the just-written values, not the stale cache', () => {
    // The "stale cache" mock (getHouseholdAppConfig) is fixed to 21:00/1200 and
    // never changes. Only the fresh-disk-read mock (reloadHouseholdAppConfig)
    // sees writes. If NotificationConfigService.getConfig()/updateConfig() ever
    // regress to reading via getHouseholdAppConfig, this assertion fails because
    // the returned values would be the stale 21:00/1200, not the new ones below.
    const { svc } = make();
    const result = svc.updateConfig({ quiet_hours: { enabled: false, start: '22:00', end: '06:00' }, cooldowns: { ceremony: 600, default: 30 } });
    expect(result.quiet_hours.start).toBe('22:00');
    expect(result.quiet_hours.end).toBe('06:00');
    expect(result.quiet_hours.enabled).toBe(false);
    expect(result.cooldowns.ceremony).toBe(600);

    // A subsequent independent getConfig() call must also see the new values
    // (proves the fix isn't limited to updateConfig's own return path).
    const again = svc.getConfig();
    expect(again.quiet_hours.start).toBe('22:00');
    expect(again.cooldowns.ceremony).toBe(600);
  });

  it('rejects a bad time with a VALIDATION error', () => {
    const { svc } = make();
    expect(() => svc.updateConfig({ quiet_hours: { enabled: true, start: '9am', end: '07:00' }, cooldowns: { default: 60 } }))
      .toThrowError(/time/i);
  });
  it('rejects a negative cooldown', () => {
    const { svc } = make();
    expect(() => svc.updateConfig({ quiet_hours: { enabled: true, start: '21:00', end: '07:00' }, cooldowns: { ceremony: -5, default: 60 } }))
      .toThrowError(/cooldown/i);
  });
});
