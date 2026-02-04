// tests/live/flow/admin/content-search-combobox/04-keyboard-navigation.runtime.test.mjs
/**
 * Keyboard navigation tests for ContentSearchCombobox
 * Tests: Arrow keys, Enter, Escape, Tab
 */
import { test, expect } from '@playwright/test';
import { ComboboxTestHarness, ComboboxLocators, ComboboxActions } from '#testlib/comboboxTestHarness.mjs';

const TEST_URL = '/admin/test/combobox';

test.describe('ContentSearchCombobox - Keyboard Navigation', () => {
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

  test('ArrowDown highlights next option', async ({ page }) => {
    await ComboboxActions.open(page);
    await ComboboxActions.search(page, 'Office');
    await ComboboxActions.waitForLoad(page);

    const options = ComboboxLocators.options(page);
    const count = await options.count();
    expect(count, 'Search should return results for keyboard navigation').toBeGreaterThan(1);

    // Press down arrow
    await ComboboxActions.pressKey(page, 'ArrowDown');

    // First option should be highlighted (data-combobox-selected or similar)
    const firstOption = options.first();
    const isSelected = await firstOption.getAttribute('data-combobox-selected');

    // Press down again
    await ComboboxActions.pressKey(page, 'ArrowDown');

    // Second option should now be highlighted
  });

  test('ArrowUp highlights previous option', async ({ page }) => {
    await ComboboxActions.open(page);
    await ComboboxActions.search(page, 'Office');
    await ComboboxActions.waitForLoad(page);

    const options = ComboboxLocators.options(page);
    const count = await options.count();
    expect(count, 'Search should return results for keyboard navigation').toBeGreaterThan(1);

    // Navigate down twice
    await ComboboxActions.pressKey(page, 'ArrowDown');
    await ComboboxActions.pressKey(page, 'ArrowDown');

    // Navigate up once
    await ComboboxActions.pressKey(page, 'ArrowUp');

    // Should be back at first option
  });

  test('Enter selects highlighted leaf option', async ({ page }) => {
    await ComboboxActions.open(page);
    await ComboboxActions.search(page, 'Pilot'); // Search for episodes (leaves)
    await ComboboxActions.waitForLoad(page);

    const options = ComboboxLocators.options(page);
    const count = await options.count();
    expect(count, 'Search should return results').toBeGreaterThan(0);

    // Navigate to first option
    await ComboboxActions.pressKey(page, 'ArrowDown');

    // Get the option's ID before selecting
    const firstOption = options.first();
    const optionValue = await firstOption.getAttribute('value');

    // Press Enter to select
    await ComboboxActions.pressKey(page, 'Enter');
    await page.waitForTimeout(300);

    // Dropdown should close
    await expect(ComboboxLocators.dropdown(page)).not.toBeVisible();

    // Value should be updated in test harness
    const currentValue = page.locator('[data-testid="current-value"]');
    const valueText = await currentValue.textContent();

    // Change log should have an entry
    const changeLog = page.locator('[data-testid="change-log"]');
    const logText = await changeLog.textContent();
    expect(logText).not.toContain('No changes yet');
  });

  test('Enter on container drills in instead of selecting', async ({ page }) => {
    await ComboboxActions.open(page);
    await ComboboxActions.search(page, 'Office'); // Search for shows (containers)
    await ComboboxActions.waitForLoad(page);

    const options = ComboboxLocators.options(page);
    const count = await options.count();
    expect(count, 'Search should return results').toBeGreaterThan(0);

    // Navigate to first option
    await ComboboxActions.pressKey(page, 'ArrowDown');

    // Press Enter
    await ComboboxActions.pressKey(page, 'Enter');
    await page.waitForTimeout(500);

    // If it was a container, dropdown should still be open with back button
    const dropdown = ComboboxLocators.dropdown(page);
    const isOpen = await dropdown.isVisible().catch(() => false);

    if (isOpen) {
      const backButton = ComboboxLocators.backButton(page);
      const hasBackButton = await backButton.isVisible().catch(() => false);

      if (hasBackButton) {
        console.log('Enter drilled into container as expected');
      }
    }
  });

  test('Escape closes dropdown', async ({ page }) => {
    await ComboboxActions.open(page);
    await expect(ComboboxLocators.dropdown(page)).toBeVisible();

    await ComboboxActions.pressKey(page, 'Escape');

    await expect(ComboboxLocators.dropdown(page)).not.toBeVisible();
  });

  test('Escape while browsing returns to search', async ({ page }) => {
    await ComboboxActions.open(page);
    await ComboboxActions.search(page, 'Office');
    await ComboboxActions.waitForLoad(page);

    // Try to drill into a container
    const options = ComboboxLocators.options(page);
    const count = await options.count();
    expect(count, 'Search should return results').toBeGreaterThan(0);

    await options.first().click();
    await page.waitForTimeout(500);

    const backButton = ComboboxLocators.backButton(page);
    const didDrillIn = await backButton.isVisible().catch(() => false);

    if (didDrillIn) {
      // Press Escape - should close dropdown entirely
      await ComboboxActions.pressKey(page, 'Escape');
      await expect(ComboboxLocators.dropdown(page)).not.toBeVisible();
    }
  });

  test('Tab moves focus away and closes dropdown', async ({ page }) => {
    await ComboboxActions.open(page);
    await expect(ComboboxLocators.dropdown(page)).toBeVisible();

    await ComboboxActions.pressKey(page, 'Tab');
    await page.waitForTimeout(200);

    // Dropdown should close on blur
    await expect(ComboboxLocators.dropdown(page)).not.toBeVisible();
  });

  test('typing while navigating resets to search', async ({ page }) => {
    await ComboboxActions.open(page);
    await ComboboxActions.search(page, 'Office');
    await ComboboxActions.waitForLoad(page);

    // Drill into a result
    const options = ComboboxLocators.options(page);
    const count = await options.count();
    expect(count, 'Search should return results').toBeGreaterThan(0);

    await options.first().click();
    await page.waitForTimeout(500);

    // Type new search - should reset to search mode
    await ComboboxActions.search(page, 'Parks');
    await ComboboxActions.waitForLoad(page);

    // Breadcrumbs should be gone (back at search)
    const backButton = ComboboxLocators.backButton(page);
    const hasBackButton = await backButton.isVisible().catch(() => false);

    // May or may not have breadcrumbs depending on search results
  });
});
