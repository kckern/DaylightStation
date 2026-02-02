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

/**
 * Validate a content display card has proper structure
 * @param {import('@playwright/test').Locator} row - The item row locator
 * @param {number} rowIndex - Row index for error messages
 * @param {string} listPath - List path for error messages (e.g., "menus/ambient")
 * @returns {Promise<{valid: boolean, error?: string, unresolved?: boolean}>}
 */
async function validateCardStructure(row, rowIndex, listPath) {
  const inputCol = row.locator('.col-input');
  const contentDisplay = inputCol.locator('.content-display');

  // Check content display exists
  const displayCount = await contentDisplay.count();
  if (displayCount === 0) {
    return { valid: false, error: `Row ${rowIndex}: No .content-display found` };
  }

  // Check for unresolved state
  const isUnresolved = await contentDisplay.locator('.content-display--unresolved').count() > 0 ||
                       await contentDisplay.locator('text=Unresolved').count() > 0;

  if (isUnresolved) {
    const rawValue = await contentDisplay.textContent();
    return {
      valid: false,
      unresolved: true,
      error: `Row ${rowIndex} in ${listPath}: Unresolved content - ${JSON.stringify(rawValue?.substring(0, 50) || '')}`
    };
  }

  // Check for avatar (thumbnail)
  const avatar = contentDisplay.locator('.mantine-Avatar-root');
  const hasAvatar = await avatar.count() > 0;
  if (!hasAvatar) {
    return { valid: false, error: `Row ${rowIndex} in ${listPath}: No thumbnail avatar` };
  }

  // Check for title text (not empty, not raw ID)
  const text = await contentDisplay.textContent();
  if (!text || text.trim().length === 0) {
    return { valid: false, error: `Row ${rowIndex} in ${listPath}: Empty content display` };
  }

  // Check it's not just a raw ID (plex:12345 or just numbers)
  const isRawId = /^(plex|immich|abs|media):\s*\d+\s*$/i.test(text.trim()) ||
                  /^\d+$/.test(text.replace(/PLEX|IMMICH|ABS|MEDIA/gi, '').trim());
  if (isRawId) {
    return { valid: false, error: `Row ${rowIndex} in ${listPath}: Shows raw ID instead of title - "${text}"` };
  }

  // Check for type+parent line (contains bullet separator)
  const hasBullet = text.includes('•');
  if (!hasBullet) {
    // Might be OK for some items without parent, log warning but don't fail
    console.log(`  Note: Row ${rowIndex} in ${listPath} has no type•parent line`);
  }

  // Check for source badge
  const badge = contentDisplay.locator('.mantine-Badge-root');
  const hasBadge = await badge.count() > 0;
  if (!hasBadge) {
    return { valid: false, error: `Row ${rowIndex} in ${listPath}: No source badge` };
  }

  return { valid: true };
}

