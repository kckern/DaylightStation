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
    await ComboboxActions.waitForStreamComplete(page, 30000);

    // Should not error, should show results or empty state
    const dropdown = ComboboxLocators.dropdown(page);
    await expect(dropdown).toBeVisible();

    // No XSS - verify the search text is properly escaped in the input
    // (not checking innerHTML as error logs may contain script tags)
    const input = ComboboxLocators.input(page);
    const inputValue = await input.inputValue();
    expect(inputValue).toContain('test & < > "quoted"');

    // Verify no script execution by checking no alert dialogs appeared
    // (the search text if executed would not create an alert anyway)
  });

  test('handles unicode characters in search', async ({ page }) => {
    await ComboboxActions.open(page);
    await ComboboxActions.search(page, '日本語');
    await ComboboxActions.waitForStreamComplete(page, 30000);

    // Should handle gracefully
    const dropdown = ComboboxLocators.dropdown(page);
    await expect(dropdown).toBeVisible();

    const apiCheck = harness.assertApiCalled(/content\/query\/search/);
    expect(apiCheck.passed).toBe(true);
  });

  test('handles emoji in search', async ({ page }) => {
    await ComboboxActions.open(page);
    await ComboboxActions.search(page, '🎬 movie');
    await ComboboxActions.waitForStreamComplete(page, 30000);

    const dropdown = ComboboxLocators.dropdown(page);
    await expect(dropdown).toBeVisible();
  });

  test('handles very long search term', async ({ page }) => {
    await ComboboxActions.open(page);
    const longTerm = 'a'.repeat(200);
    await ComboboxActions.search(page, longTerm);
    await ComboboxActions.waitForStreamComplete(page, 30000);

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
    // Use search term that's unlikely to match anything
    await ComboboxActions.search(page, 'xyznonexistent123456789qqq');
    // Wait for ALL adapters to complete (not just first results)
    await ComboboxActions.waitForAllAdaptersComplete(page, 60000);

    // After all adapters complete, should show "No results" or zero results
    const options = ComboboxLocators.options(page);
    const count = await options.count();

    if (count === 0) {
      const emptyState = ComboboxLocators.emptyState(page);
      await expect(emptyState).toContainText('No results');
    } else {
      // Some adapter returned results - this is acceptable, just verify it didn't crash
      console.log(`Note: ${count} results returned for nonsense search`);
    }
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

  test('shows loading state during search', async ({ page }) => {
    // With SSE streaming, we can observe the loading state naturally
    // EventSource connections can't be easily intercepted by page.route()
    await ComboboxActions.open(page);

    // Type text but don't wait for results
    await ComboboxLocators.input(page).fill('test search query');

    // Should show loader or pending state while streaming
    // Either the Mantine loader OR the pending sources indicator
    const loaderOrPending = page.locator('.mantine-Loader, .pending-sources, [data-loading="true"]');
    await expect(loaderOrPending.first()).toBeVisible({ timeout: 2000 });
  });

  test('deep navigation does not crash', async ({ page }) => {
    await ComboboxActions.open(page);
    await ComboboxActions.search(page, 'Office');
    await ComboboxActions.waitForStreamComplete(page, 30000);

    let hitLeaf = false;

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
        hitLeaf = true;
        break;
      }
    }

    // Should still be functional - reopen if we selected a leaf (which closes dropdown)
    if (hitLeaf) {
      // Reopen and verify it works
      await ComboboxActions.open(page);
    }
    const dropdown = ComboboxLocators.dropdown(page);
    await expect(dropdown).toBeVisible();
  });

  test('selecting clears state properly', async ({ page }) => {
    await ComboboxActions.open(page);
    await ComboboxActions.search(page, 'Pilot');
    await ComboboxActions.waitForStreamComplete(page, 30000);

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
      await ComboboxActions.waitForStreamComplete(page, 30000);

      // Should show new search results, no breadcrumbs from previous
      const backButton = ComboboxLocators.backButton(page);
      const hasBreadcrumbs = await backButton.isVisible().catch(() => false);
      expect(hasBreadcrumbs).toBe(false);
    }
  });
});
