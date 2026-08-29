/**
 * Stall detector → notification, stitched together.
 *
 * The two halves are unit-tested separately (PlaybackStallDetector.test.mjs and
 * notification-system-recipient.test.mjs). This joins them the way the
 * composition root does and asserts the thing that matters at 3am: a wedged
 * kiosk produces exactly ONE message, addressed to somebody, however many
 * heartbeats the stall spans.
 *
 * Delivery is verified against a stub messaging adapter whose `sendMessage` is a
 * spy. No token, no chat id lookup, no real recipient — the recipient resolver
 * returns 'test-user' and the chat id map only knows that name.
 */
import { describe, it, expect, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { PlaybackStallDetector } from '#apps/devices/services/PlaybackStallDetector.mjs';
import { bootstrapNotifications } from '#composition/modules/notifications.mjs';
// Relative rather than `#shared-contracts/…`: that subpath import is declared in
// backend/package.json, and tests/isolated resolves against the repo root.
import { DEVICE_STATE_TOPIC } from '../../../shared/contracts/media/topics.mjs';

function makeBus() {
  const handlers = [];
  return {
    subscribePattern: (predicate, handler) => {
      handlers.push({ predicate, handler });
      return () => handlers.splice(handlers.indexOf(handlers.at(-1)), 1);
    },
    publish() {},
    broadcast() {},
    _deliver(topic, payload) {
      for (const { predicate, handler } of handlers) {
        if (predicate(topic)) handler(payload, topic);
      }
    },
  };
}

describe('a wedged kiosk reaches a human', () => {
  it('sends exactly one high-urgency message for a stall spanning many heartbeats', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'stall-alert-'));
    try {
      const notificationsConfig = { quiet_hours: { enabled: false }, cooldowns: { default: 60 } };
      const configService = {
        getHouseholdAppConfig: () => notificationsConfig,
        reloadHouseholdAppConfig: () => notificationsConfig,
      };
      const sendMessage = vi.fn(async () => ({ ok: true }));
      const { notificationService } = bootstrapNotifications({
        eventBus: { publish() {} },
        telegramAdapter: { sendMessage },
        resolveChatId: (username) => (username === 'test-user' ? 123456 : null),
        resolveDefaultRecipient: () => 'test-user',
        configService,
        dataPath: dir,
        clock: { now: () => new Date(2026, 7, 16, 12, 0, 0) },
        logger: { debug() {}, warn() {}, info() {}, child: () => ({ debug() {}, warn() {}, info() {} }) },
      });

      const sends = [];
      const bus = makeBus();
      let now = 1_700_000_000_000;
      const detector = new PlaybackStallDetector({
        presenceGateway: {
          subscribeDeviceStates: (listener) => bus.subscribePattern(
            (topic) => topic.startsWith('device-state:'),
            (payload) => listener(payload),
          ),
        },
        clock: { now: () => now },
        stallThresholdMs: 60_000,
        logger: { debug() {}, info() {}, warn() {}, error() {} },
        onStall: ({ deviceId, contentId, title, position, stalledForMs }) => {
          const minutes = Math.max(1, Math.round(stalledForMs / 60_000));
          sends.push(notificationService.send({
            title: 'A screen is stuck',
            body: `${deviceId} says it is playing ${title || contentId} but the playhead `
              + `has not moved in ${minutes} minute(s) (stuck at ${Math.round(position)}s).`,
            category: 'system',
            urgency: 'high',
            dedupeKey: `playback-stall:${deviceId}:${contentId}`,
          }));
        },
      });
      detector.start();

      const item = { contentId: 'plex:694719', format: 'dash_video', title: 'A lecture', duration: 1800 };
      const beat = () => bus._deliver(DEVICE_STATE_TOPIC('piano-tablet'), {
        deviceId: 'piano-tablet',
        reason: 'heartbeat',
        ts: new Date(now).toISOString(),
        snapshot: {
          sessionId: 's', state: 'playing', currentItem: item, position: 0,
          queue: { items: [], currentIndex: -1, upNextCount: 0 },
          config: { shuffle: false, repeat: 'off', shader: null, volume: 50 },
          meta: { ownerId: 'piano-tablet', updatedAt: new Date(now).toISOString() },
        },
      });

      // 17 minutes of heartbeats at 5s — the real incident's duration.
      beat();
      for (let i = 0; i < 204; i += 1) { now += 5000; beat(); }
      const results = await Promise.all(sends);
      detector.stop();

      expect(sends).toHaveLength(1);
      expect(sendMessage).toHaveBeenCalledTimes(1);
      expect(results[0].some((r) => r.channel === 'telegram' && r.delivered)).toBe(true);

      const [chatId, text] = sendMessage.mock.calls[0];
      expect(chatId).toBe(123456);
      expect(text).toContain('A screen is stuck');
      expect(text).toContain('piano-tablet');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});
