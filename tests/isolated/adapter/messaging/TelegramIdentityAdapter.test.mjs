import { describe, it, expect } from '@jest/globals';
import { TelegramIdentityAdapter } from '#adapters/messaging/TelegramIdentityAdapter.mjs';
import { UserIdentityService } from '#domains/messaging/services/UserIdentityService.mjs';

const mappings = {
  telegram: {
    '575596036': 'kckern',
    '123456789': 'kirk',
  },
};

const botConfigs = {
  nutribot: { botId: '6898194425' },
  journalist: { botId: '7777777777' },
};

const identityService = new UserIdentityService(mappings);

describe('TelegramIdentityAdapter', () => {
  describe('resolve by platformUserId', () => {
    it('produces valid ResolvedIdentity with canonical conversationId', () => {
      const adapter = new TelegramIdentityAdapter({ userIdentityService: identityService, botConfigs });

      const result = adapter.resolve('nutribot', { platformUserId: '575596036' });

      expect(result.username).toBe('kckern');
      expect(result.conversationIdString).toBe('telegram:b6898194425_c575596036');
    });

    it('returns null username for unknown platformUserId', () => {
      const adapter = new TelegramIdentityAdapter({ userIdentityService: identityService, botConfigs });

      const result = adapter.resolve('nutribot', { platformUserId: '999999999' });

      expect(result.username).toBeNull();
      expect(result.conversationIdString).toBe('telegram:b6898194425_c999999999');
    });
  });

  describe('resolve by username', () => {
    it('produces valid ResolvedIdentity from system username', () => {
      const adapter = new TelegramIdentityAdapter({ userIdentityService: identityService, botConfigs });

      const result = adapter.resolve('nutribot', { username: 'kckern' });

      expect(result.username).toBe('kckern');
      expect(result.conversationIdString).toBe('telegram:b6898194425_c575596036');
    });

    it('throws when username has no platform ID', () => {
      const adapter = new TelegramIdentityAdapter({ userIdentityService: identityService, botConfigs });

      expect(() => adapter.resolve('nutribot', { username: 'nobody' }))
        .toThrow();
    });
  });

  describe('resolve by conversationId', () => {
    it('parses canonical format and resolves username', () => {
      const adapter = new TelegramIdentityAdapter({ userIdentityService: identityService, botConfigs });

      const result = adapter.resolve('nutribot', { conversationId: 'telegram:b6898194425_c575596036' });

      expect(result.username).toBe('kckern');
      expect(result.conversationIdString).toBe('telegram:b6898194425_c575596036');
    });
  });

  describe('error cases', () => {
    it('throws when botName has no config', () => {
      const adapter = new TelegramIdentityAdapter({ userIdentityService: identityService, botConfigs });

      expect(() => adapter.resolve('unknownbot', { platformUserId: '575596036' }))
        .toThrow(/bot config/i);
    });

    it('throws when no resolvable input provided', () => {
      const adapter = new TelegramIdentityAdapter({ userIdentityService: identityService, botConfigs });

      expect(() => adapter.resolve('nutribot', {}))
        .toThrow();
    });
  });

  describe('uses correct bot for conversationId', () => {
    it('different bots produce different conversationIds for same user', () => {
      const adapter = new TelegramIdentityAdapter({ userIdentityService: identityService, botConfigs });

      const nutribot = adapter.resolve('nutribot', { platformUserId: '575596036' });
      const journalist = adapter.resolve('journalist', { platformUserId: '575596036' });

      expect(nutribot.conversationIdString).toBe('telegram:b6898194425_c575596036');
      expect(journalist.conversationIdString).toBe('telegram:b7777777777_c575596036');
    });
  });
});
