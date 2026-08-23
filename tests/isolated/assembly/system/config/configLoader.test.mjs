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
    fs.mkdirSync(path.join(tempDir, 'system', 'config'), { recursive: true });
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
      fs.writeFileSync(path.join(tempDir, 'system', 'config', 'bots.yml'), botsContent);

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

  // `loadSystemAuth()` is GONE from this layer on purpose: configLoader.mjs
  // hands auth to SecretsHandler (see its own note, "secrets, auth,
  // systemAuth removed - now handled by SecretsHandler"), which is covered by
  // tests/unit/suite/secrets/. The four specs that used to sit here asserted
  // `config.systemAuth` and had been failing against `undefined` ever since —
  // unnoticed, because this file uses bare globals and the vitest gate's
  // population required an explicit `from 'vitest'` import.
});
