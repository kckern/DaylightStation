/**
 * Tests for the new config infrastructure index.mjs
 * 
 * Tests factory functions, singleton pattern, and re-exports.
 */
import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';

describe('Config Infrastructure Index', () => {
  let configModule;

  beforeEach(async () => {
    // Fresh import each time
    configModule = await import('#backend/src/0_system/config/index.mjs');
    configModule.resetConfigService();
  });

  afterEach(() => {
    configModule.resetConfigService();
  });

  describe('exports', () => {
    it('exports ConfigService class', () => {
      expect(configModule.ConfigService).toBeDefined();
      expect(typeof configModule.ConfigService).toBe('function');
    });

    it('exports createConfigService function', () => {
      expect(typeof configModule.createConfigService).toBe('function');
    });

    it('exports initConfigService function', () => {
      expect(typeof configModule.initConfigService).toBe('function');
    });

    it('exports getConfigService function', () => {
      expect(typeof configModule.getConfigService).toBe('function');
    });

    it('exports resetConfigService function', () => {
      expect(typeof configModule.resetConfigService).toBe('function');
    });

    it('exports createTestConfigService function', () => {
      expect(typeof configModule.createTestConfigService).toBe('function');
    });

    it('exports configService proxy', () => {
      expect(configModule.configService).toBeDefined();
    });

    it('exports ConfigValidationError class', () => {
      expect(configModule.ConfigValidationError).toBeDefined();
    });

    it('exports configSchema', () => {
      expect(configModule.configSchema).toBeDefined();
    });

    it('exports loadConfig function', () => {
      expect(typeof configModule.loadConfig).toBe('function');
    });

    it('exports validateConfig function', () => {
      expect(typeof configModule.validateConfig).toBe('function');
    });
  });

  describe('createTestConfigService', () => {
    it('creates a ConfigService from raw config object', () => {
      const mockConfig = {
        system: { defaultHouseholdId: 'test', dataDir: '/data', configDir: '/config' },
        secrets: { TEST_KEY: 'value' },
        households: {},
        users: {},
        auth: { users: {}, households: {} },
        apps: {}
      };

      const svc = configModule.createTestConfigService(mockConfig);
      expect(svc.getSecret('TEST_KEY')).toBe('value');
      expect(svc.getDefaultHouseholdId()).toBe('test');
    });
  });

  describe('configService proxy', () => {
    it('isReady returns false before initialization', () => {
      expect(configModule.configService.isReady()).toBe(false);
    });

    it('throws when accessing methods before initialization', () => {
      expect(() => configModule.configService.getSecret('key')).toThrow(
        'ConfigService not initialized'
      );
    });
  });

  describe('getConfigService', () => {
    it('throws when not initialized', () => {
      expect(() => configModule.getConfigService()).toThrow(
        'ConfigService not initialized'
      );
    });
  });

  describe('ConfigValidationError', () => {
    it('includes error details in message', () => {
      const errors = [
        { path: 'secrets.API_KEY', message: 'required but missing' }
      ];
      const err = new configModule.ConfigValidationError(errors, ['/path/to/file']);
      
      expect(err.message).toContain('secrets.API_KEY');
      expect(err.message).toContain('required but missing');
      expect(err.errors).toEqual(errors);
      expect(err.checkedPaths).toEqual(['/path/to/file']);
    });
  });
});
