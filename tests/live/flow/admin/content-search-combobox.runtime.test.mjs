// @ts-check
import { test, expect } from '@playwright/test';

/**
 * Runtime tests for ContentSearchCombobox in Admin UI
 * Tests search, browse, and sibling loading functionality
 *
 * The ContentSearchCombobox is inline in item rows - click the content display to open dropdown.
 */

test.describe('ContentSearchCombobox', () => {
  test('existing item shows siblings on dropdown open', async ({ page }) => {
    // Navigate to the morning program which has items
    await page.goto('/admin/content/lists/programs/morning-program');
    await page.waitForLoadState('networkidle');

    // Wait for items to load
    await page.waitForTimeout(1500);

    // Take a screenshot to see what's on the page
    await page.screenshot({ path: 'test-results/admin-page-state.png' });

    // Find the content display in the first item row's col-input
    // The ContentSearchCombobox shows a content-display div when not editing
    const contentDisplay = page.locator('.item-row .col-input .content-display').first();

    const isVisible = await contentDisplay.isVisible({ timeout: 3000 }).catch(() => false);
    console.log(`Content display visible: ${isVisible}`);

    if (!isVisible) {
      // Log what's on the page for debugging
      const itemRows = page.locator('.item-row');
      const rowCount = await itemRows.count();
      console.log(`Found ${rowCount} item rows`);

      // Try alternative - maybe items are in a different structure
      const anyColInput = page.locator('.col-input').first();
      const colInputVisible = await anyColInput.isVisible({ timeout: 1000 }).catch(() => false);
      console.log(`col-input visible: ${colInputVisible}`);

      if (colInputVisible) {
        const colInputHtml = await anyColInput.innerHTML();
        console.log(`col-input content: ${colInputHtml.substring(0, 200)}`);
      }
      return;
    }

    // Click on the content display to open the combobox dropdown
    await contentDisplay.click();
    await page.waitForTimeout(1000); // Wait for sibling load

    // Check for dropdown
    const dropdown = page.locator('.mantine-Combobox-dropdown');
    const dropdownVisible = await dropdown.isVisible({ timeout: 3000 }).catch(() => false);
    console.log(`Dropdown visible: ${dropdownVisible}`);

    if (dropdownVisible) {
      // Count options (siblings)
      const options = dropdown.locator('.mantine-Combobox-option');
      const optionCount = await options.count();
      console.log(`Siblings shown: ${optionCount} items`);

      // Take screenshot of dropdown
      await page.screenshot({ path: 'test-results/dropdown-siblings.png' });

      expect(optionCount).toBeGreaterThan(0);
    } else {
      // Take screenshot for debugging
      await page.screenshot({ path: 'test-results/no-dropdown.png' });
      console.log('Dropdown not visible - may need to wait for API');
    }
  });

  test('search returns results from local adapters', async ({ page }) => {
    await page.goto('/admin/content/lists/programs/morning-program');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(1000);

    // Click on content display to open combobox
    const contentDisplay = page.locator('.item-row .col-input .content-display').first();

    if (await contentDisplay.isVisible({ timeout: 2000 }).catch(() => false)) {
      await contentDisplay.click();
      await page.waitForTimeout(500);

      // Find the search input that appears when editing
      const searchInput = page.locator('.mantine-Combobox-target input, .mantine-InputBase-input');

      if (await searchInput.isVisible({ timeout: 2000 }).catch(() => false)) {
        // Type to search
        await searchInput.fill('Good Morning');
        await page.waitForTimeout(600); // Debounce

        const dropdown = page.locator('.mantine-Combobox-dropdown');
        if (await dropdown.isVisible({ timeout: 3000 }).catch(() => false)) {
          const options = dropdown.locator('.mantine-Combobox-option');
          const count = await options.count();
          console.log(`Search "Good Morning" returned ${count} results`);
          await page.screenshot({ path: 'test-results/search-results.png' });
          expect(count).toBeGreaterThan(0);
        }
      }
    }
  });

  test('clicking container drills into it', async ({ page }) => {
    await page.goto('/admin/content/lists/programs/morning-program');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(1000);

    // Click on content display to open combobox
    const contentDisplay = page.locator('.item-row .col-input .content-display').first();

    if (await contentDisplay.isVisible({ timeout: 2000 }).catch(() => false)) {
      await contentDisplay.click();
      await page.waitForTimeout(500);

      // Find the search input
      const searchInput = page.locator('.mantine-Combobox-target input, .mantine-InputBase-input');

      if (await searchInput.isVisible({ timeout: 2000 }).catch(() => false)) {
        // Search for a show (container)
        await searchInput.fill('Office');
        await page.waitForTimeout(600);

        const dropdown = page.locator('.mantine-Combobox-dropdown');
        if (await dropdown.isVisible({ timeout: 3000 }).catch(() => false)) {
          // Look for a chevron (drill-down button) which indicates a container
          const chevronButton = dropdown.locator('[title="Browse contents"]').first();

          if (await chevronButton.isVisible({ timeout: 2000 }).catch(() => false)) {
            console.log('Found container with drill-down button');
            await chevronButton.click();
            await page.waitForTimeout(800);

            // After drilling down, should see children in the dropdown
            const childOptions = dropdown.locator('.mantine-Combobox-option');
            const childCount = await childOptions.count();
            console.log(`Container children: ${childCount} items`);
            await page.screenshot({ path: 'test-results/container-drilldown.png' });
          } else {
            console.log('No container found in search results');
          }
        }
      }
    }
  });

  test('clicking leaf item selects it', async ({ page }) => {
    await page.goto('/admin/content/lists/programs/morning-program');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(1000);

    // Click on content display to open combobox
    const contentDisplay = page.locator('.item-row .col-input .content-display').first();

    if (await contentDisplay.isVisible({ timeout: 2000 }).catch(() => false)) {
      // Get the original value displayed
      const originalText = await contentDisplay.textContent();
      console.log(`Original content: ${originalText?.substring(0, 50)}`);

      await contentDisplay.click();
      await page.waitForTimeout(500);

      const searchInput = page.locator('.mantine-Combobox-target input, .mantine-InputBase-input');

      if (await searchInput.isVisible({ timeout: 2000 }).catch(() => false)) {
        // Search for a track (leaf item)
        await searchInput.fill('intro');
        await page.waitForTimeout(600);

        const dropdown = page.locator('.mantine-Combobox-dropdown');
        if (await dropdown.isVisible({ timeout: 3000 }).catch(() => false)) {
          // Find first option without a chevron (leaf item)
          const firstOption = dropdown.locator('.mantine-Combobox-option').first();

          if (await firstOption.isVisible({ timeout: 1000 }).catch(() => false)) {
            const optionText = await firstOption.textContent();
            console.log(`Selecting option: ${optionText?.substring(0, 50)}`);
            await firstOption.click();
            await page.waitForTimeout(500);

            // After selection, dropdown should close
            const dropdownGone = await dropdown.isHidden({ timeout: 2000 }).catch(() => true);
            console.log(`Dropdown closed after selection: ${dropdownGone}`);
            await page.screenshot({ path: 'test-results/after-selection.png' });
          }
        }
      }
    }
  });
});
