/**
 * A system alert with no recipient is not an alert.
 *
 * The only automated device alert in the repo (the ESP relay watchdog) sends
 * `category: 'system', urgency: 'high'` with no `metadata.username`, and
 * TelegramNotificationAdapter refuses to send without a chat id — which it
 * resolves from that very field. So the alert designed for "something the house
 * depends on has stopped and nobody would otherwise notice" returned
 * `delivered: false` every time.
 *
 * Recipient resolution is the gap, not transport, so the default lands in
 * NotificationService. These tests use a stub telegram adapter throughout: no
 * real chat id is ever resolved and no message leaves the process.
 */
import { describe, it, expect, vi } from 'vitest';
import { NotificationService } from '#apps/notification/NotificationService.mjs';
import { bootstrapNotifications } from '#composition/modules/notifications.mjs';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

function makeService({ resolveDefaultRecipient, channels = ['telegram'] } = {}) {
  const sent = [];
  const telegram = {
    channel: 'telegram',
    send: async (intent) => {
      // Mirror the real adapter's contract: no username ⇒ no chat id ⇒ refused.
      const username = intent.metadata?.username;
      if (!username) return { delivered: false, error: `no telegram chat id for user "${username}"` };
      sent.push(intent);
      return { delivered: true, channelId: `tg-stub-${username}` };
    },
  };
  const svc = new NotificationService({
    adapters: [telegram],
    preferenceLoader: () => ({ getChannelsFor: () => channels }),
    resolveDefaultRecipient,
    logger: { debug() {}, warn() {}, info() {} },
  });
  return { svc, sent };
}

const systemAlert = (over = {}) => ({
  title: 'Relay has gone quiet',
  body: 'Kitchen relay has sent nothing for 12h.',
  category: 'system',
  urgency: 'high',
  ...over,
});

describe('system-category recipient resolution', () => {
  it('resolves a recipient for a system intent that carries no username', async () => {
    const { svc, sent } = makeService({ resolveDefaultRecipient: () => 'test-user' });

    const results = await svc.send(systemAlert());

    expect(results[0].delivered).toBe(true);
    expect(sent).toHaveLength(1);
    expect(sent[0].metadata.username).toBe('test-user');
  });

  it('leaves an explicitly addressed system intent alone', async () => {
    const { svc, sent } = makeService({ resolveDefaultRecipient: () => 'test-user' });

    await svc.send(systemAlert({ metadata: { username: 'other-user', deviceId: 'piano-tablet' } }));

    expect(sent[0].metadata.username).toBe('other-user');
    // The rest of the metadata must survive the rewrite.
    expect(sent[0].metadata.deviceId).toBe('piano-tablet');
  });

  it('does not address non-system categories to the household head', async () => {
    // A ceremony nudge without a username is a caller bug, not a house-wide
    // alert. Defaulting it would deliver one person's private prompt to another.
    const { svc, sent } = makeService({ resolveDefaultRecipient: () => 'test-user' });

    const results = await svc.send({
      title: 'Set your intention', body: 'b', category: 'ceremony', urgency: 'normal',
    });

    expect(sent).toHaveLength(0);
    expect(results[0].delivered).toBe(false);
  });

  it('degrades to the old behaviour when no resolver is wired', async () => {
    const { svc, sent } = makeService({ resolveDefaultRecipient: undefined });

    const results = await svc.send(systemAlert());

    expect(sent).toHaveLength(0);
    expect(results[0].delivered).toBe(false);
  });

  it('survives a resolver that throws, and still attempts delivery', async () => {
    const { svc } = makeService({
      resolveDefaultRecipient: () => { throw new Error('config not loaded'); },
    });

    const results = await svc.send(systemAlert());

    expect(results[0].delivered).toBe(false);
    expect(results[0].error).toMatch(/chat id/);
  });

  it('keys the dedupe ledger on the resolved recipient, not on a placeholder', async () => {
    const recorded = [];
    const svc = new NotificationService({
      adapters: [{ channel: 'app', send: async () => ({ delivered: true, channelId: 'app' }) }],
      preferenceLoader: () => ({ getChannelsFor: () => ['app'] }),
      resolveDefaultRecipient: () => 'test-user',
      policy: { evaluate: () => ({ send: true }) },
      ledgerStore: {
        getLastSent: () => null,
        recordSent: (e) => recorded.push(e),
        recordSuppressed: () => {},
      },
      configLoader: () => ({ quietHours: null, cooldowns: {} }),
      clock: { now: () => new Date(2026, 7, 16, 12, 0, 0) },
      logger: { debug() {}, warn() {}, info() {} },
    });

    await svc.send(systemAlert({ dedupeKey: 'playback-stall:piano-tablet' }));

    expect(recorded).toHaveLength(1);
    expect(recorded[0].username).toBe('test-user');
  });
});

describe('bootstrapNotifications system recipient wiring', () => {
  it('delivers a recipient-less system alert end to end through the stack', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'notif-sys-'));
    try {
      const notificationsConfig = { quiet_hours: { enabled: false }, cooldowns: { default: 60 } };
      const configService = {
        getHouseholdAppConfig: () => notificationsConfig,
        reloadHouseholdAppConfig: () => notificationsConfig,
      };
      // A stub messaging adapter — sendMessage is captured, never dispatched, so
      // this verifies delivery without a chat id, a token, or a real person.
      const sendMessage = vi.fn(async () => ({ ok: true }));
      const { notificationService } = bootstrapNotifications({
        eventBus: { publish() {} },
        telegramAdapter: { sendMessage },
        resolveChatId: (username) => (username === 'test-user' ? 987654 : null),
        resolveDefaultRecipient: () => 'test-user',
        configService,
        dataPath: dir,
        clock: { now: () => new Date(2026, 7, 16, 12, 0, 0) },
        logger: { debug() {}, warn() {}, info() {}, child: () => ({ debug() {}, warn() {}, info() {} }) },
      });

      const results = await notificationService.send({
        title: 'Playback has stalled',
        body: 'piano-tablet has not advanced for 60s.',
        category: 'system',
        urgency: 'high',
        dedupeKey: 'playback-stall:piano-tablet:1',
      });

      expect(results.some((r) => r.channel === 'telegram' && r.delivered)).toBe(true);
      expect(sendMessage).toHaveBeenCalledTimes(1);
      expect(sendMessage.mock.calls[0][0]).toBe(987654);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});
