/**
 * ConfigProvider Tests
 * @module tests/_lib/ConfigProvider.test
 */

import { ConfigProvider, resetConfigProvider } from '../../_lib/config/ConfigProvider.mjs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

describe('ConfigProvider', () => {
  // Reset singleton between tests
  beforeEach(() => {
    resetConfigProvider();
  });

  describe('constructor', () => {
    it('should create instance without options', () => {
      const config = new ConfigProvider();
      expect(config).toBeDefined();
    });

    it('should accept custom environment variables', () => {
      const config = new ConfigProvider({
        env: {
          NODE_ENV: 'test',
          TZ: 'UTC',
        },
        appConfigPath: '/nonexistent/config.yml', // Force empty config to test env fallback
      });
      expect(config.getEnvironment()).toBe('test');
      // TZ is used as fallback when no config timezone exists
      expect(config.getTimezone()).toBe('UTC');
    });
  });

  describe('getTimezone()', () => {
    it('should return timezone from config', () => {
      const config = new ConfigProvider();
      const tz = config.getTimezone();
      // Should be a valid timezone string
      expect(typeof tz).toBe('string');
      expect(tz.length).toBeGreaterThan(0);
    });

    it('should fall back to America/Los_Angeles', () => {
      const config = new ConfigProvider({
        env: {},
        appConfigPath: '/nonexistent/path.yml',
      });
      expect(config.getTimezone()).toBe('America/Los_Angeles');
    });
  });

  describe('getEnvironment()', () => {
    it('should return NODE_ENV', () => {
      const config = new ConfigProvider({
        env: { NODE_ENV: 'production' },
      });
      expect(config.getEnvironment()).toBe('production');
    });

    it('should default to development', () => {
      const config = new ConfigProvider({
        env: {},
      });
      expect(config.getEnvironment()).toBe('development');
    });
  });

  describe('isProduction()', () => {
    it('should return true for production', () => {
      const config = new ConfigProvider({
        env: { NODE_ENV: 'production' },
      });
      expect(config.isProduction()).toBe(true);
    });

    it('should return false for development', () => {
      const config = new ConfigProvider({
        env: { NODE_ENV: 'development' },
      });
      expect(config.isProduction()).toBe(false);
    });
  });

  describe('getUser()', () => {
    it('should return user by internal ID', () => {
      const config = new ConfigProvider();
      const user = config.getUser('kckern');
      
      expect(user).toBeDefined();
      expect(user.internalId).toBe('kckern');
      expect(user.telegramUserId).toBe('575596036');
      expect(user.defaultBot).toBe('nutribot');
      expect(user.goals).toBeDefined();
    });

    it('should return null for unknown user', () => {
      const config = new ConfigProvider();
      const user = config.getUser('unknown_user');
      
      expect(user).toBeNull();
    });
  });

  describe('getInternalUserId()', () => {
    it('should return internal ID from telegram user ID', () => {
      const config = new ConfigProvider();
      const internalId = config.getInternalUserId('575596036');
      
      expect(internalId).toBe('kckern');
    });

    it('should handle numeric telegram ID', () => {
      const config = new ConfigProvider();
      const internalId = config.getInternalUserId(575596036);
      
      expect(internalId).toBe('kckern');
    });

    it('should return null for unknown telegram ID', () => {
      const config = new ConfigProvider();
      const internalId = config.getInternalUserId('999999999');
      
      expect(internalId).toBeNull();
    });
  });

  describe('getAllUsers()', () => {
    it('should return all registered users', () => {
      const config = new ConfigProvider();
      const users = config.getAllUsers();
      
      expect(Array.isArray(users)).toBe(true);
      expect(users.length).toBeGreaterThan(0);
      expect(users[0].internalId).toBeDefined();
      expect(users[0].telegramUserId).toBeDefined();
    });
  });

  describe('getUserGoals()', () => {
    it('should return goals for specific user', () => {
      const config = new ConfigProvider();
      const goals = config.getUserGoals('kckern');
      
      expect(goals.calories).toBe(2000);
      expect(goals.protein).toBe(150);
    });
  });

  describe('getBotConfig()', () => {
    it('should return nutribot config', () => {
      const config = new ConfigProvider();
      const bot = config.getBotConfig('nutribot');
      
      expect(bot.name).toBe('nutribot');
      expect(bot.telegramBotId).toBe('6898194425');
      expect(bot.webhookUrl).toContain('foodlog');
    });

    it('should return journalist config', () => {
      const config = new ConfigProvider();
      const bot = config.getBotConfig('journalist');
      
      expect(bot.name).toBe('journalist');
      expect(bot.telegramBotId).toBe('580626020');
      expect(bot.webhookUrl).toContain('journalist');
    });
  });

  describe('getNutribotConfig()', () => {
    it('should return nutribot configuration', () => {
      const config = new ConfigProvider();
      const nutribotConfig = config.getNutribotConfig();

      expect(nutribotConfig).toBeDefined();
      expect(nutribotConfig.telegram).toBeDefined();
      expect(nutribotConfig.telegram.botId).toBeDefined();
      expect(nutribotConfig.users).toBeDefined();
      expect(nutribotConfig.data).toBeDefined();
      expect(nutribotConfig.goals).toBeDefined();
    });

    it('should have correct bot ID', () => {
      const config = new ConfigProvider();
      const nutribotConfig = config.getNutribotConfig();
      
      // Should be a string of digits
      expect(nutribotConfig.telegram.botId).toMatch(/^\d+$/);
    });

    it('should have nutrition goals', () => {
      const config = new ConfigProvider();
      const nutribotConfig = config.getNutribotConfig();
      
      expect(nutribotConfig.goals.calories).toBeGreaterThan(0);
      expect(nutribotConfig.goals.protein).toBeGreaterThan(0);
    });
  });

  describe('getNutritionGoals()', () => {
    it('should return nutrition goals with defaults', () => {
      const config = new ConfigProvider();
      const goals = config.getNutritionGoals();

      expect(goals.calories).toBe(2000);
      expect(goals.protein).toBe(150);
      expect(goals.carbs).toBe(200);
      expect(goals.fat).toBe(65);
    });
  });

  describe('getJournalistConfig()', () => {
    it('should return journalist configuration', () => {
      const config = new ConfigProvider();
      const journalistConfig = config.getJournalistConfig();

      expect(journalistConfig).toBeDefined();
      expect(journalistConfig.telegram).toBeDefined();
      expect(journalistConfig.telegram.botId).toBeDefined();
      expect(journalistConfig.users).toBeDefined();
    });
  });

  describe('getTelegramToken()', () => {
    it('should return token from environment first', () => {
      const config = new ConfigProvider({
        env: { TELEGRAM_NUTRIBOT_TOKEN: 'env-token-123' },
      });
      expect(config.getTelegramToken('nutribot')).toBe('env-token-123');
    });

    it('should return null if not found', () => {
      const config = new ConfigProvider({
        env: {},
        secretsPath: '/nonexistent/path.yml',
      });
      expect(config.getTelegramToken('nonexistent')).toBeNull();
    });
  });

  describe('getTelegramBotId()', () => {
    it('should return nutribot ID', () => {
      const config = new ConfigProvider();
      const botId = config.getTelegramBotId('nutribot');
      expect(botId).toMatch(/^\d+$/);
    });

    it('should return journalist ID', () => {
      const config = new ConfigProvider();
      const botId = config.getTelegramBotId('journalist');
      expect(botId).toMatch(/^\d+$/);
    });

    it('should return empty string for unknown bot', () => {
      const config = new ConfigProvider();
      expect(config.getTelegramBotId('unknown')).toBe('');
    });
  });

  describe('getOpenAIKey()', () => {
    it('should return key from environment', () => {
      const config = new ConfigProvider({
        env: { OPENAI_API_KEY: 'sk-test-key' },
      });
      expect(config.getOpenAIKey()).toBe('sk-test-key');
    });
  });

  describe('get()', () => {
    it('should get nested config values', () => {
      const config = new ConfigProvider();
      // Test with a known config path
      const timezone = config.get('weather.timezone');
      expect(timezone).toBeDefined();
    });

    it('should return default for missing path', () => {
      const config = new ConfigProvider();
      const value = config.get('nonexistent.path', 'default-value');
      expect(value).toBe('default-value');
    });

    it('should return undefined for missing path without default', () => {
      const config = new ConfigProvider();
      const value = config.get('nonexistent.path');
      expect(value).toBeUndefined();
    });
  });

  describe('getSecret()', () => {
    it('should return secret from environment first', () => {
      const config = new ConfigProvider({
        env: { MY_SECRET: 'env-secret' },
      });
      expect(config.getSecret('MY_SECRET')).toBe('env-secret');
    });

    it('should return default for missing secret', () => {
      const config = new ConfigProvider({
        env: {},
        secretsPath: '/nonexistent/path.yml',
      });
      expect(config.getSecret('NONEXISTENT', 'default')).toBe('default');
    });
  });

  describe('getMySQLConfig()', () => {
    it('should return MySQL configuration', () => {
      const config = new ConfigProvider();
      const mysqlConfig = config.getMySQLConfig();

      expect(mysqlConfig).toBeDefined();
      expect(mysqlConfig.port).toBe(3306);
      expect(typeof mysqlConfig.database).toBe('string');
    });
  });

  describe('getNutritionixCredentials()', () => {
    it('should return credentials object', () => {
      const config = new ConfigProvider();
      const creds = config.getNutritionixCredentials();

      expect(creds).toBeDefined();
      expect(typeof creds.appId).toBe('string');
      expect(typeof creds.apiKey).toBe('string');
    });
  });

  describe('getRawAppConfig()', () => {
    it('should return raw config object', () => {
      const config = new ConfigProvider();
      const raw = config.getRawAppConfig();

      expect(raw).toBeDefined();
      expect(typeof raw).toBe('object');
    });
  });
});
