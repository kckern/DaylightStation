import { describe, it, expect } from 'vitest';
import { bootstrapNotifications } from '#composition/modules/notifications.mjs';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

/**
 * The notification stack has no bot of its own. It used to borrow NutriBot's
 * token, which turned the food-logging DM into the house alert firehose, so
 * app.mjs now leaves the telegram channel unwired until a dedicated bot exists.
 *
 * These lock in that "unwired" is a safe resting state rather than a broken
 * one: no throw, the in-app card still lands, and governance still keeps its
 * account of everything that was raised — which is what the future bot inherits.
 */
describe('notification stack with no telegram bot wired', () => {
  const withStack = async (fn) => {
    const dir = mkdtempSync(path.join(tmpdir(), 'notif-void-'));
    try {
      const notificationsConfig = { quiet_hours: { enabled: false }, cooldowns: { ceremony: 60, default: 60 } };
      const published = [];
      const { notificationService } = bootstrapNotifications({
        eventBus: { broadcast: (...args) => published.push(args) },
        telegramAdapter: null,          // the void: no bot configured
        resolveChatId: () => '575596036',
        configService: {
          getHouseholdAppConfig: () => notificationsConfig,
          reloadHouseholdAppConfig: () => notificationsConfig,
        },
        dataPath: dir,
        clock: { now: () => new Date(2026, 7, 18, 12, 0, 0) },
        logger: { debug() {}, warn() {}, info() {}, child: () => ({ debug() {}, warn() {}, info() {} }) },
      });
      await fn({ notificationService, published });
    } finally { rmSync(dir, { recursive: true, force: true }); }
  };

  const ceremony = (dedupeKey) => ({
    title: 'Set your intention',
    body: 'Your unit intention ceremony is due.',
    category: 'ceremony',
    urgency: 'normal',
    metadata: { username: 'kckern' },
    dedupeKey,
  });

  it('reports the telegram channel undelivered instead of throwing', async () => {
    await withStack(async ({ notificationService }) => {
      const results = await notificationService.send(ceremony('ceremony:unit_intention:2026-U597'));
      const telegram = results.find(r => r.channel === 'telegram');
      expect(telegram).toBeDefined();
      expect(telegram.delivered).toBe(false);
    });
  });

  it('still delivers the in-app card', async () => {
    await withStack(async ({ notificationService, published }) => {
      const results = await notificationService.send(ceremony('ceremony:unit_intention:2026-U598'));
      expect(results.find(r => r.channel === 'app')?.delivered).toBe(true);
      expect(published.length).toBeGreaterThan(0);
    });
  });

  it('still records the intent in the governance ledger', async () => {
    await withStack(async ({ notificationService }) => {
      // A second send of the same key can only be cooldown-suppressed if the
      // first was written to the ledger — despite nothing reaching Telegram.
      const key = 'ceremony:unit_intention:2026-U599';
      await notificationService.send(ceremony(key));
      const second = await notificationService.send(ceremony(key));
      expect(second.some(r => r.suppressed)).toBe(true);
      expect(second.find(r => r.suppressed).reason).toBe('cooldown');
    });
  });
});
