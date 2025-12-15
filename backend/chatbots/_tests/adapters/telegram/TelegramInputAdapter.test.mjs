/**
 * Unit Tests for TelegramInputAdapter
 * @module _tests/adapters/telegram/TelegramInputAdapter.test
 */

import { TelegramInputAdapter, TELEGRAM_CHANNEL } from '../../../adapters/telegram/TelegramInputAdapter.mjs';
import { InputEventType } from '../../../application/ports/IInputEvent.mjs';

const BOT_CONFIG = { botId: '6898194425' };

describe('TelegramInputAdapter', () => {
  describe('parse - text messages', () => {
    it('should parse a simple text message', () => {
      const update = {
        update_id: 123456,
        message: {
          message_id: 100,
          from: { id: 575596036, first_name: 'Test', username: 'testuser' },
          chat: { id: 575596036, type: 'private' },
          date: 1702656000,
          text: 'Hello world',
        },
      };

      const event = TelegramInputAdapter.parse(update, BOT_CONFIG);

      expect(event).not.toBeNull();
      expect(event.type).toBe(InputEventType.TEXT);
      expect(event.userId).toBe('575596036');
      expect(event.conversationId).toBe('telegram:6898194425_575596036');
      expect(event.messageId).toBe('100');
      expect(event.channel).toBe(TELEGRAM_CHANNEL);
      expect(event.payload.text).toBe('Hello world');
    });

    it('should trim whitespace from text', () => {
      const update = {
        message: {
          message_id: 100,
          chat: { id: 575596036 },
          text: '  Hello world  ',
        },
      };

      const event = TelegramInputAdapter.parse(update, BOT_CONFIG);
      expect(event.payload.text).toBe('Hello world');
    });
  });

  describe('parse - slash commands', () => {
    it('should parse a simple command', () => {
      const update = {
        message: {
          message_id: 100,
          chat: { id: 575596036 },
          text: '/help',
        },
      };

      const event = TelegramInputAdapter.parse(update, BOT_CONFIG);

      expect(event.type).toBe(InputEventType.COMMAND);
      expect(event.payload.command).toBe('help');
      expect(event.payload.args).toBeUndefined();
      expect(event.payload.rawText).toBe('/help');
    });

    it('should parse a command with arguments', () => {
      const update = {
        message: {
          message_id: 100,
          chat: { id: 575596036 },
          text: '/report yesterday',
        },
      };

      const event = TelegramInputAdapter.parse(update, BOT_CONFIG);

      expect(event.type).toBe(InputEventType.COMMAND);
      expect(event.payload.command).toBe('report');
      expect(event.payload.args).toBe('yesterday');
    });

    it('should lowercase command names', () => {
      const update = {
        message: {
          message_id: 100,
          chat: { id: 575596036 },
          text: '/HELP',
        },
      };

      const event = TelegramInputAdapter.parse(update, BOT_CONFIG);
      expect(event.payload.command).toBe('help');
    });
  });

  describe('parse - UPC codes', () => {
    it('should detect a 12-digit UPC', () => {
      const update = {
        message: {
          message_id: 100,
          chat: { id: 575596036 },
          text: '012345678901',
        },
      };

      const event = TelegramInputAdapter.parse(update, BOT_CONFIG);

      expect(event.type).toBe(InputEventType.UPC);
      expect(event.payload.upc).toBe('012345678901');
    });

    it('should detect a UPC with dashes', () => {
      const update = {
        message: {
          message_id: 100,
          chat: { id: 575596036 },
          text: '0-12345-67890-1',
        },
      };

      const event = TelegramInputAdapter.parse(update, BOT_CONFIG);

      expect(event.type).toBe(InputEventType.UPC);
      expect(event.payload.upc).toBe('012345678901');
      expect(event.payload.rawText).toBe('0-12345-67890-1');
    });

    it('should detect an 8-digit EAN', () => {
      const update = {
        message: {
          message_id: 100,
          chat: { id: 575596036 },
          text: '12345678',
        },
      };

      const event = TelegramInputAdapter.parse(update, BOT_CONFIG);
      expect(event.type).toBe(InputEventType.UPC);
    });

    it('should detect a 13-digit EAN', () => {
      const update = {
        message: {
          message_id: 100,
          chat: { id: 575596036 },
          text: '1234567890123',
        },
      };

      const event = TelegramInputAdapter.parse(update, BOT_CONFIG);
      expect(event.type).toBe(InputEventType.UPC);
    });
  });

  describe('parse - photo messages', () => {
    it('should parse a photo message and get the largest size', () => {
      const update = {
        message: {
          message_id: 100,
          chat: { id: 575596036 },
          photo: [
            { file_id: 'small_id', width: 90, height: 90, file_unique_id: 'unique1' },
            { file_id: 'medium_id', width: 320, height: 320, file_unique_id: 'unique2' },
            { file_id: 'large_id', width: 800, height: 800, file_unique_id: 'unique3' },
          ],
        },
      };

      const event = TelegramInputAdapter.parse(update, BOT_CONFIG);

      expect(event.type).toBe(InputEventType.IMAGE);
      expect(event.payload.fileId).toBe('large_id'); // Should get largest
      expect(event.metadata.allSizes).toHaveLength(3);
    });

    it('should include caption if present', () => {
      const update = {
        message: {
          message_id: 100,
          chat: { id: 575596036 },
          photo: [{ file_id: 'photo_id', width: 100, height: 100 }],
          caption: 'My lunch',
        },
      };

      const event = TelegramInputAdapter.parse(update, BOT_CONFIG);
      expect(event.payload.caption).toBe('My lunch');
    });
  });

  describe('parse - voice messages', () => {
    it('should parse a voice message', () => {
      const update = {
        message: {
          message_id: 100,
          chat: { id: 575596036 },
          voice: {
            file_id: 'voice_file_id',
            file_unique_id: 'voice_unique',
            duration: 5,
            mime_type: 'audio/ogg',
            file_size: 12345,
          },
        },
      };

      const event = TelegramInputAdapter.parse(update, BOT_CONFIG);

      expect(event.type).toBe(InputEventType.VOICE);
      expect(event.payload.fileId).toBe('voice_file_id');
      expect(event.payload.duration).toBe(5);
      expect(event.metadata.mimeType).toBe('audio/ogg');
    });
  });

  describe('parse - document messages', () => {
    it('should parse a document message', () => {
      const update = {
        message: {
          message_id: 100,
          chat: { id: 575596036 },
          document: {
            file_id: 'doc_file_id',
            file_unique_id: 'doc_unique',
            file_name: 'report.pdf',
            mime_type: 'application/pdf',
            file_size: 102400,
          },
        },
      };

      const event = TelegramInputAdapter.parse(update, BOT_CONFIG);

      expect(event.type).toBe(InputEventType.DOCUMENT);
      expect(event.payload.fileId).toBe('doc_file_id');
      expect(event.payload.fileName).toBe('report.pdf');
      expect(event.payload.mimeType).toBe('application/pdf');
    });

    it('should treat image documents as images', () => {
      const update = {
        message: {
          message_id: 100,
          chat: { id: 575596036 },
          document: {
            file_id: 'img_doc_id',
            file_name: 'food.jpg',
            mime_type: 'image/jpeg',
          },
        },
      };

      const event = TelegramInputAdapter.parse(update, BOT_CONFIG);
      expect(event.type).toBe(InputEventType.IMAGE);
      expect(event.metadata.sentAsDocument).toBe(true);
    });
  });

  describe('parse - callback queries', () => {
    it('should parse a callback query', () => {
      const update = {
        callback_query: {
          id: 'callback_123',
          from: { id: 575596036, first_name: 'Test' },
          message: {
            message_id: 100,
            chat: { id: 575596036, type: 'private' },
          },
          data: 'accept:uuid-123',
          chat_instance: 'instance_123',
        },
      };

      const event = TelegramInputAdapter.parse(update, BOT_CONFIG);

      expect(event.type).toBe(InputEventType.CALLBACK);
      expect(event.userId).toBe('575596036');
      expect(event.payload.data).toBe('accept:uuid-123');
      expect(event.payload.sourceMessageId).toBe('100');
      expect(event.payload.callbackQueryId).toBe('callback_123');
    });

    it('should return null for callback without message', () => {
      const update = {
        callback_query: {
          id: 'callback_123',
          from: { id: 575596036 },
          // No message - inline mode
          data: 'test',
        },
      };

      const event = TelegramInputAdapter.parse(update, BOT_CONFIG);
      expect(event).toBeNull();
    });
  });

  describe('parse - edge cases', () => {
    it('should return null for empty update', () => {
      expect(TelegramInputAdapter.parse({}, BOT_CONFIG)).toBeNull();
      expect(TelegramInputAdapter.parse(null, BOT_CONFIG)).toBeNull();
    });

    it('should throw if botId is missing', () => {
      expect(() => TelegramInputAdapter.parse({ message: { text: 'hi', chat: { id: 123 } } }, {}))
        .toThrow('config.botId is required');
    });

    it('should handle edited messages', () => {
      const update = {
        edited_message: {
          message_id: 100,
          chat: { id: 575596036 },
          text: 'Edited text',
        },
      };

      const event = TelegramInputAdapter.parse(update, BOT_CONFIG);
      expect(event.type).toBe(InputEventType.TEXT);
      expect(event.payload.text).toBe('Edited text');
    });
  });

  describe('buildConversationId', () => {
    it('should build correct conversation ID', () => {
      const convId = TelegramInputAdapter.buildConversationId('123456', '789012');
      expect(convId).toBe('telegram:123456_789012');
    });
  });

  describe('parseConversationId', () => {
    it('should parse a valid conversation ID', () => {
      const result = TelegramInputAdapter.parseConversationId('telegram:123456_789012');
      expect(result).toEqual({ botId: '123456', userId: '789012' });
    });

    it('should return null for invalid format', () => {
      expect(TelegramInputAdapter.parseConversationId('invalid')).toBeNull();
      expect(TelegramInputAdapter.parseConversationId('telegram:nounderscorе')).toBeNull();
    });
  });

  describe('utility methods', () => {
    it('isUPCLike should detect UPC patterns', () => {
      expect(TelegramInputAdapter.isUPCLike('012345678901')).toBe(true);
      expect(TelegramInputAdapter.isUPCLike('0-12345-67890-1')).toBe(true);
      expect(TelegramInputAdapter.isUPCLike('12345678')).toBe(true);
      expect(TelegramInputAdapter.isUPCLike('hello')).toBe(false);
      expect(TelegramInputAdapter.isUPCLike('1234567')).toBe(false); // Too short
    });

    it('isCommand should detect commands', () => {
      expect(TelegramInputAdapter.isCommand('/help')).toBe(true);
      expect(TelegramInputAdapter.isCommand('/report today')).toBe(true);
      expect(TelegramInputAdapter.isCommand('hello')).toBe(false);
      expect(TelegramInputAdapter.isCommand('')).toBe(false);
    });

    it('extractFileId should get file ID from various message types', () => {
      expect(TelegramInputAdapter.extractFileId({
        photo: [{ file_id: 'photo1' }, { file_id: 'photo2' }],
      })).toBe('photo2');

      expect(TelegramInputAdapter.extractFileId({
        voice: { file_id: 'voice1' },
      })).toBe('voice1');

      expect(TelegramInputAdapter.extractFileId({
        document: { file_id: 'doc1' },
      })).toBe('doc1');

      expect(TelegramInputAdapter.extractFileId({
        text: 'hello',
      })).toBeNull();
    });
  });
});