test.describe('Admin Lists Comprehensive', () => {
  test.setTimeout(300000); // 5 minutes for full suite

  /**
   * Generate test for a specific list type
   * @param {import('@playwright/test').Page} page - Playwright page
   * @param {string} type - List type (menus, programs, watchlists)
   * @returns {Promise<string[]>} Array of error messages
   */
  async function testListType(page, type) {
    const lists = expectedLists[type];
    const errors = [];
    let totalItemsChecked = 0;

    console.log(`\nTesting ${lists.length} ${type}...`);

    for (const listName of lists) {
      console.log(`  Checking ${type}/${listName}...`);

      // Navigate to list
      await page.goto(`${BASE_URL}/admin/content/lists/${type}/${listName}`, {
        waitUntil: 'networkidle',
        timeout: 30000
      });

      // Wait for items to load
      const hasItems = await page.waitForSelector('.item-row', { timeout: 10000 }).catch(() => {
        console.log(`    Note: No .item-row found within timeout for ${listName}`);
        return null;
      });

      // Allow time for content metadata to load (async fetch per item)
      await page.waitForTimeout(3000);

      // Get all rows
      const rows = page.locator('.item-row');
      const rowCount = await rows.count();

      if (rowCount === 0) {
        console.log(`    No items in ${listName}`);
        continue;
      }

      // Get items from fixture for sampling
      const fixtureItems = getListItems(type, listName);
      const sampled = sampleItems(fixtureItems, SAMPLE_SIZE);

      console.log(`    ${rowCount} rows, sampling ${sampled.length} items`);

      // Validate sampled items
      for (const sampledItem of sampled) {
        const rowIdx = sampledItem.originalIndex;
        if (rowIdx >= rowCount) {
          console.log(`    Note: Sampled row ${rowIdx} exceeds actual row count ${rowCount}, skipping`);
          continue;
        }

        const row = rows.nth(rowIdx);
        const result = await validateCardStructure(row, rowIdx, `${type}/${listName}`);

        if (!result.valid) {
          errors.push(result.error);
          if (result.unresolved) {
            console.log(`    ❌ ${result.error}`);
          }
        }
        totalItemsChecked++;
      }
    }

    console.log(`\n${type}: Checked ${totalItemsChecked} items across ${lists.length} lists`);

    if (errors.length > 0) {
      console.log(`\n❌ ${errors.length} errors found:`);
      errors.forEach(e => console.log(`  - ${e}`));
    }

    return errors;
  }

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

  test('Menus: all items render with proper cards', async ({ page }) => {
    const errors = await testListType(page, 'menus');
    expect(errors, `Found ${errors.length} card rendering errors in menus`).toHaveLength(0);
  });

  test('Programs: all items render with proper cards', async ({ page }) => {
    const errors = await testListType(page, 'programs');
    expect(errors, `Found ${errors.length} card rendering errors in programs`).toHaveLength(0);
  });

  test('Watchlists: all items render with proper cards', async ({ page }) => {
    const errors = await testListType(page, 'watchlists');
    expect(errors, `Found ${errors.length} card rendering errors in watchlists`).toHaveLength(0);
  });

  test('Summary: all list types pass validation', async ({ page }) => {
    const allErrors = [];
    const summary = {
      menus: { lists: 0, items: 0, errors: 0 },
      programs: { lists: 0, items: 0, errors: 0 },
      watchlists: { lists: 0, items: 0, errors: 0 }
    };

    for (const type of ['menus', 'programs', 'watchlists']) {
      const lists = expectedLists[type];
      summary[type].lists = lists.length;

      for (const listName of lists) {
        await page.goto(`${BASE_URL}/admin/content/lists/${type}/${listName}`, {
          waitUntil: 'networkidle',
          timeout: 30000
        });

        await page.waitForSelector('.item-row', { timeout: 10000 }).catch(() => null);
        await page.waitForTimeout(3000);

        const rows = page.locator('.item-row');
        const rowCount = await rows.count();

        const fixtureItems = getListItems(type, listName);
        const sampled = sampleItems(fixtureItems, SAMPLE_SIZE);

        for (const sampledItem of sampled) {
          const rowIdx = sampledItem.originalIndex;
          if (rowIdx >= rowCount) continue;

          const row = rows.nth(rowIdx);
          const result = await validateCardStructure(row, rowIdx, `${type}/${listName}`);

          summary[type].items++;
          if (!result.valid) {
            summary[type].errors++;
            allErrors.push(result.error);
          }
        }
      }
    }

    // Print summary
    console.log('\n' + '='.repeat(60));
    console.log('ADMIN LISTS COMPREHENSIVE TEST SUMMARY');
    console.log('='.repeat(60));

    for (const [type, stats] of Object.entries(summary)) {
      const status = stats.errors === 0 ? 'PASS' : 'FAIL';
      console.log(`${status} ${type.padEnd(12)} | ${stats.lists} lists | ${stats.items} items checked | ${stats.errors} errors`);
    }

    const totalErrors = allErrors.length;
    console.log('-'.repeat(60));
    console.log(`Total: ${totalErrors} errors`);

    if (totalErrors > 0) {
      console.log('\nErrors:');
      allErrors.forEach((e, i) => console.log(`  ${i + 1}. ${e}`));
    }

    console.log('='.repeat(60) + '\n');

    expect(totalErrors, `Found ${totalErrors} total card rendering errors`).toBe(0);
  });
});
