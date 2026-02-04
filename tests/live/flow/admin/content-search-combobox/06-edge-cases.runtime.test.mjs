// tests/live/flow/admin/content-search-combobox/06-edge-cases.runtime.test.mjs
/**
 * Edge case tests for ContentSearchCombobox
 * Tests: special chars, unicode, errors, rapid input, deep nesting
 */
import { test, expect } from '@playwright/test';
import { ComboboxTestHarness, ComboboxLocators, ComboboxActions } from '#testlib/comboboxTestHarness.mjs';
import { EDGE_CASES } from '#fixtures/combobox/dynamicFixtureLoader.mjs';

const TEST_URL = '/admin/test/combobox';

test.describe('ContentSearchCombobox - Edge Cases', () => {
  let harness;

  test.beforeEach(async ({ page }) => {
    harness = new ComboboxTestHarness(page);
    await harness.setup();
    await page.goto(TEST_URL);
  });

  test.afterEach(async () => {
    const backendCheck = harness.assertNoBackendErrors();
    expect(backendCheck.errors).toEqual([]);
    await harness.teardown();
  });

  test('handles special HTML characters in search', async ({ page }) => {
    await ComboboxActions.open(page);
    await ComboboxActions.search(page, 'test & < > "quoted"');
    await ComboboxActions.waitForLoad(page);

    // Should not error, should show results or empty state
    const dropdown = ComboboxLocators.dropdown(page);
    await expect(dropdown).toBeVisible();

    // No XSS - check page doesn't have injected HTML
    const bodyHtml = await page.locator('body').innerHTML();
    expect(bodyHtml).not.toContain('<script');
  });

  test('handles unicode characters in search', async ({ page }) => {
    await ComboboxActions.open(page);
    await ComboboxActions.search(page, '日本語');
    await ComboboxActions.waitForLoad(page);

    // Should handle gracefully
    const dropdown = ComboboxLocators.dropdown(page);
    await expect(dropdown).toBeVisible();

    const apiCheck = harness.assertApiCalled(/content\/query\/search/);
    expect(apiCheck.passed).toBe(true);
  });

  test('handles emoji in search', async ({ page }) => {
    await ComboboxActions.open(page);
    await ComboboxActions.search(page, '🎬 movie');
    await ComboboxActions.waitForLoad(page);

    const dropdown = ComboboxLocators.dropdown(page);
    await expect(dropdown).toBeVisible();
  });

  test('handles very long search term', async ({ page }) => {
    await ComboboxActions.open(page);
    const longTerm = 'a'.repeat(200);
    await ComboboxActions.search(page, longTerm);
    await ComboboxActions.waitForLoad(page);

    // Should not crash, may show no results
    const dropdown = ComboboxLocators.dropdown(page);
    await expect(dropdown).toBeVisible();
  });

  test('handles rapid typing without duplicate calls', async ({ page }) => {
    await ComboboxActions.open(page);

    const input = ComboboxLocators.input(page);

    // Type very rapidly
    const chars = 'testing rapid input';
    for (const char of chars) {
      await input.press(char);
      await page.waitForTimeout(20); // Very fast
    }

    // Wait for debounce
    await page.waitForTimeout(500);

    // Should only have 1-2 API calls, not one per character
    const searchCalls = harness.getApiCalls(/content\/query\/search/);
    expect(searchCalls.length).toBeLessThan(5);
    console.log(`Rapid typing resulted in ${searchCalls.length} API calls`);
  });

  test('handles empty API response gracefully', async ({ page }) => {
    await ComboboxActions.open(page);
    await ComboboxActions.search(page, 'xyznonexistent123456789');
    await ComboboxActions.waitForLoad(page);

    const emptyState = ComboboxLocators.emptyState(page);
    await expect(emptyState).toContainText('No results');
  });

  test('handles whitespace-only search', async ({ page }) => {
    await ComboboxActions.open(page);
    await ComboboxActions.search(page, '   ');
    await page.waitForTimeout(500);

    // Should show "Type to search" (whitespace trimmed = empty)
    const emptyState = ComboboxLocators.emptyState(page);
    await expect(emptyState).toBeVisible();
  });

  test('handles value with special characters', async ({ page }) => {
    // URL encode special chars in value param
    await page.goto(`${TEST_URL}?value=media:path/with%20spaces/file.mp4`);

    const input = ComboboxLocators.input(page);
    const value = await input.inputValue();

    expect(value).toContain('path/with spaces/file.mp4');
  });

  test('handles API timeout gracefully', async ({ page }) => {
    // Slow down API responses
    await page.route('**/api/v1/content/query/search**', async (route) => {
      await new Promise(resolve => setTimeout(resolve, 3000));
      await route.continue();
    });

    await ComboboxActions.open(page);
    await ComboboxLocators.input(page).fill('test');

    // Should show loader
    const loader = ComboboxLocators.loader(page);
    await expect(loader).toBeVisible({ timeout: 1000 });
  });

  test('deep navigation does not crash', async ({ page }) => {
    await ComboboxActions.open(page);
    await ComboboxActions.search(page, 'Office');
    await ComboboxActions.waitForLoad(page);

    // Try to drill 5 levels deep
    for (let i = 0; i < 5; i++) {
      const options = ComboboxLocators.options(page);
      const count = await options.count();

      if (count === 0) break;

      await options.first().click();
      await page.waitForTimeout(500);

      const backButton = ComboboxLocators.backButton(page);
      const canGoDeeper = await backButton.isVisible().catch(() => false);

      if (!canGoDeeper) {
        console.log(`Stopped at depth ${i + 1} (hit leaf)`);
        break;
      }
    }

    // Should still be functional
    const dropdown = ComboboxLocators.dropdown(page);
    await expect(dropdown).toBeVisible();
  });

  test('selecting clears state properly', async ({ page }) => {
    await ComboboxActions.open(page);
    await ComboboxActions.search(page, 'Pilot');
    await ComboboxActions.waitForLoad(page);

    const options = ComboboxLocators.options(page);
    const count = await options.count();
    expect(count, 'Search should return results').toBeGreaterThan(0);

    await options.first().click();
    await page.waitForTimeout(500);

    // If we selected (not drilled), dropdown should be closed
    const dropdown = ComboboxLocators.dropdown(page);
    const isOpen = await dropdown.isVisible().catch(() => false);

    if (!isOpen) {
      // Reopen and search again - should start fresh
      await ComboboxActions.open(page);
      await ComboboxActions.search(page, 'Parks');
      await ComboboxActions.waitForLoad(page);

      // Should show new search results, no breadcrumbs from previous
      const backButton = ComboboxLocators.backButton(page);
      const hasBreadcrumbs = await backButton.isVisible().catch(() => false);
      expect(hasBreadcrumbs).toBe(false);
    }
  });
});
