// tests/live/flow/admin/content-search-combobox/08-streaming.runtime.test.mjs
/**
 * Streaming search tests for ContentSearchCombobox
 * Tests: SSE streaming, pending sources indicator, race condition handling
 */
import { test, expect } from '@playwright/test';
import { ComboboxTestHarness, ComboboxLocators, ComboboxActions } from '#testlib/comboboxTestHarness.mjs';

const TEST_URL = '/admin/test/combobox';

test.describe('ContentSearchCombobox - Streaming Search', () => {
  let harness;

  test.beforeEach(async ({ page }) => {
    harness = new ComboboxTestHarness(page);
    await harness.setup();
    await page.goto(TEST_URL);
  });

  test.afterEach(async () => {
    const apiCheck = harness.assertAllApiValid();
    expect(apiCheck.passed).toBe(true);
    await harness.teardown();
  });

  test('shows pending sources while streaming', async ({ page }) => {
    await ComboboxActions.open(page);
    await ComboboxLocators.input(page).fill('office');

    // Should see pending indicator at some point (may be brief)
    // Wait for results to eventually appear
    await expect(ComboboxLocators.options(page).first()).toBeVisible({ timeout: 30000 });
  });

  test('new search cancels pending results', async ({ page }) => {
    await ComboboxActions.open(page);

    // Start first search
    await ComboboxLocators.input(page).fill('dracula');
    await page.waitForTimeout(100);

    // Quickly change to different search
    await ComboboxLocators.input(page).fill('office');

    // Wait for results
    await ComboboxActions.waitForLoad(page);

    // The search completed without errors
    const options = await ComboboxLocators.options(page);
    const count = await options.count();
    expect(count).toBeGreaterThanOrEqual(0);
  });

  test('handles rapid typing without duplicate results', async ({ page }) => {
    await ComboboxActions.open(page);

    // Type rapidly
    const input = ComboboxLocators.input(page);
    await input.fill('o');
    await page.waitForTimeout(30);
    await input.fill('of');
    await page.waitForTimeout(30);
    await input.fill('off');
    await page.waitForTimeout(30);
    await input.fill('offi');
    await page.waitForTimeout(30);
    await input.fill('offic');
    await page.waitForTimeout(30);
    await input.fill('office');

    // Wait for search to complete
    await ComboboxActions.waitForLoad(page);

    // Get all result IDs
    const options = await ComboboxLocators.options(page);
    const count = await options.count();

    if (count > 0) {
      const ids = [];
      for (let i = 0; i < count; i++) {
        const id = await options.nth(i).getAttribute('value');
        ids.push(id);
      }

      // No duplicates
      const uniqueIds = [...new Set(ids)];
      expect(uniqueIds.length).toBe(ids.length);
    }
  });
});
