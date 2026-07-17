import { describe, it, expect, vi } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { NotificationConfigService } from '#apps/notification/NotificationConfigService.mjs';

function make() {
  const dir = mkdtempSync(path.join(tmpdir(), 'ncfg-'));
  let stored = { quiet_hours: { enabled: true, start: '21:00', end: '07:00' }, cooldowns: { ceremony: 1200, default: 60 } };
  const reload = vi.fn(() => { /* re-read from disk into `stored` in real impl; here noop */ });
  const configService = {
    getHouseholdAppConfig: () => stored,
    getHouseholdPath: (sub) => path.join(dir, sub),
    reloadHouseholdAppConfig: reload,
  };
  // ensure config dir exists
  mkdirSync(path.join(dir, 'config'), { recursive: true });
  return { svc: new NotificationConfigService({ configService, logger: { warn() {} } }), dir, reload, setStored: (s) => { stored = s; } };
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
