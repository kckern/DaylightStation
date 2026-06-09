// tests/unit/infrastructure/logging/config.test.mjs
import { vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import {
  loadLoggingConfig,
  resetLoggingConfig,
  resolveLoggerLevel,
  getLoggingTags,
  resolveLogglyToken,
  resolveLogglySubdomain,
  hydrateProcessEnvFromConfigs
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

  describe('config file loading', () => {
    let tmpDir;

    beforeEach(() => {
      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'logging-config-test-'));
    });

    afterEach(() => {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    test('reads values from config/logging.yml', () => {
      fs.mkdirSync(path.join(tmpDir, 'config'));
      fs.writeFileSync(
        path.join(tmpDir, 'config', 'logging.yml'),
        'defaultLevel: warn\nloggers:\n  fitness: debug\ntags:\n  - custom-tag\n'
      );

      const config = loadLoggingConfig(tmpDir);

      expect(config.defaultLevel).toBe('warn');
      expect(config.loggers.fitness).toBe('debug');
      expect(config.tags).toEqual(['custom-tag']);
    });

    test('invalid YAML falls back to defaults and reports the error', () => {
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
      fs.mkdirSync(path.join(tmpDir, 'config'));
      fs.writeFileSync(path.join(tmpDir, 'config', 'logging.yml'), 'a: [1, 2\n'); // unclosed flow sequence

      const config = loadLoggingConfig(tmpDir);

      expect(config.loggers).toEqual({});
      expect(['info', 'debug']).toContain(config.defaultLevel);
      expect(consoleError).toHaveBeenCalledWith(
        expect.stringContaining('[config] Failed to read'),
        expect.any(String)
      );
      consoleError.mockRestore();
    });

    test('empty YAML file is treated as an empty config', () => {
      fs.mkdirSync(path.join(tmpDir, 'config'));
      fs.writeFileSync(path.join(tmpDir, 'config', 'logging.yml'), '');

      const config = loadLoggingConfig(tmpDir);

      expect(config.loggers).toEqual({});
      expect(config.tags).toEqual(['backend']);
    });
  });

  describe('hydrateProcessEnvFromConfigs', () => {
    let tmpDir;

    beforeEach(() => {
      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hydrate-config-test-'));
      delete process.env.DAYLIGHT_ENV;
    });

    afterEach(() => {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    test('returns empty object when no config files exist', () => {
      expect(hydrateProcessEnvFromConfigs(tmpDir)).toEqual({});
    });

    test('merges system.yml and config.secrets.yml with secrets taking precedence', () => {
      fs.writeFileSync(path.join(tmpDir, 'system.yml'), 'shared: from-system\nsystemOnly: yes\n');
      fs.writeFileSync(path.join(tmpDir, 'config.secrets.yml'), 'shared: from-secrets\nsecret: s3cr3t\n');

      const merged = hydrateProcessEnvFromConfigs(tmpDir);

      expect(merged.shared).toBe('from-secrets');
      expect(merged.systemOnly).toBe('yes');
      expect(merged.secret).toBe('s3cr3t');
    });

    test('DAYLIGHT_ENV selects system-local.{env}.yml and it wins over secrets', () => {
      process.env.DAYLIGHT_ENV = 'teststation';
      fs.writeFileSync(path.join(tmpDir, 'system.yml'), 'shared: from-system\n');
      fs.writeFileSync(path.join(tmpDir, 'config.secrets.yml'), 'shared: from-secrets\n');
      fs.writeFileSync(path.join(tmpDir, 'system-local.teststation.yml'), 'shared: from-local\nlocalOnly: yes\n');

      const merged = hydrateProcessEnvFromConfigs(tmpDir);

      expect(merged.shared).toBe('from-local');
      expect(merged.localOnly).toBe('yes');
    });

    test('Docker environment selects system-local.docker.yml when DAYLIGHT_ENV is unset', () => {
      fs.writeFileSync(path.join(tmpDir, 'system-local.docker.yml'), 'pickedBy: docker\n');
      const realExistsSync = fs.existsSync.bind(fs);
      const spy = vi.spyOn(fs, 'existsSync').mockImplementation(
        (p) => (p === '/.dockerenv' ? true : realExistsSync(p))
      );

      try {
        const merged = hydrateProcessEnvFromConfigs(tmpDir);
        expect(merged.pickedBy).toBe('docker');
      } finally {
        spy.mockRestore();
      }
    });

    test('falls through to hostname-specific file when DAYLIGHT_ENV file is missing', () => {
      process.env.DAYLIGHT_ENV = 'nonexistent-env';
      fs.writeFileSync(
        path.join(tmpDir, `system-local.${os.hostname()}.yml`),
        'pickedBy: hostname\n'
      );

      const merged = hydrateProcessEnvFromConfigs(tmpDir);

      expect(merged.pickedBy).toBe('hostname');
    });

    test('falls back to legacy system-local.yml when no env or hostname file exists', () => {
      fs.writeFileSync(path.join(tmpDir, 'system-local.yml'), 'pickedBy: legacy\n');

      const merged = hydrateProcessEnvFromConfigs(tmpDir);

      expect(merged.pickedBy).toBe('legacy');
    });

    test('hostname-specific file beats legacy system-local.yml', () => {
      fs.writeFileSync(path.join(tmpDir, `system-local.${os.hostname()}.yml`), 'pickedBy: hostname\n');
      fs.writeFileSync(path.join(tmpDir, 'system-local.yml'), 'pickedBy: legacy\n');

      const merged = hydrateProcessEnvFromConfigs(tmpDir);

      expect(merged.pickedBy).toBe('hostname');
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
