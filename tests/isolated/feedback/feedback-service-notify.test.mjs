/**
 * Someone has to read the inbox.
 *
 * The feedback API is complete — list, get, audio, PATCH, DELETE — and its only
 * consumer was `curl` from a skill. Arrival triggered nothing beyond
 * `logger.info('feedback.created')`, so a child's recorded complaint sat in a
 * YAML file until somebody thought to go looking. These tests cover the arrival
 * notification, and in particular that a machine's stall report and a person's
 * voice message are told apart: the machine's incident already pages through the
 * stall detector, and paging twice for one event trains people to ignore both.
 *
 * The notification service here is a spy. Nothing is dispatched to any channel.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { FeedbackService } from '#apps/common/feedback/FeedbackService.mjs';

let dir;
let notificationService;
let service;

function makeService(extra = {}) {
  const configService = {
    getMediaDir: () => path.join(dir, 'media'),
    getHouseholdPath: (rel) => path.join(dir, 'household', rel),
  };
  return new FeedbackService({
    configService,
    transcriptionService: null,
    logger: { info() {}, warn() {}, error() {}, debug() {} },
    notificationService,
    ...extra,
  });
}

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'feedback-notify-'));
  notificationService = { send: vi.fn(async () => [{ delivered: true, channel: 'app' }]) };
  service = makeService();
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('feedback arrival notification', () => {
  it('notifies when a person records a report', async () => {
    await service.create({
      app: 'piano',
      audioBuffer: Buffer.from('fake audio'),
      durationMs: 4200,
      context: { route: '/piano', surface: 'operator-drawer' },
    });

    expect(notificationService.send).toHaveBeenCalledTimes(1);
    const intent = notificationService.send.mock.calls[0][0];
    expect(intent.category).toBe('system');
    expect(intent.title).toMatch(/feedback/i);
    expect(intent.body).toContain('piano');
  });

  it('notifies when a kiosk files its own report', async () => {
    await service.create({
      app: 'piano',
      audioBuffer: null,
      context: { auto: true, reason: 'playback-stall', deviceId: 'piano-tablet' },
    });

    expect(notificationService.send).toHaveBeenCalledTimes(1);
    const intent = notificationService.send.mock.calls[0][0];
    expect(intent.body).toContain('playback-stall');
  });

  it('tells a machine report and a human report apart', async () => {
    await service.create({ app: 'piano', audioBuffer: Buffer.from('x'), durationMs: 3000, context: {} });
    await service.create({ app: 'piano', audioBuffer: null, context: { auto: true, reason: 'playback-stall' } });

    const [human] = notificationService.send.mock.calls[0];
    const [machine] = notificationService.send.mock.calls[1];

    // A person spoke into the tablet asking for attention: reach a phone. A
    // machine report is the paper trail for an incident the stall detector has
    // already paged about, so it stays an in-app card.
    expect(human.urgency).toBe('high');
    expect(machine.urgency).toBe('normal');
    expect(human.title).not.toBe(machine.title);
    expect(human.metadata.auto).toBe(false);
    expect(machine.metadata.auto).toBe(true);
  });

  it('carries the app and id so the item can be opened from the alert', async () => {
    const item = await service.create({ app: 'piano', audioBuffer: Buffer.from('x'), context: {} });

    const intent = notificationService.send.mock.calls[0][0];
    expect(intent.metadata.app).toBe('piano');
    expect(intent.metadata.id).toBe(item.id);
    expect(intent.actions?.[0]?.data?.url).toContain(item.id);
  });

  it('dedupes repeat machine reports of the same reason, but never a human one', async () => {
    await service.create({ app: 'piano', audioBuffer: null, context: { auto: true, reason: 'playback-stall' } });
    await service.create({ app: 'piano', audioBuffer: null, context: { auto: true, reason: 'playback-stall' } });
    await service.create({ app: 'piano', audioBuffer: Buffer.from('a'), context: {} });
    await service.create({ app: 'piano', audioBuffer: Buffer.from('b'), context: {} });

    const keys = notificationService.send.mock.calls.map(([i]) => i.dedupeKey);
    // Two machine reports of one reason share a key, so the governance cooldown
    // collapses them. Two human recordings are two separate asks.
    expect(keys[0]).toBe(keys[1]);
    expect(keys[2]).not.toBe(keys[3]);
  });

  it('still saves the item when notification fails, and does not leak the rejection', async () => {
    const warn = vi.fn();
    const failing = makeService({ logger: { info() {}, warn, error() {}, debug() {} } });
    notificationService.send.mockRejectedValue(new Error('telegram down'));
    const unhandled = vi.fn();
    process.on('unhandledRejection', unhandled);

    let item;
    try {
      item = await failing.create({ app: 'piano', audioBuffer: Buffer.from('x'), context: {} });
      // Let the microtask queue drain so an unhandled rejection would surface.
      await new Promise((r) => setTimeout(r, 10));
    } finally { process.off('unhandledRejection', unhandled); }

    expect(item.id).toBeTruthy();
    expect(failing.get('piano', item.id)).toBeTruthy();
    expect(warn).toHaveBeenCalledWith('feedback.notify-failed', expect.objectContaining({ error: 'telegram down' }));
    expect(unhandled).not.toHaveBeenCalled();
  });

  it('survives a notification service that throws synchronously', async () => {
    notificationService.send.mockImplementation(() => { throw new Error('bus gone'); });

    const item = await service.create({ app: 'piano', audioBuffer: Buffer.from('x'), context: {} });

    expect(service.get('piano', item.id)).toBeTruthy();
  });

  it('still saves the item when no notification service is wired', async () => {
    const bare = makeService({ notificationService: null });

    const item = await bare.create({ app: 'piano', audioBuffer: Buffer.from('x'), context: {} });

    expect(service.get('piano', item.id)).toBeTruthy();
  });
});
