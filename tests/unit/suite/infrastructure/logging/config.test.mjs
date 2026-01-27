// tests/unit/infrastructure/logging/config.test.mjs
import { jest, beforeEach, afterEach } from '@jest/globals';
import {
  loadLoggingConfig,
  resetLoggingConfig,
  resolveLoggerLevel,
  getLoggingTags,
  resolveLogglyToken,
  resolveLogglySubdomain
} from '#backend/src/0_system/logging/config.mjs';

describe('Logging Config', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    resetLoggingConfig();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
    resetLoggingConfig();
  });

  describe('loadLoggingConfig', () => {
    test('returns default config when no file exists', () => {
      const config = loadLoggingConfig('/nonexistent/path');
      expect(config.defaultLevel).toBeDefined();
      expect(config.loggers).toBeDefined();
      expect(config.tags).toBeDefined();
    });

    test('caches config on subsequent calls', () => {
      const config1 = loadLoggingConfig('/nonexistent');
      const config2 = loadLoggingConfig('/nonexistent');
      expect(config1).toBe(config2);
    });

    test('applies LOG_LEVEL_ environment overrides', () => {
      process.env.LOG_LEVEL_FITNESS = 'debug';
      const config = loadLoggingConfig('/nonexistent');
      expect(config.loggers.fitness).toBe('debug');
    });

    test('converts double underscore to slash in logger names', () => {
      process.env.LOG_LEVEL_FITNESS__SESSION = 'warn';
      const config = loadLoggingConfig('/nonexistent');
      expect(config.loggers['fitness/session']).toBe('warn');
    });

    test('converts single underscore to dot in logger names', () => {
      process.env.LOG_LEVEL_API_ROUTER = 'error';
      const config = loadLoggingConfig('/nonexistent');
      expect(config.loggers['api.router']).toBe('error');
    });
  });

  describe('resetLoggingConfig', () => {
    test('clears cached config', () => {
      const config1 = loadLoggingConfig('/path1');
      resetLoggingConfig();
      const config2 = loadLoggingConfig('/path2');
      // They should not be the same object reference
      // (though they may have same values due to defaults)
      expect(config1).not.toBe(config2);
    });
  });

  describe('resolveLoggerLevel', () => {
    test('returns defaultLevel for empty name', () => {
      resetLoggingConfig();
      const level = resolveLoggerLevel('');
      // In non-production env, defaultLevel is 'debug'; in production it's 'info'
      expect(['info', 'debug']).toContain(level);
    });

    test('returns defaultLevel for unregistered logger', () => {
      resetLoggingConfig();
      const level = resolveLoggerLevel('unknown-logger');
      // In non-production env, defaultLevel is 'debug'; in production it's 'info'
      expect(['info', 'debug']).toContain(level);
    });

    test('returns specific level for registered logger', () => {
      process.env.LOG_LEVEL_MYLOGGER = 'debug';
      resetLoggingConfig();
      const level = resolveLoggerLevel('mylogger');
      expect(level).toBe('debug');
    });

    test('accepts custom config', () => {
      const customConfig = {
        defaultLevel: 'warn',
        loggers: { custom: 'error' }
      };
      expect(resolveLoggerLevel('custom', customConfig)).toBe('error');
      expect(resolveLoggerLevel('other', customConfig)).toBe('warn');
    });
  });

  describe('getLoggingTags', () => {
    test('returns default tags', () => {
      resetLoggingConfig();
      const tags = getLoggingTags();
      expect(tags).toContain('backend');
    });

    test('accepts custom config', () => {
      const customConfig = { tags: ['custom', 'tags'] };
      expect(getLoggingTags(customConfig)).toEqual(['custom', 'tags']);
    });
  });

  describe('resolveLogglyToken', () => {
    test('returns LOGGLY_TOKEN', () => {
      process.env.LOGGLY_TOKEN = 'token123';
      expect(resolveLogglyToken()).toBe('token123');
    });

    test('falls back to LOGGLY_INPUT_TOKEN', () => {
      delete process.env.LOGGLY_TOKEN;
      process.env.LOGGLY_INPUT_TOKEN = 'input-token';
      expect(resolveLogglyToken()).toBe('input-token');
    });

    test('returns undefined when neither set', () => {
      delete process.env.LOGGLY_TOKEN;
      delete process.env.LOGGLY_INPUT_TOKEN;
      expect(resolveLogglyToken()).toBeUndefined();
    });
  });

  describe('resolveLogglySubdomain', () => {
    test('returns LOGGLY_SUBDOMAIN', () => {
      process.env.LOGGLY_SUBDOMAIN = 'mysubdomain';
      expect(resolveLogglySubdomain()).toBe('mysubdomain');
    });

    test('falls back to LOGGLY_SUB_DOMAIN', () => {
      delete process.env.LOGGLY_SUBDOMAIN;
      process.env.LOGGLY_SUB_DOMAIN = 'alt-subdomain';
      expect(resolveLogglySubdomain()).toBe('alt-subdomain');
    });
  });
});
