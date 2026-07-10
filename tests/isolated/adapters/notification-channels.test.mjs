import { describe, it, expect, vi } from 'vitest';
import { TelegramNotificationAdapter } from '#adapters/notification/TelegramNotificationAdapter.mjs';
import { PushNotificationAdapter } from '#adapters/notification/PushNotificationAdapter.mjs';

const intent = (metadata = {}) => ({
  title: 'Weekly retrospective',
  body: 'Your cycle retro ceremony is due.',
  category: 'ceremony',
  urgency: 'normal',
  metadata,
});

describe('TelegramNotificationAdapter', () => {
  it('resolves chat id from metadata.username and sends markdown', async () => {
    const sendMessage = vi.fn().mockResolvedValue({});
    const adapter = new TelegramNotificationAdapter({
      telegramAdapter: { sendMessage },
      resolveChatId: (username) => (username === 'test-user' ? '12345' : null),
    });

    const result = await adapter.send(intent({ username: 'test-user' }));

    expect(result.delivered).toBe(true);
    expect(sendMessage).toHaveBeenCalledWith(
      '12345',
      expect.stringContaining('Weekly retrospective'),
      { parseMode: 'Markdown' },
    );
  });

  it('supports a thunk telegramAdapter (late-bound at composition)', async () => {
    const sendMessage = vi.fn().mockResolvedValue({});
    const holder = { adapter: null };
    const notificationAdapter = new TelegramNotificationAdapter({
      telegramAdapter: () => holder.adapter,
      resolveChatId: () => '12345',
    });

    // Not yet bound → not delivered
    const before = await notificationAdapter.send(intent({ username: 'test-user' }));
    expect(before.delivered).toBe(false);

    // Bound later → delivered
    holder.adapter = { sendMessage };
    const after = await notificationAdapter.send(intent({ username: 'test-user' }));
    expect(after.delivered).toBe(true);
  });

  it('fails soft when no chat id resolves', async () => {
    const adapter = new TelegramNotificationAdapter({
      telegramAdapter: { sendMessage: vi.fn() },
      resolveChatId: () => null,
    });

    const result = await adapter.send(intent({ username: 'test-user' }));

    expect(result.delivered).toBe(false);
    expect(result.error).toContain('no telegram chat id');
  });

  it('fails soft when the telegram API throws', async () => {
    const adapter = new TelegramNotificationAdapter({
      telegramAdapter: { sendMessage: vi.fn().mockRejectedValue(new Error('api down')) },
      resolveChatId: () => '12345',
    });

    const result = await adapter.send(intent({ username: 'test-user' }));

    expect(result.delivered).toBe(false);
    expect(result.error).toBe('api down');
  });

  // The messaging TelegramAdapter.sendMessage has NO raw reply_markup option; it
  // derives params.reply_markup from `options.choices` (rows of buttons) and needs
  // `options.inline: true` for a button's `url` to survive buildKeyboard. These tests
  // assert against those real option keys so the button actually renders in production.
  it('renders intent.actions with url data as an inline keyboard', async () => {
    const sendMessage = vi.fn().mockResolvedValue({});
    const adapter = new TelegramNotificationAdapter({
      telegramAdapter: { sendMessage },
      resolveChatId: () => '12345',
      publicBaseUrl: 'https://example.test',
    });

    await adapter.send({
      title: 'Weekly retrospective',
      body: 'Your cycle retro is due.',
      category: 'ceremony',
      urgency: 'normal',
      metadata: { username: 'test-user' },
      actions: [{ label: 'Begin', action: 'open', data: { url: '/life/ceremony/unit_intention' } }],
    });

    const opts = sendMessage.mock.calls[0][2];
    expect(opts.inline).toBe(true);
    expect(opts.choices[0][0]).toEqual({
      text: 'Begin',
      url: 'https://example.test/life/ceremony/unit_intention',
    });
  });

  it('omits the keyboard when no publicBaseUrl is configured', async () => {
    const sendMessage = vi.fn().mockResolvedValue({});
    const adapter = new TelegramNotificationAdapter({
      telegramAdapter: { sendMessage },
      resolveChatId: () => '12345',
    });

    const result = await adapter.send({
      title: 't',
      body: 'b',
      category: 'ceremony',
      urgency: 'normal',
      metadata: { username: 'test-user' },
      actions: [{ label: 'Begin', data: { url: '/x' } }],
    });

    const opts = sendMessage.mock.calls[0][2];
    expect(opts.choices).toBeUndefined();
    expect(opts.inline).toBeUndefined();
    // still delivered as plain text
    expect(result.delivered).toBe(true);
  });

  it('skips actions that have no url', async () => {
    const sendMessage = vi.fn().mockResolvedValue({});
    const adapter = new TelegramNotificationAdapter({
      telegramAdapter: { sendMessage },
      resolveChatId: () => '12345',
      publicBaseUrl: 'https://example.test',
    });

    await adapter.send({
      title: 't',
      body: 'b',
      category: 'ceremony',
      urgency: 'normal',
      metadata: { username: 'test-user' },
      actions: [
        { label: 'No link', action: 'noop' },
        { label: 'Begin', data: { url: '/go' } },
      ],
    });

    const opts = sendMessage.mock.calls[0][2];
    expect(opts.choices[0]).toHaveLength(1);
    expect(opts.choices[0][0]).toEqual({ text: 'Begin', url: 'https://example.test/go' });
  });

  it('passes an already-absolute action url through unchanged', async () => {
    const sendMessage = vi.fn().mockResolvedValue({});
    const adapter = new TelegramNotificationAdapter({
      telegramAdapter: { sendMessage },
      resolveChatId: () => '12345',
      publicBaseUrl: 'https://example.test',
    });

    await adapter.send({
      title: 't',
      body: 'b',
      category: 'ceremony',
      urgency: 'normal',
      metadata: { username: 'test-user' },
      actions: [{ label: 'External', data: { url: 'https://other.test/path' } }],
    });

    const opts = sendMessage.mock.calls[0][2];
    expect(opts.choices[0][0]).toEqual({ text: 'External', url: 'https://other.test/path' });
  });
});

describe('PushNotificationAdapter (Home Assistant)', () => {
  it('calls HA notify service resolved from the username', async () => {
    const callService = vi.fn().mockResolvedValue({});
    const adapter = new PushNotificationAdapter({
      haGateway: { callService },
      resolveNotifyService: (username) => (username === 'test-user' ? 'mobile_app_test_phone' : null),
    });

    const result = await adapter.send(intent({ username: 'test-user' }));

    expect(result.delivered).toBe(true);
    expect(callService).toHaveBeenCalledWith('notify', 'mobile_app_test_phone', {
      title: 'Weekly retrospective',
      message: 'Your cycle retro ceremony is due.',
    });
  });

  it('fails soft without a gateway or notify service', async () => {
    const noGateway = new PushNotificationAdapter({});
    expect((await noGateway.send(intent({ username: 'test-user' }))).delivered).toBe(false);

    const noService = new PushNotificationAdapter({
      haGateway: { callService: vi.fn() },
      resolveNotifyService: () => null,
    });
    const result = await noService.send(intent({ username: 'test-user' }));
    expect(result.delivered).toBe(false);
    expect(result.error).toContain('no HA notify service');
  });
});
