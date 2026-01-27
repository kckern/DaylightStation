/**
 * ConfigLoader Unit Tests - Household Discovery
 * @module tests/unit/suite/system/config/configLoader.test
 */

import {
  parseHouseholdId,
  toFolderName,
  listHouseholdDirs,
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
