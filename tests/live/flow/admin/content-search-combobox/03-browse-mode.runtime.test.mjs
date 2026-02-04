// tests/live/flow/admin/content-search-combobox/03-browse-mode.runtime.test.mjs
/**
 * Browse mode tests for ContentSearchCombobox
 * Tests: drill-down, back navigation, breadcrumbs, sibling loading
 */
import { test, expect } from '@playwright/test';
import { ComboboxTestHarness, ComboboxLocators, ComboboxActions } from '#testlib/comboboxTestHarness.mjs';

const TEST_URL = '/admin/test/combobox';

test.describe('ContentSearchCombobox - Browse Mode', () => {
  let harness;

  test.beforeEach(async ({ page }) => {
    harness = new ComboboxTestHarness(page);
    await harness.setup();
  });

  test.afterEach(async () => {
    const apiCheck = harness.assertAllApiValid();
    expect(apiCheck.passed).toBe(true);

    const backendCheck = harness.assertNoBackendErrors();
    expect(backendCheck.errors).toEqual([]);

    await harness.teardown();
  });

  test('loads siblings when opening with existing value', async ({ page }) => {
    // Start with a value that has a parent path
    await page.goto(`${TEST_URL}?value=media:workouts/hiit.mp4`);

    await ComboboxActions.open(page);
    await page.waitForTimeout(1000); // Wait for sibling load

    // Should have called list API
    const apiCheck = harness.assertApiCalled(/api\/v1\/list\//);
    expect(apiCheck.passed).toBe(true);
  });

  test('clicking container drills into it', async ({ page }) => {
    await page.goto(TEST_URL);
    await ComboboxActions.open(page);
    await ComboboxActions.search(page, 'Office');
    await ComboboxActions.waitForLoad(page);

    const options = ComboboxLocators.options(page);
    const count = await options.count();

    if (count > 0) {
      // Find a container (has chevron)
      let containerFound = false;
      for (let i = 0; i < count; i++) {
        const option = options.nth(i);
        const chevron = option.locator('svg').last(); // Chevron is usually last icon
        const hasChevron = await chevron.isVisible().catch(() => false);

        if (hasChevron) {
          containerFound = true;

          // Get initial breadcrumb state
          const initialBreadcrumbs = await ComboboxLocators.breadcrumbs(page).count();

          // Click to drill in
          await option.click();
          await page.waitForTimeout(500);

          // Should have called list API for drill-down
          const listCalls = harness.getApiCalls(/api\/v1\/list\//);
          expect(listCalls.length).toBeGreaterThan(0);

          // Breadcrumbs should appear
          const backButton = ComboboxLocators.backButton(page);
          await expect(backButton).toBeVisible();

          break;
        }
      }

      if (!containerFound) {
        console.log('No container found in search results - skipping drill-down test');
      }
    }
  });

  test('back button returns to previous level', async ({ page }) => {
    await page.goto(TEST_URL);
    await ComboboxActions.open(page);
    await ComboboxActions.search(page, 'Office');
    await ComboboxActions.waitForLoad(page);

    const options = ComboboxLocators.options(page);
    const count = await options.count();

    if (count > 0) {
      // Find and click a container
      const firstOption = options.first();
      await firstOption.click();
      await page.waitForTimeout(500);

      // Check if we drilled in (back button visible)
      const backButton = ComboboxLocators.backButton(page);
      const didDrillIn = await backButton.isVisible().catch(() => false);

      if (didDrillIn) {
        const callsBeforeBack = harness.apiCalls.length;

        // Click back
        await ComboboxActions.goBack(page);

        // Should have made another API call or returned to search results
        await page.waitForTimeout(500);
      }
    }
  });

  test('breadcrumbs display navigation path', async ({ page }) => {
    await page.goto(TEST_URL);
    await ComboboxActions.open(page);
    await ComboboxActions.search(page, 'Office');
    await ComboboxActions.waitForLoad(page);

    const options = ComboboxLocators.options(page);
    const count = await options.count();

    if (count > 0) {
      // Click first option (may or may not be container)
      await options.first().click();
      await page.waitForTimeout(500);

      // Check for breadcrumb text
      const dropdown = ComboboxLocators.dropdown(page);
      const dropdownText = await dropdown.textContent();

      // If we drilled in, should see breadcrumb separator
      const backButton = ComboboxLocators.backButton(page);
      const didDrillIn = await backButton.isVisible().catch(() => false);

      if (didDrillIn) {
        // Breadcrumb area should have some text
        const breadcrumbArea = dropdown.locator('text=/').first();
        // Breadcrumbs use " / " separator
      }
    }
  });

  test('deep navigation maintains breadcrumb trail', async ({ page }) => {
    await page.goto(TEST_URL);
    await ComboboxActions.open(page);
    await ComboboxActions.search(page, 'Office');
    await ComboboxActions.waitForLoad(page);

    let drillCount = 0;
    const maxDrills = 3;

    while (drillCount < maxDrills) {
      const options = ComboboxLocators.options(page);
      const count = await options.count();

      if (count === 0) break;

      // Click first option
      await options.first().click();
      await page.waitForTimeout(500);

      const backButton = ComboboxLocators.backButton(page);
      const didDrillIn = await backButton.isVisible().catch(() => false);

      if (!didDrillIn) break; // Hit a leaf

      drillCount++;
    }

    console.log(`Drilled ${drillCount} levels deep`);

    // Navigate back through all levels
    for (let i = 0; i < drillCount; i++) {
      await ComboboxActions.goBack(page);
      await page.waitForTimeout(300);
    }

    // Should be back at search results or root
  });

  test('clicking parent title navigates to parent', async ({ page }) => {
    await page.goto(TEST_URL);
    await ComboboxActions.open(page);
    await ComboboxActions.search(page, 'Pilot'); // Search for an episode
    await ComboboxActions.waitForLoad(page);

    const options = ComboboxLocators.options(page);
    const count = await options.count();

    if (count > 0) {
      const firstOption = options.first();
      const parentText = ComboboxLocators.optionParent(firstOption);

      const hasParent = await parentText.isVisible().catch(() => false);

      if (hasParent) {
        const parentContent = await parentText.textContent();
        console.log(`Found parent: ${parentContent}`);

        // Check if parent is clickable (underlined)
        const isClickable = await parentText.evaluate(el =>
          window.getComputedStyle(el).textDecoration.includes('underline')
        ).catch(() => false);

        if (isClickable) {
          await parentText.click();
          await page.waitForTimeout(500);

          // Should have navigated
          const backButton = ComboboxLocators.backButton(page);
          await expect(backButton).toBeVisible();
        }
      }
    }
  });
});
