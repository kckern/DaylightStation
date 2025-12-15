/**
 * Unit Tests for IdConverter
 * @module _tests/_lib/ids/IdConverter.test
 */

import { IdConverter, Channel } from '../../../_lib/ids/IdConverter.mjs';

describe('IdConverter', () => {
  describe('detectFormat', () => {
    it('should detect legacy format', () => {
      expect(IdConverter.detectFormat('b6898194425_u575596036')).toBe('legacy');
    });

    it('should detect telegram format', () => {
      expect(IdConverter.detectFormat('telegram:6898194425_575596036')).toBe('telegram');
    });

    it('should detect CLI format', () => {
      expect(IdConverter.detectFormat('cli:test-session')).toBe('cli');
    });

    it('should detect generic format', () => {
      expect(IdConverter.detectFormat('discord:server_channel')).toBe('generic');
    });

    it('should detect plain numeric format', () => {
      expect(IdConverter.detectFormat('575596036')).toBe('plain');
    });

    it('should return unknown for invalid formats', () => {
      expect(IdConverter.detectFormat(null)).toBe('unknown');
      expect(IdConverter.detectFormat('')).toBe('unknown');
      expect(IdConverter.detectFormat(123)).toBe('unknown');
      expect(IdConverter.detectFormat('invalid-format')).toBe('unknown');
    });
  });

  describe('isLegacyFormat', () => {
    it('should return true for legacy format', () => {
      expect(IdConverter.isLegacyFormat('b6898194425_u575596036')).toBe(true);
    });

    it('should return false for other formats', () => {
      expect(IdConverter.isLegacyFormat('telegram:6898194425_575596036')).toBe(false);
      expect(IdConverter.isLegacyFormat('575596036')).toBe(false);
    });
  });

  describe('isCanonicalFormat', () => {
    it('should return true for canonical formats', () => {
      expect(IdConverter.isCanonicalFormat('telegram:6898194425_575596036')).toBe(true);
      expect(IdConverter.isCanonicalFormat('cli:test')).toBe(true);
    });

    it('should return false for legacy format', () => {
      expect(IdConverter.isCanonicalFormat('b6898194425_u575596036')).toBe(false);
    });
  });

  describe('legacyToConversationId', () => {
    it('should convert legacy to new format', () => {
      const result = IdConverter.legacyToConversationId('b6898194425_u575596036');
      expect(result).toBe('telegram:6898194425_575596036');
    });

    it('should throw for invalid legacy format', () => {
      expect(() => IdConverter.legacyToConversationId('invalid'))
        .toThrow('Invalid legacy chat_id format');
      expect(() => IdConverter.legacyToConversationId('b123_456'))
        .toThrow('Invalid legacy chat_id format');
    });
  });

  describe('conversationIdToLegacy', () => {
    it('should convert new format to legacy', () => {
      const result = IdConverter.conversationIdToLegacy('telegram:6898194425_575596036');
      expect(result).toBe('b6898194425_u575596036');
    });

    it('should throw for invalid telegram format', () => {
      expect(() => IdConverter.conversationIdToLegacy('cli:test'))
        .toThrow('Invalid telegram conversationId format');
      expect(() => IdConverter.conversationIdToLegacy('invalid'))
        .toThrow('Invalid telegram conversationId format');
    });
  });

  describe('normalize', () => {
    it('should convert legacy to canonical', () => {
      const result = IdConverter.normalize('b6898194425_u575596036');
      expect(result).toBe('telegram:6898194425_575596036');
    });

    it('should return canonical as-is', () => {
      const id = 'telegram:6898194425_575596036';
      expect(IdConverter.normalize(id)).toBe(id);

      const cliId = 'cli:test';
      expect(IdConverter.normalize(cliId)).toBe(cliId);
    });

    it('should convert plain userId with defaultBotId', () => {
      const result = IdConverter.normalize('575596036', '6898194425');
      expect(result).toBe('telegram:6898194425_575596036');
    });

    it('should throw for plain userId without defaultBotId', () => {
      expect(() => IdConverter.normalize('575596036'))
        .toThrow('requires defaultBotId');
    });

    it('should throw for unknown format', () => {
      expect(() => IdConverter.normalize('invalid-format'))
        .toThrow('Unknown ID format');
    });
  });

  describe('getUserId', () => {
    it('should extract from telegram format', () => {
      expect(IdConverter.getUserId('telegram:6898194425_575596036')).toBe('575596036');
    });

    it('should extract from legacy format', () => {
      expect(IdConverter.getUserId('b6898194425_u575596036')).toBe('575596036');
    });

    it('should extract from CLI format', () => {
      expect(IdConverter.getUserId('cli:test-session')).toBe('test-session');
    });

    it('should return plain userId as-is', () => {
      expect(IdConverter.getUserId('575596036')).toBe('575596036');
    });

    it('should throw for invalid input', () => {
      expect(() => IdConverter.getUserId(null)).toThrow();
      expect(() => IdConverter.getUserId('')).toThrow();
    });
  });

  describe('getBotId', () => {
    it('should extract from telegram format', () => {
      expect(IdConverter.getBotId('telegram:6898194425_575596036')).toBe('6898194425');
    });

    it('should extract from legacy format', () => {
      expect(IdConverter.getBotId('b6898194425_u575596036')).toBe('6898194425');
    });

    it('should return null for formats without botId', () => {
      expect(IdConverter.getBotId('cli:test')).toBeNull();
      expect(IdConverter.getBotId('575596036')).toBeNull();
      expect(IdConverter.getBotId(null)).toBeNull();
    });
  });

  describe('getChannel', () => {
    it('should return telegram for telegram format', () => {
      expect(IdConverter.getChannel('telegram:6898194425_575596036')).toBe(Channel.TELEGRAM);
    });

    it('should return telegram for legacy format', () => {
      expect(IdConverter.getChannel('b6898194425_u575596036')).toBe(Channel.TELEGRAM);
    });

    it('should return cli for CLI format', () => {
      expect(IdConverter.getChannel('cli:test')).toBe(Channel.CLI);
    });

    it('should return telegram for plain numeric', () => {
      expect(IdConverter.getChannel('575596036')).toBe(Channel.TELEGRAM);
    });

    it('should return unknown for invalid formats', () => {
      expect(IdConverter.getChannel(null)).toBe('unknown');
    });
  });

  describe('buildConversationId', () => {
    it('should build a conversation ID', () => {
      expect(IdConverter.buildConversationId('telegram', '123_456'))
        .toBe('telegram:123_456');
    });

    it('should throw for missing params', () => {
      expect(() => IdConverter.buildConversationId()).toThrow();
      expect(() => IdConverter.buildConversationId('telegram')).toThrow();
    });
  });

  describe('buildTelegramConversationId', () => {
    it('should build a telegram conversation ID', () => {
      expect(IdConverter.buildTelegramConversationId('6898194425', '575596036'))
        .toBe('telegram:6898194425_575596036');
    });

    it('should throw for missing params', () => {
      expect(() => IdConverter.buildTelegramConversationId()).toThrow();
      expect(() => IdConverter.buildTelegramConversationId('123')).toThrow();
    });
  });

  describe('buildCLIConversationId', () => {
    it('should build a CLI conversation ID', () => {
      expect(IdConverter.buildCLIConversationId('test-session'))
        .toBe('cli:test-session');
    });

    it('should throw for missing identifier', () => {
      expect(() => IdConverter.buildCLIConversationId()).toThrow();
    });
  });

  describe('buildLegacyChatId', () => {
    it('should build a legacy chat ID', () => {
      expect(IdConverter.buildLegacyChatId('6898194425', '575596036'))
        .toBe('b6898194425_u575596036');
    });
  });

  describe('isSameConversation', () => {
    it('should return true for same conversation in different formats', () => {
      expect(IdConverter.isSameConversation(
        'b6898194425_u575596036',
        'telegram:6898194425_575596036'
      )).toBe(true);
    });

    it('should return true for same plain userId', () => {
      expect(IdConverter.isSameConversation('575596036', '575596036')).toBe(true);
    });

    it('should return false for different userIds', () => {
      expect(IdConverter.isSameConversation(
        'telegram:6898194425_575596036',
        'telegram:6898194425_999999999'
      )).toBe(false);
    });

    it('should return false for different botIds', () => {
      expect(IdConverter.isSameConversation(
        'telegram:1111111111_575596036',
        'telegram:2222222222_575596036'
      )).toBe(false);
    });

    it('should return false for invalid IDs', () => {
      expect(IdConverter.isSameConversation('invalid1', 'invalid2')).toBe(false);
    });
  });

  describe('Channel enum', () => {
    it('should have expected channels', () => {
      expect(Channel.TELEGRAM).toBe('telegram');
      expect(Channel.CLI).toBe('cli');
      expect(Channel.DISCORD).toBe('discord');
      expect(Channel.SLACK).toBe('slack');
    });

    it('should be frozen', () => {
      expect(Object.isFrozen(Channel)).toBe(true);
    });
  });
});
