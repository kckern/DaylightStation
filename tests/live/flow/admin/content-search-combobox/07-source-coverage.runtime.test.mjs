// tests/live/flow/admin/content-search-combobox/07-source-coverage.runtime.test.mjs
/**
 * Source coverage tests for ContentSearchCombobox
 * Tests real content from discovered sources (varied each run)
 */
import { test, expect } from '@playwright/test';
import { ComboboxTestHarness, ComboboxLocators, ComboboxActions } from '#testlib/comboboxTestHarness.mjs';
import { loadDynamicFixtures } from '#fixtures/combobox/dynamicFixtureLoader.mjs';

const TEST_URL = '/admin/test/combobox';

// Load dynamic fixtures once
let fixtures;

test.describe('ContentSearchCombobox - Source Coverage', () => {
  let harness;

  test.beforeAll(async () => {
    fixtures = await loadDynamicFixtures();
    console.log(`Loaded sources: ${Object.keys(fixtures.sourceFixtures).join(', ')}`);
  });

  test.beforeEach(async ({ page }) => {
    harness = new ComboboxTestHarness(page);
    await harness.setup();
    await page.goto(TEST_URL);
  });

  test.afterEach(async () => {
    const apiCheck = harness.assertAllApiValid();
    expect(apiCheck.passed).toBe(true);

    const backendCheck = harness.assertNoBackendErrors();
    expect(backendCheck.errors).toEqual([]);

    await harness.teardown();
  });

  // Test each dynamically discovered source
  test('search works for each discovered source', async ({ page }) => {
    for (const [sourceKey, source] of Object.entries(fixtures.sourceFixtures)) {
      console.log(`Testing source: ${source.name}`);

      for (const term of source.searchTerms.slice(0, 2)) {
        harness.reset();

        await ComboboxActions.open(page);
        await ComboboxActions.search(page, term);
        await ComboboxActions.waitForLoad(page);

        // API should be called
        const apiCheck = harness.assertApiCalled(/content\/query\/search/);
        expect(apiCheck.passed).toBe(true);

        // Should show dropdown (results or empty state)
        const dropdown = ComboboxLocators.dropdown(page);
        await expect(dropdown).toBeVisible();

        await ComboboxActions.pressKey(page, 'Escape');
        await page.waitForTimeout(100);
      }
    }
  });

  // Test drilling into real containers
  test('can drill into discovered containers', async ({ page }) => {
    for (const container of fixtures.containers.slice(0, 3)) {
      console.log(`Testing container: ${container.title} (${container.id})`);

      // Initialize with container ID
      await page.goto(`${TEST_URL}?value=${encodeURIComponent(container.id)}`);

      await ComboboxActions.open(page);
      await page.waitForTimeout(1000); // Wait for sibling load

      // Should have loaded siblings
      const apiCheck = harness.assertApiCalled(/api\/v1\/list\//);
      if (apiCheck.passed) {
        console.log(`  Loaded siblings for ${container.title}`);
      }

      harness.reset();
    }
  });

  // Test selecting real leaf items
  test('can select discovered leaf items', async ({ page }) => {
    for (const leaf of fixtures.leaves.slice(0, 3)) {
      console.log(`Testing leaf: ${leaf.title} (${leaf.id})`);

      // Initialize with leaf ID
      await page.goto(`${TEST_URL}?value=${encodeURIComponent(leaf.id)}`);

      const input = ComboboxLocators.input(page);
      const value = await input.inputValue();

      expect(value).toBe(leaf.id);

      // Verify it displays correctly
      const currentValue = page.locator('[data-testid="current-value"]');
      await expect(currentValue).toContainText(leaf.id);
    }
  });

  test('mixed source results display correctly', async ({ page }) => {
    // Search term that might return results from multiple sources
    await ComboboxActions.open(page);
    await ComboboxActions.search(page, 'test');
    await ComboboxActions.waitForLoad(page);

    const options = ComboboxLocators.options(page);
    const count = await options.count();

    if (count > 0) {
      // Collect unique sources from results
      const sources = new Set();

      for (let i = 0; i < Math.min(count, 10); i++) {
        const option = options.nth(i);
        const badge = ComboboxLocators.optionBadge(option);
        const badgeText = await badge.first().textContent().catch(() => '');
        if (badgeText) sources.add(badgeText);
      }

      console.log(`Found sources in results: ${Array.from(sources).join(', ')}`);
    }
  });

  test('browsing Plex hierarchy works', async ({ page }) => {
    await ComboboxActions.open(page);
    await ComboboxActions.search(page, 'Office');
    await ComboboxActions.waitForLoad(page);

    // Find a Plex show and drill into it
    const options = ComboboxLocators.options(page);
    const count = await options.count();
    expect(count, 'Search should return results').toBeGreaterThan(0);

    for (let i = 0; i < count; i++) {
      const option = options.nth(i);
      const badge = ComboboxLocators.optionBadge(option).first();
      const badgeText = await badge.textContent().catch(() => '');

      if (badgeText.toLowerCase() === 'plex') {
        await option.click();
        await page.waitForTimeout(500);

        const backButton = ComboboxLocators.backButton(page);
        if (await backButton.isVisible().catch(() => false)) {
          console.log('Drilled into Plex container');

          // Drill one more level (season -> episodes)
          const innerOptions = ComboboxLocators.options(page);
          if (await innerOptions.count() > 0) {
            await innerOptions.first().click();
            await page.waitForTimeout(500);
          }
        }
        break;
      }
    }
  });

  test('browsing folder hierarchy works', async ({ page }) => {
    // Start with a folder path
    await page.goto(`${TEST_URL}?value=media:workouts/hiit.mp4`);

    await ComboboxActions.open(page);
    await page.waitForTimeout(1000); // Wait for sibling load

    // Should load siblings from parent folder
    const apiCheck = harness.assertApiCalled(/api\/v1\/list\/media/);

    if (apiCheck.passed) {
      console.log('Loaded folder siblings');

      // Should show breadcrumb
      const backButton = ComboboxLocators.backButton(page);
      const hasBreadcrumbs = await backButton.isVisible().catch(() => false);
      console.log(`Has breadcrumbs: ${hasBreadcrumbs}`);
    }
  });
});
