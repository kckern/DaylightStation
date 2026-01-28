/**
 * ConfigLoader Unit Tests - Household Discovery
 * @module tests/unit/suite/system/config/configLoader.test
 */

import fs from 'fs';
import path from 'path';
import os from 'os';
import {
  parseHouseholdId,
  toFolderName,
  listHouseholdDirs,
  default as loadConfig,
} from '#backend/src/0_system/config/configLoader.mjs';

describe('Household Discovery Helpers', () => {
  describe('parseHouseholdId()', () => {
    test('maps household/ to default', () => {
      expect(parseHouseholdId('household')).toBe('default');
    });

    test('maps household-jones/ to jones', () => {
      expect(parseHouseholdId('household-jones')).toBe('jones');
    });

    test('maps household-test/ to test', () => {
      expect(parseHouseholdId('household-test')).toBe('test');
    });

    test('handles multi-hyphen names', () => {
      expect(parseHouseholdId('household-my-family')).toBe('my-family');
    });
  });

  describe('toFolderName()', () => {
    test('maps default to household', () => {
      expect(toFolderName('default')).toBe('household');
    });

    test('maps jones to household-jones', () => {
      expect(toFolderName('jones')).toBe('household-jones');
    });

    test('maps test to household-test', () => {
      expect(toFolderName('test')).toBe('household-test');
    });

    test('handles multi-hyphen ids', () => {
      expect(toFolderName('my-family')).toBe('household-my-family');
    });
  });

  describe('round-trip conversions', () => {
    test('parseHouseholdId(toFolderName(id)) returns original id', () => {
      const ids = ['default', 'jones', 'test', 'my-family'];
      for (const id of ids) {
        expect(parseHouseholdId(toFolderName(id))).toBe(id);
      }
    });

    test('toFolderName(parseHouseholdId(folder)) returns original folder', () => {
      const folders = ['household', 'household-jones', 'household-test', 'household-my-family'];
      for (const folder of folders) {
        expect(toFolderName(parseHouseholdId(folder))).toBe(folder);
      }
    });
  });
});

describe('listHouseholdDirs()', () => {
  test('returns empty array for non-existent directory', () => {
    expect(listHouseholdDirs('/non/existent/path')).toEqual([]);
  });

  // Note: The function correctly excludes 'households' (the legacy parent directory)
  // by only matching 'household' exactly or 'household-*' patterns
});

describe('loadConfig() system bots and auth', () => {
  let tempDir;

  beforeEach(() => {
    // Create a temporary directory for test data
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'configloader-test-'));

    // Create required directory structure
    fs.mkdirSync(path.join(tempDir, 'system'), { recursive: true });
    fs.mkdirSync(path.join(tempDir, 'system', 'auth'), { recursive: true });
  });

  afterEach(() => {
    // Clean up temporary directory
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  describe('loadSystemBots()', () => {
    test('loads bots.yml into systemBots', () => {
      // Create bots.yml
      const botsContent = `
nutribot:
  telegram:
    bot_id: "123456"
    webhook_path: "/nutribot"
homebot:
  telegram:
    bot_id: "789012"
    webhook_path: "/homebot"
`;
      fs.writeFileSync(path.join(tempDir, 'system', 'bots.yml'), botsContent);

      const config = loadConfig(tempDir);

      expect(config.systemBots).toEqual({
        nutribot: {
          telegram: {
            bot_id: '123456',
            webhook_path: '/nutribot',
          },
        },
        homebot: {
          telegram: {
            bot_id: '789012',
            webhook_path: '/homebot',
          },
        },
      });
    });

    test('returns empty object when bots.yml does not exist', () => {
      const config = loadConfig(tempDir);

      expect(config.systemBots).toEqual({});
    });
  });

  describe('loadSystemAuth()', () => {
    test('loads auth files into systemAuth keyed by platform', () => {
      // Create telegram.yml
      const telegramContent = `
nutribot: "telegram_token_123"
homebot: "telegram_token_456"
`;
      fs.writeFileSync(path.join(tempDir, 'system', 'auth', 'telegram.yml'), telegramContent);

      // Create discord.yml
      const discordContent = `
mybot: "discord_token_789"
`;
      fs.writeFileSync(path.join(tempDir, 'system', 'auth', 'discord.yml'), discordContent);

      const config = loadConfig(tempDir);

      expect(config.systemAuth).toEqual({
        telegram: {
          nutribot: 'telegram_token_123',
          homebot: 'telegram_token_456',
        },
        discord: {
          mybot: 'discord_token_789',
        },
      });
    });

    test('skips example files', () => {
      // Create example file (should be skipped)
      const exampleContent = `
nutribot: "YOUR_TOKEN_HERE"
`;
      fs.writeFileSync(path.join(tempDir, 'system', 'auth', 'telegram.example.yml'), exampleContent);

      // Create real file
      const realContent = `
nutribot: "real_token_123"
`;
      fs.writeFileSync(path.join(tempDir, 'system', 'auth', 'telegram.yml'), realContent);

      const config = loadConfig(tempDir);

      expect(config.systemAuth).toEqual({
        telegram: {
          nutribot: 'real_token_123',
        },
      });
    });

    test('returns empty object when auth directory is empty', () => {
      const config = loadConfig(tempDir);

      expect(config.systemAuth).toEqual({});
    });

    test('returns empty object when auth directory does not exist', () => {
      fs.rmSync(path.join(tempDir, 'system', 'auth'), { recursive: true });

      const config = loadConfig(tempDir);

      expect(config.systemAuth).toEqual({});
    });
  });
});
