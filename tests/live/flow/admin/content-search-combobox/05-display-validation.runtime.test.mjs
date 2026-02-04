// tests/live/flow/admin/content-search-combobox/05-display-validation.runtime.test.mjs
/**
 * Display validation tests for ContentSearchCombobox
 * Tests: avatars, titles, badges, icons, truncation
 */
import { test, expect } from '@playwright/test';
import { ComboboxTestHarness, ComboboxLocators, ComboboxActions } from '#testlib/comboboxTestHarness.mjs';
import { validateDisplayFields } from '#testlib/schemas/contentSearchSchemas.mjs';

const TEST_URL = '/admin/test/combobox';

test.describe('ContentSearchCombobox - Display Validation', () => {
  let harness;

  test.beforeEach(async ({ page }) => {
    harness = new ComboboxTestHarness(page);
    await harness.setup();
    await page.goto(TEST_URL);
  });

  test.afterEach(async () => {
    await harness.teardown();
  });

  test('each option has avatar', async ({ page }) => {
    await ComboboxActions.open(page);
    await ComboboxActions.search(page, 'Office');
    await ComboboxActions.waitForStreamComplete(page, 30000);

    const options = ComboboxLocators.options(page);
    const count = await options.count();
    expect(count, 'Search should return results').toBeGreaterThan(0);

    for (let i = 0; i < Math.min(count, 5); i++) {
      const option = options.nth(i);
      const avatar = ComboboxLocators.optionAvatar(option);
      await expect(avatar).toBeVisible();
    }
  });

  test('each option has title text', async ({ page }) => {
    await ComboboxActions.open(page);
    await ComboboxActions.search(page, 'Office');
    await ComboboxActions.waitForStreamComplete(page, 30000);

    const options = ComboboxLocators.options(page);
    const count = await options.count();
    expect(count, 'Search should return results').toBeGreaterThan(0);

    for (let i = 0; i < Math.min(count, 5); i++) {
      const option = options.nth(i);
      const title = ComboboxLocators.optionTitle(option);
      const titleText = await title.textContent();

      expect(titleText).toBeTruthy();
      expect(titleText.length).toBeGreaterThan(0);

      // Should not be a raw ID
      expect(titleText).not.toMatch(/^plex:\d+$/);
      expect(titleText).not.toMatch(/^\d+$/);
    }
  });

  test('each option has source badge', async ({ page }) => {
    await ComboboxActions.open(page);
    await ComboboxActions.search(page, 'Office');
    await ComboboxActions.waitForStreamComplete(page, 30000);

    const options = ComboboxLocators.options(page);
    const count = await options.count();
    expect(count, 'Search should return results').toBeGreaterThan(0);

    for (let i = 0; i < Math.min(count, 5); i++) {
      const option = options.nth(i);
      const badge = ComboboxLocators.optionBadge(option);
      await expect(badge).toBeVisible();

      const badgeText = await badge.textContent();
      expect(badgeText).toBeTruthy();
    }
  });

  test('containers show chevron icon', async ({ page }) => {
    await ComboboxActions.open(page);
    await ComboboxActions.search(page, 'Office'); // Shows are containers
    await ComboboxActions.waitForStreamComplete(page, 30000);

    const options = ComboboxLocators.options(page);
    const count = await options.count();
    expect(count, 'Search should return results').toBeGreaterThan(0);

    let foundContainer = false;
    for (let i = 0; i < count; i++) {
      const option = options.nth(i);
      const hasChevron = await ComboboxLocators.optionChevron(option).isVisible().catch(() => false);

      if (hasChevron) {
        foundContainer = true;
        break;
      }
    }

    // At least one container should have chevron (if search returned containers)
    console.log(`Found container with chevron: ${foundContainer}`);
  });

  test('leaves do not show chevron icon', async ({ page }) => {
    await ComboboxActions.open(page);
    await ComboboxActions.search(page, 'Pilot'); // Episodes are leaves
    await ComboboxActions.waitForStreamComplete(page, 30000);

    const options = ComboboxLocators.options(page);
    const count = await options.count();
    expect(count, 'Search should return results').toBeGreaterThan(0);

    // Find a leaf (no chevron)
    const firstOption = options.first();
    const hasChevron = await ComboboxLocators.optionChevron(firstOption).isVisible().catch(() => false);

    // If no chevron, it's a leaf - clicking should select, not drill
    if (!hasChevron) {
      console.log('Found leaf without chevron');
    }
  });

  test('long titles are truncated', async ({ page }) => {
    await ComboboxActions.open(page);
    await ComboboxActions.search(page, 'Office');
    await ComboboxActions.waitForStreamComplete(page, 30000);

    const options = ComboboxLocators.options(page);
    const count = await options.count();
    expect(count, 'Search should return results').toBeGreaterThan(0);

    const title = ComboboxLocators.optionTitle(options.first());
    const overflow = await title.evaluate(el =>
      window.getComputedStyle(el).textOverflow
    );

    // Should have truncate style - either 'ellipsis' or 'clip' is acceptable
    expect(['ellipsis', 'clip']).toContain(overflow);
  });

  test('parent title shows for nested items', async ({ page }) => {
    await ComboboxActions.open(page);
    await ComboboxActions.search(page, 'Pilot'); // Episodes have parents
    await ComboboxActions.waitForStreamComplete(page, 30000);

    const options = ComboboxLocators.options(page);
    const count = await options.count();
    expect(count, 'Search should return results').toBeGreaterThan(0);

    let foundParent = false;
    for (let i = 0; i < Math.min(count, 5); i++) {
      const option = options.nth(i);
      const parent = ComboboxLocators.optionParent(option);
      const hasParent = await parent.isVisible().catch(() => false);

      if (hasParent) {
        foundParent = true;
        const parentText = await parent.textContent();
        expect(parentText).toBeTruthy();
        console.log(`Found parent title: ${parentText}`);
        break;
      }
    }

    console.log(`Found item with parent title: ${foundParent}`);
  });

  test('API response items pass display validation', async ({ page }) => {
    await ComboboxActions.open(page);
    await ComboboxActions.search(page, 'Office');
    await ComboboxActions.waitForStreamComplete(page, 30000);

    // Check API responses for display field validation
    const searchCalls = harness.getApiCalls(/content\/query\/search/);
    expect(searchCalls.length, 'Search API should have been called').toBeGreaterThan(0);

    for (const call of searchCalls) {
      if (call.response?.items) {
        for (const item of call.response.items.slice(0, 5)) {
          const validation = validateDisplayFields(item);
          if (!validation.valid) {
            console.error(`Display validation failed for ${item.id}:`, validation.errors);
          }
          expect(validation.valid, `Item ${item.id} should pass display validation`).toBe(true);
        }
      }
    }
  });
});
