import { describe, it, expect } from 'vitest';
import { bootstrapNotifications } from '#composition/modules/notifications.mjs';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

describe('bootstrapNotifications governance wiring', () => {
  it('wires a ledger store + config loader so a repeat send is suppressed', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'notif-'));
    try {
      // configLoader now reads via reloadHouseholdAppConfig (fresh-disk-read), not
      // getHouseholdAppConfig (stale cache) — see notifications.mjs. Both are
      // wired here so the wiring test still exercises the real configLoader path.
      const notificationsConfig = { quiet_hours: { enabled: false }, cooldowns: { ceremony: 60, default: 60 } };
      const configService = {
        getHouseholdAppConfig: () => notificationsConfig,
        reloadHouseholdAppConfig: () => notificationsConfig,
      };
      const { notificationService } = bootstrapNotifications({
        eventBus: { publish() {} },
        configService,
        dataPath: dir,
        clock: { now: () => new Date(2026, 6, 17, 12, 0, 0) },
        logger: { debug() {}, warn() {}, info() {}, child: () => ({ debug() {}, warn() {}, info() {} }) },
      });
      const intent = { title: 't', body: 'b', category: 'ceremony', urgency: 'normal', metadata: { username: 'u' }, dedupeKey: 'ceremony:x' };
      const r1 = await notificationService.send(intent);
      const r2 = await notificationService.send(intent);
      expect(r2.some(x => x.suppressed)).toBe(true);
      expect(r2.find(x => x.suppressed).reason).toBe('cooldown');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});
