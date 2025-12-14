/**
 * Tests for ConversationId value object
 * @group Phase1
 */

import { ConversationId, ChatId } from '../../domain/value-objects/ChatId.mjs';
import { ValidationError } from '../../_lib/errors/index.mjs';

describe('Phase1: ConversationId', () => {
  describe('constructor', () => {
    it('should create ConversationId with valid channel and identifier', () => {
      const convId = new ConversationId('telegram', 'b123_c456');
      expect(convId.channel).toBe('telegram');
      expect(convId.identifier).toBe('b123_c456');
    });

    it('should normalize channel to lowercase', () => {
      const convId = new ConversationId('TELEGRAM', 'b123_c456');
      expect(convId.channel).toBe('telegram');
    });

    it('should throw ValidationError for missing channel', () => {
      expect(() => new ConversationId(null, 'id')).toThrow(ValidationError);
      expect(() => new ConversationId(undefined, 'id')).toThrow(ValidationError);
      expect(() => new ConversationId('', 'id')).toThrow(ValidationError);
    });

    it('should throw ValidationError for missing identifier', () => {
      expect(() => new ConversationId('telegram', null)).toThrow(ValidationError);
      expect(() => new ConversationId('telegram', undefined)).toThrow(ValidationError);
      expect(() => new ConversationId('telegram', '')).toThrow(ValidationError);
    });

    it('should throw ValidationError for non-string values', () => {
      expect(() => new ConversationId(123, 'id')).toThrow(ValidationError);
      expect(() => new ConversationId('telegram', 456)).toThrow(ValidationError);
    });

    it('should be immutable', () => {
      const convId = new ConversationId('telegram', 'b123_c456');
      expect(Object.isFrozen(convId)).toBe(true);
    });
  });

  describe('toString', () => {
    it('should format as {channel}:{identifier}', () => {
      const convId = new ConversationId('telegram', 'b123_c456');
      expect(convId.toString()).toBe('telegram:b123_c456');
    });
  });

  describe('toJSON', () => {
    it('should serialize to object', () => {
      const convId = new ConversationId('telegram', 'b123_c456');
      expect(convId.toJSON()).toEqual({
        channel: 'telegram',
        identifier: 'b123_c456',
      });
    });
  });

  describe('equals', () => {
    it('should return true for equal ConversationIds', () => {
      const id1 = new ConversationId('telegram', 'b123_c456');
      const id2 = new ConversationId('telegram', 'b123_c456');
      expect(id1.equals(id2)).toBe(true);
    });

    it('should return false for different channel', () => {
      const id1 = new ConversationId('telegram', 'b123_c456');
      const id2 = new ConversationId('discord', 'b123_c456');
      expect(id1.equals(id2)).toBe(false);
    });

    it('should return false for different identifier', () => {
      const id1 = new ConversationId('telegram', 'b123_c456');
      const id2 = new ConversationId('telegram', 'b789_c012');
      expect(id1.equals(id2)).toBe(false);
    });

    it('should return false for non-ConversationId', () => {
      const convId = new ConversationId('telegram', 'b123_c456');
      expect(convId.equals({ channel: 'telegram', identifier: 'b123_c456' })).toBe(false);
      expect(convId.equals('telegram:b123_c456')).toBe(false);
    });
  });

  describe('parse', () => {
    it('should parse valid string', () => {
      const convId = ConversationId.parse('telegram:b123_c456');
      expect(convId.channel).toBe('telegram');
      expect(convId.identifier).toBe('b123_c456');
    });

    it('should handle identifiers with colons', () => {
      // Identifier can contain colons (only first colon is separator)
      const convId = ConversationId.parse('discord:guild:123:channel:456');
      expect(convId.channel).toBe('discord');
      expect(convId.identifier).toBe('guild:123:channel:456');
    });

    it('should throw for invalid format', () => {
      expect(() => ConversationId.parse('invalid')).toThrow(ValidationError);
      expect(() => ConversationId.parse(':missing_channel')).toThrow(ValidationError);
      expect(() => ConversationId.parse('missing_identifier:')).toThrow(ValidationError);
      expect(() => ConversationId.parse('')).toThrow(ValidationError);
      expect(() => ConversationId.parse(null)).toThrow(ValidationError);
    });
  });

  describe('from', () => {
    it('should return same ConversationId instance', () => {
      const original = new ConversationId('telegram', 'b123_c456');
      const result = ConversationId.from(original);
      expect(result).toBe(original);
    });

    it('should parse string', () => {
      const convId = ConversationId.from('telegram:b123_c456');
      expect(convId.channel).toBe('telegram');
    });

    it('should create from object', () => {
      const convId = ConversationId.from({ channel: 'telegram', identifier: 'b123_c456' });
      expect(convId.channel).toBe('telegram');
      expect(convId.identifier).toBe('b123_c456');
    });
  });

  describe('forChannel', () => {
    it('should create factory function', () => {
      const telegramId = ConversationId.forChannel('telegram');
      
      const convId = telegramId('b123_c456');
      expect(convId.channel).toBe('telegram');
      expect(convId.identifier).toBe('b123_c456');
    });

    it('should create multiple IDs with same channel', () => {
      const discordId = ConversationId.forChannel('discord');
      
      const id1 = discordId('guild1_channel1');
      const id2 = discordId('guild2_channel2');
      
      expect(id1.channel).toBe('discord');
      expect(id2.channel).toBe('discord');
      expect(id1.identifier).not.toBe(id2.identifier);
    });
  });

  describe('ChatId alias', () => {
    it('should be an alias for ConversationId', () => {
      expect(ChatId).toBe(ConversationId);
    });

    it('should work interchangeably', () => {
      const fromChatId = new ChatId('telegram', 'test');
      const fromConvId = new ConversationId('telegram', 'test');
      expect(fromChatId.equals(fromConvId)).toBe(true);
    });
  });
});

describe('Phase1: ConversationId use cases', () => {
  describe('multi-channel support', () => {
    it('should distinguish same user across channels', () => {
      const telegramConv = new ConversationId('telegram', 'user123');
      const discordConv = new ConversationId('discord', 'user123');
      
      expect(telegramConv.equals(discordConv)).toBe(false);
      expect(telegramConv.toString()).not.toBe(discordConv.toString());
    });
  });

  describe('storage key generation', () => {
    it('toString provides stable storage keys', () => {
      const convId = new ConversationId('telegram', 'b123_c456');
      
      // Same input always produces same key
      const key1 = convId.toString();
      const key2 = new ConversationId('telegram', 'b123_c456').toString();
      
      expect(key1).toBe(key2);
      expect(key1).toBe('telegram:b123_c456');
    });
  });
});
