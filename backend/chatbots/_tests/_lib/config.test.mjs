/**
 * Tests for Configuration modules
 * @group Phase1
 */

import { jest } from '@jest/globals';

// Need to mock before imports
const mockEnv = {};
const originalEnv = process.env;

beforeEach(() => {
  jest.resetModules();
  process.env = { ...originalEnv, ...mockEnv };
});

afterEach(() => {
  process.env = originalEnv;
});

describe('Phase1: ConfigSchema', () => {
  let ConfigSchema;
  
  beforeEach(async () => {
    ConfigSchema = await import('../../_lib/config/ConfigSchema.mjs');
  });

  describe('CommonConfigSchema', () => {
    it('should accept valid common config', () => {
      const config = {
        environment: 'development',
        timezone: 'America/New_York',
        paths: { data: '/data' },
        logging: { level: 'info' },
      };
      
      const result = ConfigSchema.CommonConfigSchema.safeParse(config);
      expect(result.success).toBe(true);
    });

    it('should apply defaults for optional fields', () => {
      const config = { paths: { data: '/data' } };
      
      const result = ConfigSchema.CommonConfigSchema.safeParse(config);
      expect(result.success).toBe(true);
      expect(result.data.environment).toBe('development');
      expect(result.data.timezone).toBe('America/Los_Angeles');
      expect(result.data.logging.level).toBe('info');
    });

    it('should reject invalid environment values', () => {
      const config = {
        environment: 'invalid',
        paths: { data: '/data' },
      };
      
      const result = ConfigSchema.CommonConfigSchema.safeParse(config);
      expect(result.success).toBe(false);
    });

    it('should reject invalid log levels', () => {
      const config = {
        paths: { data: '/data' },
        logging: { level: 'trace' },
      };
      
      const result = ConfigSchema.CommonConfigSchema.safeParse(config);
      expect(result.success).toBe(false);
    });
  });

  describe('TelegramConfigSchema', () => {
    it('should require token and botId', () => {
      const validConfig = { token: 'test-token', botId: 'test-bot' };
      const result = ConfigSchema.TelegramConfigSchema.safeParse(validConfig);
      expect(result.success).toBe(true);
    });

    it('should reject missing token', () => {
      const config = { botId: 'test-bot' };
      const result = ConfigSchema.TelegramConfigSchema.safeParse(config);
      expect(result.success).toBe(false);
    });

    it('should reject empty token', () => {
      const config = { token: '', botId: 'test-bot' };
      const result = ConfigSchema.TelegramConfigSchema.safeParse(config);
      expect(result.success).toBe(false);
    });
  });

  describe('OpenAIConfigSchema', () => {
    it('should apply defaults', () => {
      const config = { apiKey: 'sk-test' };
      const result = ConfigSchema.OpenAIConfigSchema.safeParse(config);
      
      expect(result.success).toBe(true);
      expect(result.data.model).toBe('gpt-4o');
      expect(result.data.maxTokens).toBe(1000);
      expect(result.data.timeout).toBe(60000);
    });
  });

  describe('NutribotConfigSchema', () => {
    it('should validate full nutribot config', () => {
      const config = {
        environment: 'production',
        paths: { data: '/data' },
        telegram: { token: 'tg-token', botId: 'bot-id' },
        openai: { apiKey: 'sk-key' },
        reporting: {
          calorieThresholds: [500, 1000, 1500],
          dailyBudget: 1800,
        },
      };
      
      const result = ConfigSchema.NutribotConfigSchema.safeParse(config);
      expect(result.success).toBe(true);
    });
  });

  describe('getSchemaForBot', () => {
    it('should return NutribotConfigSchema for nutribot', () => {
      const schema = ConfigSchema.getSchemaForBot('nutribot');
      expect(schema).toBe(ConfigSchema.NutribotConfigSchema);
    });

    it('should return JournalistConfigSchema for journalist', () => {
      const schema = ConfigSchema.getSchemaForBot('journalist');
      expect(schema).toBe(ConfigSchema.JournalistConfigSchema);
    });

    it('should return BotConfigSchema for unknown bot', () => {
      const schema = ConfigSchema.getSchemaForBot('unknown');
      expect(schema).toBe(ConfigSchema.BotConfigSchema);
    });
  });

  describe('hasEnvVarReference', () => {
    it('should detect ${VAR} pattern', () => {
      expect(ConfigSchema.hasEnvVarReference('${MY_VAR}')).toBe(true);
      expect(ConfigSchema.hasEnvVarReference('prefix_${VAR}_suffix')).toBe(true);
    });

    it('should return false for non-strings', () => {
      expect(ConfigSchema.hasEnvVarReference(123)).toBe(false);
      expect(ConfigSchema.hasEnvVarReference(null)).toBe(false);
    });

    it('should return false for strings without pattern', () => {
      expect(ConfigSchema.hasEnvVarReference('no vars here')).toBe(false);
    });
  });
});

describe('Phase1: ConfigLoader', () => {
  let ConfigLoader;
  
  beforeEach(async () => {
    ConfigLoader = await import('../../_lib/config/ConfigLoader.mjs');
    ConfigLoader.clearConfigCache();
  });

  describe('interpolateEnvVars', () => {
    it('should replace ${VAR} with environment value', () => {
      process.env.TEST_VAR = 'test-value';
      const result = ConfigLoader.default.interpolateEnvVars('${TEST_VAR}');
      expect(result).toBe('test-value');
    });

    it('should replace multiple variables', () => {
      process.env.VAR1 = 'one';
      process.env.VAR2 = 'two';
      const result = ConfigLoader.default.interpolateEnvVars('${VAR1}-${VAR2}');
      expect(result).toBe('one-two');
    });

    it('should return empty string for undefined env vars', () => {
      delete process.env.UNDEFINED_VAR;
      const result = ConfigLoader.default.interpolateEnvVars('${UNDEFINED_VAR}');
      expect(result).toBe('');
    });

    it('should handle nested objects', () => {
      process.env.NESTED_VAR = 'nested';
      const obj = { level1: { level2: '${NESTED_VAR}' } };
      const result = ConfigLoader.default.interpolateEnvVars(obj);
      expect(result.level1.level2).toBe('nested');
    });

    it('should handle arrays', () => {
      process.env.ARR_VAR = 'arr';
      const arr = ['${ARR_VAR}', 'static'];
      const result = ConfigLoader.default.interpolateEnvVars(arr);
      expect(result).toEqual(['arr', 'static']);
    });
  });

  describe('deepMerge', () => {
    it('should merge objects recursively', () => {
      const base = { a: 1, b: { c: 2 } };
      const override = { b: { d: 3 }, e: 4 };
      const result = ConfigLoader.default.deepMerge(base, override);
      
      expect(result).toEqual({ a: 1, b: { c: 2, d: 3 }, e: 4 });
    });

    it('should replace arrays', () => {
      const base = { arr: [1, 2, 3] };
      const override = { arr: [4, 5] };
      const result = ConfigLoader.default.deepMerge(base, override);
      
      expect(result.arr).toEqual([4, 5]);
    });

    it('should handle null override', () => {
      const base = { a: 1 };
      const result = ConfigLoader.default.deepMerge(base, null);
      expect(result).toEqual({ a: 1 });
    });
  });

  describe('clearConfigCache', () => {
    it('should clear the cache', () => {
      const cache = ConfigLoader.getConfigCache();
      cache.set('test', { value: 'test' });
      expect(cache.size).toBe(1);
      
      ConfigLoader.clearConfigCache();
      expect(cache.size).toBe(0);
    });
  });
});
