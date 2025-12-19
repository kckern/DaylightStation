/**
 * Tests for NutriBotConfig
 * @group nutribot
 */

import { NutriBotConfig } from '../../bots/nutribot/config/NutriBotConfig.mjs';
import { TelegramChatRef } from '../../infrastructure/telegram/TelegramChatRef.mjs';
import { ConversationId } from '../../domain/value-objects/ChatId.mjs';
import { ValidationError } from '../../_lib/errors/index.mjs';

describe('NutriBot: NutriBotConfig', () => {
  const validConfig = {
    bot: {
      name: 'nutribot',
      displayName: 'NutriBot',
    },
    telegram: {
      botId: '6898194425',
      botToken: 'test-token',
    },
    users: [
      {
        telegram: {
          botId: '6898194425',
          chatId: '575596036',
        },
        systemUser: 'kirk',
        displayName: 'Kirk',
        timezone: 'America/Los_Angeles',
      },
      {
        telegram: {
          botId: '6898194425',
          chatId: '123456789',
        },
        systemUser: 'jane',
        displayName: 'Jane',
        timezone: 'America/New_York',
      },
    ],
    storage: {
      basePath: 'nutribot',
      paths: {
        nutrilog: '{userId}/nutrilog.yml',
        nutrilist: '{userId}/nutrilist.yml',
      },
    },
  };

  describe('constructor', () => {
    it('should create config with valid data', () => {
      const config = new NutriBotConfig(validConfig);
      
      expect(config.botName).toBe('nutribot');
      expect(config.botDisplayName).toBe('NutriBot');
      expect(config.telegramBotId).toBe('6898194425');
    });

    it('should throw for invalid config', () => {
      expect(() => new NutriBotConfig({})).toThrow(ValidationError);
    });

    it('should throw for missing users', () => {
      expect(() => new NutriBotConfig({ ...validConfig, users: undefined }))
        .toThrow(ValidationError);
    });
  });

  describe('user mapping', () => {
    let config;

    beforeEach(() => {
      config = new NutriBotConfig(validConfig);
    });

    describe('getUserForConversation', () => {
      it('should return user for valid conversation', () => {
        const convId = new ConversationId('telegram', 'b6898194425_c575596036');
        const user = config.getUserForConversation(convId);
        
        expect(user).toBe('kirk');
      });

      it('should return null for unknown conversation', () => {
        const convId = new ConversationId('telegram', 'b999_c999');
        const user = config.getUserForConversation(convId);
        
        expect(user).toBeNull();
      });

      it('should accept string conversation ID', () => {
        const user = config.getUserForConversation('telegram:b6898194425_c575596036');
        expect(user).toBe('kirk');
      });
    });

    describe('getUserInfoForConversation', () => {
      it('should return full user info', () => {
        const convId = new ConversationId('telegram', 'b6898194425_c575596036');
        const info = config.getUserInfoForConversation(convId);
        
        expect(info.systemUser).toBe('kirk');
        expect(info.displayName).toBe('Kirk');
        expect(info.timezone).toBe('America/Los_Angeles');
        expect(info.conversationId).toBeInstanceOf(ConversationId);
        expect(info.telegramRef).toBeInstanceOf(TelegramChatRef);
      });
    });

    describe('getUserForTelegram', () => {
      it('should return user for Telegram ref', () => {
        const ref = new TelegramChatRef('6898194425', '575596036');
        const user = config.getUserForTelegram(ref);
        
        expect(user).toBe('kirk');
      });
    });

    describe('getUserForLegacyChatId', () => {
      it('should return user for legacy format', () => {
        const user = config.getUserForLegacyChatId('b6898194425_u575596036');
        expect(user).toBe('kirk');
      });

      it('should return null for invalid legacy format', () => {
        const user = config.getUserForLegacyChatId('invalid');
        expect(user).toBeNull();
      });
    });

    describe('getConversationsForUser', () => {
      it('should return all conversations for user', () => {
        const conversations = config.getConversationsForUser('kirk');
        
        expect(conversations).toHaveLength(1);
        expect(conversations[0]).toBeInstanceOf(ConversationId);
        expect(conversations[0].identifier).toBe('b6898194425_c575596036');
      });

      it('should return empty for unknown user', () => {
        const conversations = config.getConversationsForUser('unknown');
        expect(conversations).toHaveLength(0);
      });
    });

    describe('isKnownConversation', () => {
      it('should return true for known conversation', () => {
        expect(config.isKnownConversation('telegram:b6898194425_c575596036')).toBe(true);
      });

      it('should return false for unknown conversation', () => {
        expect(config.isKnownConversation('telegram:unknown')).toBe(false);
      });
    });

    describe('isKnownUser', () => {
      it('should return true for known user', () => {
        expect(config.isKnownUser('kirk')).toBe(true);
        expect(config.isKnownUser('jane')).toBe(true);
      });

      it('should return false for unknown user', () => {
        expect(config.isKnownUser('unknown')).toBe(false);
      });
    });

    describe('getAllUserIds', () => {
      it('should return all registered users', () => {
        const users = config.getAllUserIds();
        expect(users).toContain('kirk');
        expect(users).toContain('jane');
        expect(users).toHaveLength(2);
      });
    });

    describe('getUserTimezone', () => {
      it('should return user timezone', () => {
        expect(config.getUserTimezone('kirk')).toBe('America/Los_Angeles');
        expect(config.getUserTimezone('jane')).toBe('America/New_York');
      });

      it('should return default for unknown user', () => {
        expect(config.getUserTimezone('unknown')).toBe('America/Los_Angeles');
      });
    });
  });

  describe('storage paths', () => {
    let config;

    beforeEach(() => {
      config = new NutriBotConfig(validConfig);
    });

    describe('getNutrilogPath', () => {
      it('should return path with userId substituted', () => {
        const path = config.getNutrilogPath('kirk');
        expect(path).toBe('nutribot/kirk/nutrilog.yml');
      });
    });

    describe('getNutrilistPath', () => {
      it('should return path with userId substituted', () => {
        const path = config.getNutrilistPath('kirk');
        expect(path).toBe('nutribot/kirk/nutrilist.yml');
      });
    });

    describe('getLegacyPath', () => {
      it('should return null when legacy not enabled', () => {
        const ref = new TelegramChatRef('6898194425', '575596036');
        const path = config.getLegacyPath(ref);
        expect(path).toBeNull();
      });

      it('should return legacy path when enabled', () => {
        const configWithLegacy = new NutriBotConfig({
          ...validConfig,
          storage: {
            ...validConfig.storage,
            legacy: {
              enabled: true,
              pattern: 'journalist/nutribot/nutrilogs/b{botId}_u{chatId}.yaml',
            },
          },
        });

        const ref = new TelegramChatRef('6898194425', '575596036');
        const path = configWithLegacy.getLegacyPath(ref);
        
        expect(path).toBe('journalist/nutribot/nutrilogs/b6898194425_u575596036.yaml');
      });
    });
  });

  describe('feature flags', () => {
    it('should return false for undefined features', () => {
      const config = new NutriBotConfig(validConfig);
      expect(config.isFeatureEnabled('undefined_feature')).toBe(false);
    });

    it('should return feature value when defined', () => {
      const configWithFeatures = new NutriBotConfig({
        ...validConfig,
        features: {
          nutritionEstimation: true,
          photoDetection: false,
        },
      });

      expect(configWithFeatures.isFeatureEnabled('nutritionEstimation')).toBe(true);
      expect(configWithFeatures.isFeatureEnabled('photoDetection')).toBe(false);
    });
  });

  describe('toJSON', () => {
    it('should return config object', () => {
      const config = new NutriBotConfig(validConfig);
      const json = config.toJSON();
      
      expect(json.bot.name).toBe('nutribot');
      expect(json.users).toHaveLength(2);
    });
  });
});

describe('NutriBot: Multi-bot scenarios', () => {
  it('should support same user with multiple bots', () => {
    const config = new NutriBotConfig({
      bot: { name: 'nutribot', displayName: 'NutriBot' },
      telegram: { botId: '6898194425', botToken: 'token' },
      users: [
        {
          telegram: { botId: '6898194425', chatId: '575596036' },
          systemUser: 'kirk',
          displayName: 'Kirk',
        },
        {
          telegram: { botId: '9999999999', chatId: '575596036' },
          systemUser: 'kirk',
          displayName: 'Kirk (Alt Bot)',
        },
      ],
      storage: {
        basePath: 'nutribot',
        paths: { nutrilog: '{userId}/nutrilog.yml', nutrilist: '{userId}/nutrilist.yml' },
      },
    });

    // Both conversations should map to same user
    expect(config.getUserForConversation('telegram:b6898194425_c575596036')).toBe('kirk');
    expect(config.getUserForConversation('telegram:b9999999999_c575596036')).toBe('kirk');

    // User should have two conversations
    const conversations = config.getConversationsForUser('kirk');
    expect(conversations).toHaveLength(2);
  });
});
