// tests/unit/adapters/messaging/TelegramAdapter.test.mjs
import { jest } from '@jest/globals';
import { TelegramAdapter } from '@backend/src/2_adapters/messaging/TelegramAdapter.mjs';

describe('TelegramAdapter', () => {
  let adapter;
  let mockHttpClient;
  let mockLogger;

  beforeEach(() => {
    mockHttpClient = {
      get: jest.fn(),
      post: jest.fn()
    };

    mockLogger = {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn()
    };

    adapter = new TelegramAdapter({
      token: 'test-token-123',
      httpClient: mockHttpClient,
      logger: mockLogger
    });
  });

  describe('constructor', () => {
    test('throws if token not provided', () => {
      expect(() => new TelegramAdapter({})).toThrow('Telegram bot token is required');
    });

    test('initializes with token', () => {
      expect(adapter.isConfigured()).toBe(true);
    });
  });

  describe('callApi', () => {
    test('makes POST request by default', async () => {
      mockHttpClient.post.mockResolvedValue({
        data: { ok: true, result: { message_id: 123 } }
      });

      const result = await adapter.callApi('sendMessage', { chat_id: '123', text: 'Hi' });

      expect(mockHttpClient.post).toHaveBeenCalledWith(
        expect.stringContaining('sendMessage'),
        { chat_id: '123', text: 'Hi' }
      );
      expect(result.message_id).toBe(123);
    });

    test('makes GET request when specified', async () => {
      mockHttpClient.get.mockResolvedValue({
        data: { ok: true, result: { id: 123, username: 'testbot' } }
      });

      const result = await adapter.callApi('getMe', {}, 'GET');

      expect(mockHttpClient.get).toHaveBeenCalled();
      expect(result.id).toBe(123);
    });

    test('throws on API error', async () => {
      mockHttpClient.post.mockResolvedValue({
        data: { ok: false, description: 'Bad Request' }
      });

      const errorsBefore = adapter.metrics.errors;
      await expect(adapter.callApi('sendMessage', {})).rejects.toThrow('Bad Request');
      expect(adapter.metrics.errors).toBe(errorsBefore + 1);
    });
  });

  describe('sendMessage', () => {
    test('sends text message', async () => {
      mockHttpClient.post.mockResolvedValue({
        data: { ok: true, result: { message_id: 456 } }
      });

      const result = await adapter.sendMessage('chat-123', 'Hello world');

      expect(result.ok).toBe(true);
      expect(result.messageId).toBe('456');
      expect(adapter.metrics.messagesSent).toBe(1);
    });

    test('sends message with parse mode', async () => {
      mockHttpClient.post.mockResolvedValue({
        data: { ok: true, result: { message_id: 456 } }
      });

      await adapter.sendMessage('chat-123', '*Bold*', { parseMode: 'Markdown' });

      expect(mockHttpClient.post).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ parse_mode: 'Markdown' })
      );
    });

    test('sends message with inline keyboard', async () => {
      mockHttpClient.post.mockResolvedValue({
        data: { ok: true, result: { message_id: 456 } }
      });

      await adapter.sendMessage('chat-123', 'Choose:', {
        choices: [['Option A', 'Option B']],
        inline: true
      });

      expect(mockHttpClient.post).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          reply_markup: expect.stringContaining('inline_keyboard')
        })
      );
    });

    test('sends message with reply keyboard', async () => {
      mockHttpClient.post.mockResolvedValue({
        data: { ok: true, result: { message_id: 456 } }
      });

      await adapter.sendMessage('chat-123', 'Choose:', {
        choices: [['Yes', 'No']]
      });

      expect(mockHttpClient.post).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          reply_markup: expect.stringContaining('keyboard')
        })
      );
    });

    test('removes keyboard when requested', async () => {
      mockHttpClient.post.mockResolvedValue({
        data: { ok: true, result: { message_id: 456 } }
      });

      await adapter.sendMessage('chat-123', 'Done', { removeKeyboard: true });

      expect(mockHttpClient.post).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          reply_markup: expect.stringContaining('remove_keyboard')
        })
      );
    });
  });

  describe('sendImage', () => {
    test('sends image with URL', async () => {
      mockHttpClient.post.mockResolvedValue({
        data: { ok: true, result: { message_id: 789 } }
      });

      const result = await adapter.sendImage(
        'chat-123',
        'https://example.com/image.jpg',
        'Nice photo'
      );

      expect(result.ok).toBe(true);
      expect(mockHttpClient.post).toHaveBeenCalledWith(
        expect.stringContaining('sendPhoto'),
        expect.objectContaining({
          photo: 'https://example.com/image.jpg',
          caption: 'Nice photo'
        })
      );
    });
  });

  describe('updateMessage', () => {
    test('edits message text', async () => {
      mockHttpClient.post.mockResolvedValue({
        data: { ok: true, result: {} }
      });

      await adapter.updateMessage('chat-123', '456', { text: 'Updated text' });

      expect(mockHttpClient.post).toHaveBeenCalledWith(
        expect.stringContaining('editMessageText'),
        expect.objectContaining({
          chat_id: 'chat-123',
          message_id: '456',
          text: 'Updated text'
        })
      );
    });

    test('edits message caption', async () => {
      mockHttpClient.post.mockResolvedValue({
        data: { ok: true, result: {} }
      });

      await adapter.updateMessage('chat-123', '456', { caption: 'New caption' });

      expect(mockHttpClient.post).toHaveBeenCalledWith(
        expect.stringContaining('editMessageCaption'),
        expect.objectContaining({ caption: 'New caption' })
      );
    });
  });

  describe('deleteMessage', () => {
    test('deletes message', async () => {
      mockHttpClient.post.mockResolvedValue({
        data: { ok: true, result: true }
      });

      await adapter.deleteMessage('chat-123', '456');

      expect(mockHttpClient.post).toHaveBeenCalledWith(
        expect.stringContaining('deleteMessage'),
        { chat_id: 'chat-123', message_id: '456' }
      );
    });
  });

  describe('getFileUrl', () => {
    test('returns file download URL', async () => {
      mockHttpClient.post.mockResolvedValue({
        data: { ok: true, result: { file_path: 'voice/file_123.ogg' } }
      });

      const url = await adapter.getFileUrl('file-id-123');

      expect(url).toContain('file/bot');
      expect(url).toContain('voice/file_123.ogg');
    });
  });

  describe('send (INotificationChannel)', () => {
    test('sends notification as Telegram message', async () => {
      mockHttpClient.post.mockResolvedValue({
        data: { ok: true, result: { message_id: 123 } }
      });

      await adapter.send({
        id: 'notif-1',
        recipient: 'chat-123',
        title: 'Alert',
        body: 'Something happened'
      });

      expect(mockHttpClient.post).toHaveBeenCalledWith(
        expect.stringContaining('sendMessage'),
        expect.objectContaining({
          text: expect.stringContaining('*Alert*'),
          parse_mode: 'Markdown'
        })
      );
    });
  });

  describe('getBotInfo', () => {
    test('returns and caches bot info', async () => {
      mockHttpClient.get.mockResolvedValue({
        data: { ok: true, result: { id: 123, username: 'testbot' } }
      });

      const info1 = await adapter.getBotInfo();
      const info2 = await adapter.getBotInfo();

      expect(info1.username).toBe('testbot');
      expect(mockHttpClient.get).toHaveBeenCalledTimes(1); // Cached
    });
  });

  describe('setWebhook', () => {
    test('sets webhook URL', async () => {
      mockHttpClient.post.mockResolvedValue({
        data: { ok: true, result: true }
      });

      await adapter.setWebhook('https://example.com/webhook');

      expect(mockHttpClient.post).toHaveBeenCalledWith(
        expect.stringContaining('setWebhook'),
        expect.objectContaining({ url: 'https://example.com/webhook' })
      );
    });

    test('sets webhook with options', async () => {
      mockHttpClient.post.mockResolvedValue({
        data: { ok: true, result: true }
      });

      await adapter.setWebhook('https://example.com/webhook', {
        secretToken: 'secret123',
        allowedUpdates: ['message', 'callback_query']
      });

      expect(mockHttpClient.post).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          secret_token: 'secret123',
          allowed_updates: ['message', 'callback_query']
        })
      );
    });
  });

  describe('parseUpdate', () => {
    test('parses text message update', () => {
      const update = {
        message: {
          message_id: 123,
          chat: { id: 456 },
          from: { id: 789 },
          text: 'Hello'
        }
      };

      const parsed = adapter.parseUpdate(update);

      expect(parsed.type).toBe('text');
      expect(parsed.chatId).toBe('456');
      expect(parsed.messageId).toBe('123');
      expect(parsed.senderId).toBe('789');
      expect(parsed.content).toBe('Hello');
    });

    test('parses voice message update', () => {
      const update = {
        message: {
          message_id: 123,
          chat: { id: 456 },
          from: { id: 789 },
          voice: { file_id: 'voice-file' }
        }
      };

      const parsed = adapter.parseUpdate(update);

      expect(parsed.type).toBe('voice');
    });

    test('parses callback query update', () => {
      const update = {
        callback_query: {
          id: 'cb-123',
          from: { id: 789 },
          message: { message_id: 123, chat: { id: 456 } },
          data: 'button_clicked'
        }
      };

      const parsed = adapter.parseUpdate(update);

      expect(parsed.type).toBe('callback');
      expect(parsed.content).toBe('button_clicked');
    });

    test('returns null for unknown update type', () => {
      const update = { edited_message: {} };
      expect(adapter.parseUpdate(update)).toBeNull();
    });
  });

  describe('buildKeyboard', () => {
    test('builds reply keyboard from strings', () => {
      const keyboard = adapter.buildKeyboard([['Yes', 'No']], false);

      expect(keyboard.keyboard).toBeDefined();
      expect(keyboard.keyboard[0][0].text).toBe('Yes');
      expect(keyboard.resize_keyboard).toBe(true);
    });

    test('builds inline keyboard from strings', () => {
      const keyboard = adapter.buildKeyboard([['Option A', 'Option B']], true);

      expect(keyboard.inline_keyboard).toBeDefined();
      expect(keyboard.inline_keyboard[0][0].text).toBe('Option A');
      expect(keyboard.inline_keyboard[0][0].callback_data).toBe('Option A');
    });

    test('preserves button objects', () => {
      const keyboard = adapter.buildKeyboard(
        [[{ text: 'Link', url: 'https://example.com' }]],
        true
      );

      expect(keyboard.inline_keyboard[0][0].url).toBe('https://example.com');
    });
  });

  describe('getMetrics', () => {
    test('returns metrics data', async () => {
      mockHttpClient.post.mockResolvedValue({
        data: { ok: true, result: { message_id: 1 } }
      });

      await adapter.sendMessage('chat-1', 'test');

      const metrics = adapter.getMetrics();

      expect(metrics.uptime.ms).toBeGreaterThanOrEqual(0);
      expect(metrics.totals.messagesSent).toBe(1);
    });
  });
});
