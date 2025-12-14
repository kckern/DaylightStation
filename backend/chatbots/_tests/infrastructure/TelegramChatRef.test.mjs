/**
 * Tests for TelegramChatRef - Telegram transport layer chat reference
 * @group Phase2
 */

import { TelegramChatRef, TELEGRAM_CHANNEL } from '../../infrastructure/telegram/TelegramChatRef.mjs';
import { ConversationId } from '../../domain/value-objects/ChatId.mjs';
import { ValidationError } from '../../_lib/errors/index.mjs';

describe('Phase2: TelegramChatRef', () => {
  describe('constructor', () => {
    it('should create TelegramChatRef with botId and chatId', () => {
      const ref = new TelegramChatRef('123456789', '987654321');
      expect(ref.botId).toBe('123456789');
      expect(ref.chatId).toBe('987654321');
    });

    it('should convert numeric chatId to string', () => {
      const ref = new TelegramChatRef('123456789', 987654321);
      expect(ref.chatId).toBe('987654321');
    });

    it('should throw ValidationError for missing botId', () => {
      expect(() => new TelegramChatRef(null, '123')).toThrow(ValidationError);
      expect(() => new TelegramChatRef('', '123')).toThrow(ValidationError);
    });

    it('should throw ValidationError for missing chatId', () => {
      expect(() => new TelegramChatRef('123', null)).toThrow(ValidationError);
      expect(() => new TelegramChatRef('123', undefined)).toThrow(ValidationError);
    });

    it('should be immutable', () => {
      const ref = new TelegramChatRef('123', '456');
      expect(Object.isFrozen(ref)).toBe(true);
    });
  });

  describe('chatIdNumeric', () => {
    it('should return numeric chat ID', () => {
      const ref = new TelegramChatRef('123', '987654321');
      expect(ref.chatIdNumeric).toBe(987654321);
    });

    it('should handle negative chat IDs (groups)', () => {
      const ref = new TelegramChatRef('123', '-100123456789');
      expect(ref.chatIdNumeric).toBe(-100123456789);
    });
  });

  describe('toConversationId', () => {
    it('should create ConversationId with telegram channel', () => {
      const ref = new TelegramChatRef('123456789', '987654321');
      const convId = ref.toConversationId();
      
      expect(convId).toBeInstanceOf(ConversationId);
      expect(convId.channel).toBe('telegram');
    });

    it('should encode botId and chatId in identifier', () => {
      const ref = new TelegramChatRef('123456789', '987654321');
      const convId = ref.toConversationId();
      
      expect(convId.identifier).toBe('b123456789_c987654321');
    });

    it('should produce same ConversationId for same Telegram chat', () => {
      const ref1 = new TelegramChatRef('bot1', 'chat1');
      const ref2 = new TelegramChatRef('bot1', 'chat1');
      
      expect(ref1.toConversationId().equals(ref2.toConversationId())).toBe(true);
    });

    it('should produce different ConversationId for different bots', () => {
      const ref1 = new TelegramChatRef('bot1', 'chat1');
      const ref2 = new TelegramChatRef('bot2', 'chat1');
      
      expect(ref1.toConversationId().equals(ref2.toConversationId())).toBe(false);
    });
  });

  describe('toLegacyPath', () => {
    it('should produce legacy format b{botId}_u{chatId}', () => {
      const ref = new TelegramChatRef('123456789', '987654321');
      expect(ref.toLegacyPath()).toBe('b123456789_u987654321');
    });
  });

  describe('equals', () => {
    it('should return true for equal refs', () => {
      const ref1 = new TelegramChatRef('bot', 'chat');
      const ref2 = new TelegramChatRef('bot', 'chat');
      expect(ref1.equals(ref2)).toBe(true);
    });

    it('should return false for different refs', () => {
      const ref1 = new TelegramChatRef('bot1', 'chat');
      const ref2 = new TelegramChatRef('bot2', 'chat');
      expect(ref1.equals(ref2)).toBe(false);
    });

    it('should return false for non-TelegramChatRef', () => {
      const ref = new TelegramChatRef('bot', 'chat');
      expect(ref.equals({ botId: 'bot', chatId: 'chat' })).toBe(false);
    });
  });

  describe('toJSON', () => {
    it('should serialize to object', () => {
      const ref = new TelegramChatRef('123', '456');
      expect(ref.toJSON()).toEqual({
        botId: '123',
        chatId: '456',
        channel: 'telegram',
      });
    });
  });

  describe('fromConversationId', () => {
    it('should reconstruct TelegramChatRef from ConversationId', () => {
      const original = new TelegramChatRef('123456789', '987654321');
      const convId = original.toConversationId();
      const restored = TelegramChatRef.fromConversationId(convId);
      
      expect(restored.botId).toBe('123456789');
      expect(restored.chatId).toBe('987654321');
      expect(original.equals(restored)).toBe(true);
    });

    it('should throw for non-telegram ConversationId', () => {
      const discordConv = new ConversationId('discord', 'guild123_channel456');
      
      expect(() => TelegramChatRef.fromConversationId(discordConv))
        .toThrow(ValidationError);
    });

    it('should throw for invalid identifier format', () => {
      const invalidConv = new ConversationId('telegram', 'invalid_format');
      
      expect(() => TelegramChatRef.fromConversationId(invalidConv))
        .toThrow(ValidationError);
    });
  });

  describe('fromLegacyPath', () => {
    it('should parse legacy format', () => {
      const ref = TelegramChatRef.fromLegacyPath('b123456789_u987654321');
      expect(ref.botId).toBe('123456789');
      expect(ref.chatId).toBe('987654321');
    });

    it('should throw for invalid format', () => {
      expect(() => TelegramChatRef.fromLegacyPath('invalid')).toThrow(ValidationError);
      expect(() => TelegramChatRef.fromLegacyPath('b123_c456')).toThrow(ValidationError);
    });
  });

  describe('fromTelegramUpdate', () => {
    it('should extract from message update', () => {
      const update = {
        message: {
          chat: { id: 987654321 },
          text: 'Hello',
        },
      };
      
      const ref = TelegramChatRef.fromTelegramUpdate('123456789', update);
      expect(ref.botId).toBe('123456789');
      expect(ref.chatId).toBe('987654321');
    });

    it('should extract from callback_query update', () => {
      const update = {
        callback_query: {
          message: {
            chat: { id: 987654321 },
          },
          data: 'button_click',
        },
      };
      
      const ref = TelegramChatRef.fromTelegramUpdate('123456789', update);
      expect(ref.chatId).toBe('987654321');
    });

    it('should extract from edited_message update', () => {
      const update = {
        edited_message: {
          chat: { id: 987654321 },
        },
      };
      
      const ref = TelegramChatRef.fromTelegramUpdate('123456789', update);
      expect(ref.chatId).toBe('987654321');
    });

    it('should throw if chat ID cannot be extracted', () => {
      const update = { unknown_update_type: {} };
      
      expect(() => TelegramChatRef.fromTelegramUpdate('123', update))
        .toThrow(ValidationError);
    });
  });

  describe('extractBotIdFromToken', () => {
    it('should extract bot ID from token', () => {
      const token = '123456789:ABCdefGHIjklMNOpqrsTUVwxyz';
      expect(TelegramChatRef.extractBotIdFromToken(token)).toBe('123456789');
    });

    it('should throw for invalid token format', () => {
      expect(() => TelegramChatRef.extractBotIdFromToken('invalid'))
        .toThrow(ValidationError);
    });
  });
});

describe('Phase2: TELEGRAM_CHANNEL constant', () => {
  it('should be "telegram"', () => {
    expect(TELEGRAM_CHANNEL).toBe('telegram');
  });
});

describe('Phase2: Round-trip conversions', () => {
  it('TelegramChatRef -> ConversationId -> TelegramChatRef', () => {
    const original = new TelegramChatRef('bot123', 'chat456');
    const convId = original.toConversationId();
    const restored = TelegramChatRef.fromConversationId(convId);
    
    expect(original.equals(restored)).toBe(true);
  });

  it('ConversationId string -> parse -> TelegramChatRef', () => {
    const convId = ConversationId.parse('telegram:b123_c456');
    const ref = TelegramChatRef.fromConversationId(convId);
    
    expect(ref.botId).toBe('123');
    expect(ref.chatId).toBe('456');
  });

  it('supports complex chat IDs', () => {
    // Supergroups have negative IDs with -100 prefix
    const ref = new TelegramChatRef('123', '-1001234567890');
    const convId = ref.toConversationId();
    const restored = TelegramChatRef.fromConversationId(convId);
    
    expect(restored.chatId).toBe('-1001234567890');
    expect(restored.chatIdNumeric).toBe(-1001234567890);
  });
});
