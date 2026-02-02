/**
 * Admin Lists Comprehensive Test
 *
 * Validates all admin content lists (menus, programs, watchlists) render
 * items with proper 2-line cards (title + type/parent) and thumbnails.
 *
 * Uses API discovery + UI navigation with baselines from data mount.
 */

import { test, expect } from '@playwright/test';
import { BACKEND_URL } from '#fixtures/runtime/urls.mjs';
// Note: getListItems, sampleItems are used by Tasks 4-7 which add item validation tests to this file
import { getExpectedLists, getListItems, sampleItems } from '../../../_lib/listFixtureLoader.mjs';

const BASE_URL = BACKEND_URL;
// Note: SAMPLE_SIZE is used by Tasks 4-7 which add item sampling tests to this file
const SAMPLE_SIZE = 20;

// Load expected lists from data mount
const expectedLists = getExpectedLists();

test.describe('Admin Lists Comprehensive', () => {
  test.setTimeout(300000); // 5 minutes for full suite

  test('API returns all expected list types', async ({ request }) => {
    const types = ['menus', 'programs', 'watchlists'];

    for (const type of types) {
      const response = await request.get(`${BASE_URL}/api/v1/admin/content/lists/${type}`);
      expect(response.ok(), `Failed to fetch ${type} lists`).toBe(true);

      const data = await response.json();
      const apiLists = (data.lists || []).map(l => l.name);
      const expectedNames = expectedLists[type];

      console.log(`${type}: API has ${apiLists.length}, expected ${expectedNames.length}`);

      // All expected lists should be in API response
      for (const expected of expectedNames) {
        expect(apiLists, `Missing ${type}/${expected} from API`).toContain(expected);
      }
    }
  });
});
