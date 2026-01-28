// tests/unit/suite/secrets/YamlSecretsProvider.test.mjs

import { jest } from '@jest/globals';
import fs from 'fs';
import path from 'path';
import os from 'os';
import yaml from 'js-yaml';
import { YamlSecretsProvider } from '#backend/src/0_system/secrets/providers/YamlSecretsProvider.mjs';

describe('YamlSecretsProvider', () => {
  let tempDir;
  let provider;

  beforeEach(() => {
    // Create temp directory for each test
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'secrets-test-'));
    provider = new YamlSecretsProvider(tempDir);
  });

  afterEach(() => {
    // Clean up temp directory
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  describe('constructor', () => {
    test('throws if dataDir not provided', () => {
      expect(() => new YamlSecretsProvider()).toThrow('requires dataDir');
    });

    test('accepts valid dataDir', () => {
      const p = new YamlSecretsProvider('/some/path');
      expect(p).toBeInstanceOf(YamlSecretsProvider);
    });
  });

  describe('getSecret / setSecret', () => {
    beforeEach(async () => {
      // Create secrets file
      fs.mkdirSync(path.join(tempDir, 'system'), { recursive: true });
      fs.writeFileSync(
        path.join(tempDir, 'system/secrets.yml'),
        yaml.dump({ OPENAI_API_KEY: 'sk-test-123', OTHER_KEY: 'value' })
      );
      await provider.initialize();
    });

    test('returns secret value for existing key', () => {
      expect(provider.getSecret('OPENAI_API_KEY')).toBe('sk-test-123');
    });

    test('returns null for missing key', () => {
      expect(provider.getSecret('NONEXISTENT')).toBeNull();
    });

    test('setSecret updates value and persists', () => {
      provider.setSecret('NEW_KEY', 'new-value');

      expect(provider.getSecret('NEW_KEY')).toBe('new-value');

      // Verify written to disk
      const content = yaml.load(fs.readFileSync(
        path.join(tempDir, 'system/secrets.yml'), 'utf8'
      ));
      expect(content.NEW_KEY).toBe('new-value');
    });
  });

  describe('getSystemAuth / setSystemAuth', () => {
    beforeEach(async () => {
      fs.mkdirSync(path.join(tempDir, 'system/auth'), { recursive: true });
      fs.writeFileSync(
        path.join(tempDir, 'system/auth/telegram.yml'),
        yaml.dump({ NUTRIBOT_TOKEN: 'bot-token-123' })
      );
      await provider.initialize();
    });

    test('returns auth value for existing platform/key', () => {
      expect(provider.getSystemAuth('telegram', 'NUTRIBOT_TOKEN')).toBe('bot-token-123');
    });

    test('returns null for missing platform', () => {
      expect(provider.getSystemAuth('discord', 'BOT_TOKEN')).toBeNull();
    });

    test('returns null for missing key', () => {
      expect(provider.getSystemAuth('telegram', 'NONEXISTENT')).toBeNull();
    });

    test('setSystemAuth updates value and persists', () => {
      provider.setSystemAuth('telegram', 'NEW_BOT', 'new-token');

      expect(provider.getSystemAuth('telegram', 'NEW_BOT')).toBe('new-token');

      // Verify written to disk
      const content = yaml.load(fs.readFileSync(
        path.join(tempDir, 'system/auth/telegram.yml'), 'utf8'
      ));
      expect(content.NEW_BOT).toBe('new-token');
    });
  });

  describe('getUserAuth / setUserAuth', () => {
    beforeEach(async () => {
      fs.mkdirSync(path.join(tempDir, 'users/alice/auth'), { recursive: true });
      fs.writeFileSync(
        path.join(tempDir, 'users/alice/auth/strava.yml'),
        yaml.dump({ token: 'strava-token', user_id: '12345' })
      );
      await provider.initialize();
    });

    test('returns auth object for existing user/service', () => {
      const auth = provider.getUserAuth('alice', 'strava');
      expect(auth).toEqual({ token: 'strava-token', user_id: '12345' });
    });

    test('returns null for missing user', () => {
      expect(provider.getUserAuth('bob', 'strava')).toBeNull();
    });

    test('returns null for missing service', () => {
      expect(provider.getUserAuth('alice', 'google')).toBeNull();
    });

    test('setUserAuth creates file and updates value', () => {
      provider.setUserAuth('alice', 'google', { refresh_token: 'grt-123' });

      expect(provider.getUserAuth('alice', 'google')).toEqual({ refresh_token: 'grt-123' });

      // Verify written to disk
      const content = yaml.load(fs.readFileSync(
        path.join(tempDir, 'users/alice/auth/google.yml'), 'utf8'
      ));
      expect(content).toEqual({ refresh_token: 'grt-123' });
    });

    test('setUserAuth creates user directory if needed', () => {
      provider.setUserAuth('newuser', 'service', { token: 'tok' });

      expect(fs.existsSync(path.join(tempDir, 'users/newuser/auth/service.yml'))).toBe(true);
    });
  });

  describe('getHouseholdAuth / setHouseholdAuth', () => {
    beforeEach(async () => {
      // Default household
      fs.mkdirSync(path.join(tempDir, 'household/auth'), { recursive: true });
      fs.writeFileSync(
        path.join(tempDir, 'household/auth/plex.yml'),
        yaml.dump({ token: 'plex-token' })
      );
      // Named household
      fs.mkdirSync(path.join(tempDir, 'household-jones/auth'), { recursive: true });
      fs.writeFileSync(
        path.join(tempDir, 'household-jones/auth/homeassistant.yml'),
        yaml.dump({ token: 'ha-token' })
      );
      await provider.initialize();
    });

    test('returns auth for default household', () => {
      expect(provider.getHouseholdAuth('default', 'plex')).toEqual({ token: 'plex-token' });
    });

    test('returns auth for named household', () => {
      expect(provider.getHouseholdAuth('jones', 'homeassistant')).toEqual({ token: 'ha-token' });
    });

    test('returns null for missing household', () => {
      expect(provider.getHouseholdAuth('smith', 'plex')).toBeNull();
    });

    test('setHouseholdAuth updates default household', () => {
      provider.setHouseholdAuth('default', 'immich', { api_key: 'immich-key' });

      expect(provider.getHouseholdAuth('default', 'immich')).toEqual({ api_key: 'immich-key' });

      // Verify written to disk (default = 'household' folder)
      const content = yaml.load(fs.readFileSync(
        path.join(tempDir, 'household/auth/immich.yml'), 'utf8'
      ));
      expect(content).toEqual({ api_key: 'immich-key' });
    });

    test('setHouseholdAuth updates named household', () => {
      provider.setHouseholdAuth('jones', 'plex', { token: 'new-plex' });

      // Verify written to household-jones folder
      const content = yaml.load(fs.readFileSync(
        path.join(tempDir, 'household-jones/auth/plex.yml'), 'utf8'
      ));
      expect(content).toEqual({ token: 'new-plex' });
    });
  });

  describe('initialize', () => {
    test('works with empty data directory', async () => {
      await expect(provider.initialize()).resolves.not.toThrow();
    });

    test('skips example auth files', async () => {
      fs.mkdirSync(path.join(tempDir, 'system/auth'), { recursive: true });
      fs.writeFileSync(
        path.join(tempDir, 'system/auth/telegram.example.yml'),
        yaml.dump({ TOKEN: 'example-token' })
      );

      await provider.initialize();

      expect(provider.getSystemAuth('telegram.example', 'TOKEN')).toBeNull();
    });
  });
});
