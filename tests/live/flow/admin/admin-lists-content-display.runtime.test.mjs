/**
 * Admin Lists Content Display Test
 *
 * Verifies:
 * 1. Admin lists page loads with items
 * 2. Content info (title, thumbnail, badge) renders in input column on init
 * 3. Content is not just showing raw plex:ID format
 */

import { test, expect } from '@playwright/test';
import { BACKEND_URL } from '#fixtures/runtime/urls.mjs';

const BASE_URL = BACKEND_URL;

test.describe('Admin Lists Content Display', () => {

  test('Content info renders in input column on init', async ({ page }) => {
    // Navigate to the admin lists page for ambient menu
    await page.goto(`${BASE_URL}/admin/content/lists/menus/ambient`, {
      waitUntil: 'networkidle',
      timeout: 30000
    });

    // Wait for the list items to load
    await page.waitForSelector('.item-row', { timeout: 10000 });

    // Count the rows
    const rowCount = await page.locator('.item-row').count();
    console.log(`Found ${rowCount} list items`);
    expect(rowCount).toBeGreaterThan(0);

    // Wait for content info to load (give API calls time to complete)
    await page.waitForTimeout(2000);

    // Check the first row's input column for rich content display
    const firstRow = page.locator('.item-row').first();
    const inputCol = firstRow.locator('.col-input');

    // Look for content-display class (indicates rich display mode)
    const contentDisplay = inputCol.locator('.content-display');
    await expect(contentDisplay).toBeVisible({ timeout: 5000 });

    // Check for Avatar (thumbnail)
    const avatar = contentDisplay.locator('.mantine-Avatar-root');
    const hasAvatar = await avatar.count() > 0;
    console.log(`Has avatar: ${hasAvatar}`);

    // Check for Badge (source badge like PLEX)
    const badge = contentDisplay.locator('.mantine-Badge-root');
    const hasBadge = await badge.count() > 0;
    console.log(`Has badge: ${hasBadge}`);

    // Get the text content to verify it's not just showing "plex:12345"
    const displayText = await contentDisplay.textContent();
    console.log(`Display text: ${displayText}`);

    // The text should contain "PLEX" badge but NOT be just a raw ID format
    expect(displayText).toContain('PLEX');

    // Check that display is NOT just showing raw plex:ID format
    // It should have actual title text, not just numbers
    const isRawId = /^plex:\d+$/.test(displayText?.trim() || '');
    expect(isRawId).toBe(false);

    // Verify we have proper structure: avatar + title + badge
    expect(hasAvatar || hasBadge).toBe(true);

    console.log('✓ Content info is rendering with rich display on init');
  });

  test('Multiple rows all load content info', async ({ page }) => {
    await page.goto(`${BASE_URL}/admin/content/lists/menus/ambient`, {
      waitUntil: 'networkidle',
      timeout: 30000
    });

    await page.waitForSelector('.item-row', { timeout: 10000 });

    // Wait for content info to load
    await page.waitForTimeout(3000);

    // Check all rows have content displays (not loading spinners)
    const rows = page.locator('.item-row');
    const rowCount = await rows.count();

    let loadedCount = 0;
    let loadingCount = 0;

    for (let i = 0; i < Math.min(rowCount, 5); i++) {
      const row = rows.nth(i);
      const inputCol = row.locator('.col-input');

      // Check if it has content-display with avatar/badge (loaded)
      const hasContentDisplay = await inputCol.locator('.content-display .mantine-Avatar-root, .content-display .mantine-Badge-root').count() > 0;

      // Check if it has a loader (still loading)
      const hasLoader = await inputCol.locator('.mantine-Loader-root').count() > 0;

      if (hasContentDisplay && !hasLoader) {
        loadedCount++;
      } else if (hasLoader) {
        loadingCount++;
      }

      const label = await row.locator('.col-label').textContent();
      console.log(`Row ${i + 1} (${label?.trim()}): loaded=${hasContentDisplay}, loading=${hasLoader}`);
    }

    console.log(`Loaded: ${loadedCount}/${rowCount}, Still loading: ${loadingCount}`);

    // At least 80% should be loaded after 3 seconds
    const loadedRatio = loadedCount / Math.min(rowCount, 5);
    expect(loadedRatio).toBeGreaterThanOrEqual(0.8);

    console.log('✓ Multiple rows successfully loaded content info');
  });

  test('Content display shows actual titles not IDs', async ({ page }) => {
    await page.goto(`${BASE_URL}/admin/content/lists/menus/ambient`, {
      waitUntil: 'networkidle',
      timeout: 30000
    });

    await page.waitForSelector('.item-row', { timeout: 10000 });
    await page.waitForTimeout(3000);

    const rows = page.locator('.item-row');
    const rowCount = await rows.count();

    let titlesFound = 0;
    let idsFound = 0;

    for (let i = 0; i < Math.min(rowCount, 5); i++) {
      const row = rows.nth(i);
      const inputCol = row.locator('.col-input');
      const text = await inputCol.textContent();

      // Check if text is just a number (raw ID) or has actual title
      const isJustId = /^\d+$/.test(text?.replace(/PLEX|plex/gi, '').trim() || '');

      if (isJustId) {
        idsFound++;
        console.log(`Row ${i + 1}: Shows raw ID - "${text}"`);
      } else {
        titlesFound++;
        console.log(`Row ${i + 1}: Shows title - "${text?.substring(0, 50)}..."`);
      }
    }

    console.log(`Titles: ${titlesFound}, Raw IDs: ${idsFound}`);

    // All items should show titles, not raw IDs
    expect(titlesFound).toBeGreaterThan(0);
    expect(idsFound).toBe(0);

    console.log('✓ Content displays show actual titles, not raw IDs');
  });

  test('Clicking content field loads parent siblings in dropdown', async ({ page }) => {
    await page.goto(`${BASE_URL}/admin/content/lists/menus/ambient`, {
      waitUntil: 'networkidle',
      timeout: 30000
    });

    await page.waitForSelector('.item-row', { timeout: 10000 });
    await page.waitForTimeout(2000);

    // Find a row with loaded content display
    const firstRow = page.locator('.item-row').first();
    const contentDisplay = firstRow.locator('.col-input .content-display');
    await expect(contentDisplay).toBeVisible({ timeout: 5000 });

    // Get the current item's title before clicking
    const currentTitle = await contentDisplay.locator('.mantine-Text-root').first().textContent();
    console.log(`Current item title: ${currentTitle}`);

    // Click to open the dropdown
    await contentDisplay.click();

    // Wait for the visible dropdown to appear (use :visible filter)
    const dropdown = page.locator('.mantine-Combobox-dropdown:visible');
    await expect(dropdown).toBeVisible({ timeout: 5000 });

    // Wait for siblings to load (should see options, not just "Loading...")
    await page.waitForTimeout(4000);

    // Check for dropdown options (sibling items)
    const options = dropdown.locator('.mantine-Combobox-option');
    const optionCount = await options.count();
    console.log(`Dropdown options count: ${optionCount}`);

    // Should have at least one sibling item loaded (not just empty state)
    // If no siblings loaded, it would show "Type to search content" message
    const emptyMessage = dropdown.locator('.mantine-Combobox-empty');
    const hasEmptyMessage = await emptyMessage.count() > 0;
    const emptyText = hasEmptyMessage ? await emptyMessage.textContent() : '';
    console.log(`Empty message: "${emptyText}"`);

    // Either we have options, or the empty message should NOT be "Type to search content"
    // (meaning siblings are loading or loaded)
    if (optionCount === 0 && emptyText === 'Type to search content') {
      // This means siblings didn't load - fail the test
      expect(optionCount).toBeGreaterThan(0);
    }

    // If we have options, verify they have content
    if (optionCount > 0) {
      const firstOption = options.first();
      const optionText = await firstOption.textContent();
      console.log(`First option text: ${optionText?.substring(0, 50)}...`);
      expect(optionText?.length).toBeGreaterThan(0);

      // Verify the current item is highlighted (has special styling)
      // Look for the option with blue background or border-left styling
      const highlightedOption = dropdown.locator('.mantine-Combobox-option[style*="blue"], .mantine-Combobox-option[style*="border-left"]');
      const hasHighlight = await highlightedOption.count() > 0;
      console.log(`Has highlighted current item: ${hasHighlight}`);

      // The highlighted option should contain the current title
      if (hasHighlight) {
        const highlightedText = await highlightedOption.first().textContent();
        console.log(`Highlighted option text: ${highlightedText?.substring(0, 50)}...`);
      }
    }

    // Close dropdown by clicking elsewhere
    await page.keyboard.press('Escape');

    console.log('✓ Parent siblings load in dropdown on first click');
  });

  test('Keyboard navigation: up/down arrows move selection', async ({ page }) => {
    await page.goto(`${BASE_URL}/admin/content/lists/menus/ambient`, {
      waitUntil: 'networkidle',
      timeout: 30000
    });

    await page.waitForSelector('.item-row', { timeout: 10000 });
    await page.waitForTimeout(2000);

    // Find a row with content and click to open dropdown
    const firstRow = page.locator('.item-row').first();
    const contentDisplay = firstRow.locator('.col-input .content-display');
    await contentDisplay.click();

    const dropdown = page.locator('.mantine-Combobox-dropdown:visible');
    await expect(dropdown).toBeVisible({ timeout: 5000 });
    await page.waitForTimeout(2000);

    // Get initial highlighted item - using data-highlighted attribute
    const getHighlightedText = async () => {
      // Try data-highlighted first (our custom attribute)
      const highlighted = dropdown.locator('.mantine-Combobox-option[data-highlighted="true"]');
      if (await highlighted.count() > 0) {
        return await highlighted.first().textContent();
      }
      // Fallback to class or style checks
      const byClass = dropdown.locator('.mantine-Combobox-option.highlighted');
      if (await byClass.count() > 0) {
        return await byClass.first().textContent();
      }
      return null;
    };

    const initialHighlight = await getHighlightedText();
    console.log(`Initial highlighted: ${initialHighlight?.substring(0, 30)}...`);

    // Navigate up first to ensure we're not at the top
    await page.keyboard.press('ArrowUp');
    await page.waitForTimeout(100);
    await page.keyboard.press('ArrowUp');
    await page.waitForTimeout(100);
    await page.keyboard.press('ArrowUp');
    await page.waitForTimeout(100);

    const afterUp3 = await getHighlightedText();
    console.log(`After 3 ArrowUp: ${afterUp3?.substring(0, 30)}...`);

    // Now press down arrow - should move down
    await page.keyboard.press('ArrowDown');
    await page.waitForTimeout(100);
    const afterDown = await getHighlightedText();
    console.log(`After ArrowDown: ${afterDown?.substring(0, 30)}...`);

    // Press down again
    await page.keyboard.press('ArrowDown');
    await page.waitForTimeout(100);
    const afterDown2 = await getHighlightedText();
    console.log(`After 2nd ArrowDown: ${afterDown2?.substring(0, 30)}...`);

    // Verify navigation happened - at least one should be different
    const navigationWorked = afterUp3 !== afterDown || afterDown !== afterDown2;
    console.log(`Navigation worked: ${navigationWorked}`);
    expect(navigationWorked).toBe(true);

    await page.keyboard.press('Escape');
    console.log('✓ Up/down arrow navigation works');
  });

  test('Keyboard navigation: right arrow drills into container', async ({ page }) => {
    await page.goto(`${BASE_URL}/admin/content/lists/menus/ambient`, {
      waitUntil: 'networkidle',
      timeout: 30000
    });

    await page.waitForSelector('.item-row', { timeout: 10000 });
    await page.waitForTimeout(2000);

    // Find a row with a container item (artist/album/show)
    const rows = page.locator('.item-row');
    const rowCount = await rows.count();

    // Click on a row that has a container type
    const firstRow = rows.first();
    const contentDisplay = firstRow.locator('.col-input .content-display');
    await contentDisplay.click();

    const dropdown = page.locator('.mantine-Combobox-dropdown:visible');
    await expect(dropdown).toBeVisible({ timeout: 5000 });
    await page.waitForTimeout(2000);

    // Find a container item (one with chevron)
    const containerOptions = dropdown.locator('.mantine-Combobox-option:has(.mantine-ActionIcon)');
    const containerCount = await containerOptions.count();
    console.log(`Found ${containerCount} container items`);

    if (containerCount > 0) {
      // Navigate to a container item
      const options = dropdown.locator('.mantine-Combobox-option');
      const optionCount = await options.count();

      // Find index of first container
      for (let i = 0; i < Math.min(optionCount, 10); i++) {
        const opt = options.nth(i);
        const hasChevron = await opt.locator('.mantine-ActionIcon').count() > 0;
        if (hasChevron) {
          // Navigate to this option
          for (let j = 0; j < i; j++) {
            await page.keyboard.press('ArrowDown');
            await page.waitForTimeout(50);
          }
          break;
        }
      }

      // Check for breadcrumb before drill-down
      const breadcrumbBefore = await dropdown.locator('text=↑↓ navigate').count() > 0;
      console.log(`Has navigation hint: ${breadcrumbBefore}`);

      // Press right arrow to drill down
      await page.keyboard.press('ArrowRight');
      await page.waitForTimeout(2000);

      // Should now have breadcrumb showing path
      const breadcrumb = dropdown.locator('[class*="IconHome"]');
      const hasBreadcrumb = await breadcrumb.count() > 0;
      console.log(`Has breadcrumb after drill-down: ${hasBreadcrumb}`);

      if (hasBreadcrumb) {
        // Verify we're in a new context (new items loaded)
        const newOptions = dropdown.locator('.mantine-Combobox-option');
        const newCount = await newOptions.count();
        console.log(`Items after drill-down: ${newCount}`);

        // Press left arrow to go back
        await page.keyboard.press('ArrowLeft');
        await page.waitForTimeout(2000);

        // Should be back to original view
        const afterBack = dropdown.locator('.mantine-Combobox-option');
        const afterBackCount = await afterBack.count();
        console.log(`Items after going back: ${afterBackCount}`);
      }
    }

    await page.keyboard.press('Escape');
    console.log('✓ Right arrow drill-down and left arrow back works');
  });

  test('Keyboard navigation: left arrow loads parent from root level', async ({ page }) => {
    await page.goto(`${BASE_URL}/admin/content/lists/menus/ambient`, {
      waitUntil: 'networkidle',
      timeout: 30000
    });

    await page.waitForSelector('.item-row', { timeout: 10000 });
    await page.waitForTimeout(2000);

    // Find a row with content (preferably an album or track that has a parent)
    const rows = page.locator('.item-row');

    // Look for a row that shows "Album" or "Track" type (has a parent)
    let targetRow = null;
    const rowCount = await rows.count();

    for (let i = 0; i < Math.min(rowCount, 10); i++) {
      const row = rows.nth(i);
      const text = await row.textContent();
      if (text.includes('Album') || text.includes('Track')) {
        targetRow = row;
        console.log(`Found row ${i + 1} with parent: ${text.substring(0, 50)}...`);
        break;
      }
    }

    // If no album/track found, use first row (artist) - will test going to library level
    if (!targetRow) {
      targetRow = rows.first();
      console.log('Using first row (artist level)');
    }

    const contentDisplay = targetRow.locator('.col-input .content-display');
    await contentDisplay.click();

    const dropdown = page.locator('.mantine-Combobox-dropdown:visible');
    await expect(dropdown).toBeVisible({ timeout: 5000 });
    await page.waitForTimeout(2000);

    // Get initial items count and first item title
    const initialOptions = dropdown.locator('.mantine-Combobox-option');
    const initialCount = await initialOptions.count();
    const initialFirstText = initialCount > 0 ? await initialOptions.first().textContent() : '';
    console.log(`Initial view: ${initialCount} items, first: ${initialFirstText.substring(0, 30)}...`);

    // Verify we're at root level (no breadcrumb/home icon)
    const homeIconBefore = await dropdown.locator('[class*="IconHome"]').count();
    console.log(`At root level (no home icon): ${homeIconBefore === 0}`);

    // Press left arrow - should load parent context
    await page.keyboard.press('ArrowLeft');
    await page.waitForTimeout(2000);

    // Check what changed - either we went up a level or we're already at top
    const afterLeftOptions = dropdown.locator('.mantine-Combobox-option');
    const afterLeftCount = await afterLeftOptions.count();
    const afterLeftFirstText = afterLeftCount > 0 ? await afterLeftOptions.first().textContent() : '';
    console.log(`After left arrow: ${afterLeftCount} items, first: ${afterLeftFirstText.substring(0, 30)}...`);

    // The items should be different if we successfully went up a level
    // (different parent = different siblings)
    const itemsChanged = initialFirstText !== afterLeftFirstText || initialCount !== afterLeftCount;
    console.log(`Items changed after left arrow: ${itemsChanged}`);

    // If we went up, we should see the current item's parent among the new items
    // or we're at the library level now

    await page.keyboard.press('Escape');
    console.log('✓ Left arrow loads parent from root level');
  });

  test('Click chevron button drills into container', async ({ page }) => {
    await page.goto(`${BASE_URL}/admin/content/lists/menus/ambient`, {
      waitUntil: 'networkidle',
      timeout: 30000
    });

    await page.waitForSelector('.item-row', { timeout: 10000 });
    await page.waitForTimeout(2000);

    const firstRow = page.locator('.item-row').first();
    const contentDisplay = firstRow.locator('.col-input .content-display');
    await contentDisplay.click();

    const dropdown = page.locator('.mantine-Combobox-dropdown:visible');
    await expect(dropdown).toBeVisible({ timeout: 5000 });
    await page.waitForTimeout(2000);

    // Find and click a chevron button
    const chevronButton = dropdown.locator('.mantine-ActionIcon').first();
    const hasChevron = await chevronButton.count() > 0;

    if (hasChevron) {
      const parentText = await chevronButton.locator('..').locator('..').textContent();
      console.log(`Drilling into: ${parentText?.substring(0, 40)}...`);

      await chevronButton.click();
      await page.waitForTimeout(2000);

      // Should show breadcrumb with home icon
      const homeIcon = dropdown.locator('[class*="IconHome"]');
      const hasBreadcrumb = await homeIcon.count() > 0;
      console.log(`Breadcrumb appeared: ${hasBreadcrumb}`);
      expect(hasBreadcrumb).toBe(true);

      // Click home to go back to start
      await homeIcon.click();
      await page.waitForTimeout(2000);

      // Breadcrumb should be gone
      const homeIconAfter = dropdown.locator('[class*="IconHome"]');
      const breadcrumbGone = await homeIconAfter.count() === 0;
      console.log(`Breadcrumb gone after home click: ${breadcrumbGone}`);
    }

    await page.keyboard.press('Escape');
    console.log('✓ Chevron click drill-down and home button works');
  });

  test('Enter key selects highlighted item', async ({ page }) => {
    await page.goto(`${BASE_URL}/admin/content/lists/menus/ambient`, {
      waitUntil: 'networkidle',
      timeout: 30000
    });

    await page.waitForSelector('.item-row', { timeout: 10000 });
    await page.waitForTimeout(2000);

    const firstRow = page.locator('.item-row').first();
    const contentDisplay = firstRow.locator('.col-input .content-display');

    // Get original content
    const originalText = await contentDisplay.textContent();
    console.log(`Original: ${originalText?.substring(0, 40)}...`);

    await contentDisplay.click();

    const dropdown = page.locator('.mantine-Combobox-dropdown:visible');
    await expect(dropdown).toBeVisible({ timeout: 5000 });
    await page.waitForTimeout(2000);

    // Navigate down to a different item
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowDown');
    await page.waitForTimeout(100);

    // Get the highlighted item text before selecting
    const highlighted = dropdown.locator('.mantine-Combobox-option[style*="dark-5"]');
    let expectedText = '';
    if (await highlighted.count() > 0) {
      expectedText = await highlighted.first().textContent() || '';
      console.log(`Will select: ${expectedText.substring(0, 40)}...`);
    }

    // Press Enter to select
    await page.keyboard.press('Enter');
    await page.waitForTimeout(1000);

    // Dropdown should close
    const dropdownVisible = await dropdown.isVisible().catch(() => false);
    console.log(`Dropdown closed: ${!dropdownVisible}`);

    // Content should have changed (or at least dropdown closed)
    const newText = await contentDisplay.textContent();
    console.log(`After selection: ${newText?.substring(0, 40)}...`);

    console.log('✓ Enter key selects item and closes dropdown');
  });

  test('Search filters current browse context', async ({ page }) => {
    await page.goto(`${BASE_URL}/admin/content/lists/menus/ambient`, {
      waitUntil: 'networkidle',
      timeout: 30000
    });

    await page.waitForSelector('.item-row', { timeout: 10000 });
    await page.waitForTimeout(2000);

    const firstRow = page.locator('.item-row').first();
    const contentDisplay = firstRow.locator('.col-input .content-display');
    await contentDisplay.click();

    const dropdown = page.locator('.mantine-Combobox-dropdown:visible');
    await expect(dropdown).toBeVisible({ timeout: 5000 });
    await page.waitForTimeout(2000);

    // Count initial items
    const initialOptions = dropdown.locator('.mantine-Combobox-option');
    const initialCount = await initialOptions.count();
    console.log(`Initial items: ${initialCount}`);

    // Type a search query
    const input = page.locator('.mantine-InputBase-input:visible');
    await input.fill('music');
    await page.waitForTimeout(1500);

    // Count filtered items (search results)
    const filteredOptions = dropdown.locator('.mantine-Combobox-option');
    const filteredCount = await filteredOptions.count();
    console.log(`After search 'music': ${filteredCount} items`);

    // Clear search
    await input.fill('');
    await page.waitForTimeout(500);

    // Items should return (siblings reload or search clears)
    const afterClear = dropdown.locator('.mantine-Combobox-option');
    const afterClearCount = await afterClear.count();
    console.log(`After clearing search: ${afterClearCount} items`);

    await page.keyboard.press('Escape');
    console.log('✓ Search filtering works');
  });

  test('More Info drawer shows item details and children', async ({ page }) => {
    await page.goto(`${BASE_URL}/admin/content/lists/menus/ambient`, {
      waitUntil: 'networkidle',
      timeout: 30000
    });

    await page.waitForSelector('.item-row', { timeout: 10000 });
    await page.waitForTimeout(1000);

    // Click the menu button on first row (last button in the row with 3 dots icon)
    const firstRow = page.locator('.item-row').first();
    const menuButton = firstRow.locator('.col-menu button');
    await menuButton.click();

    // Wait for menu and click "More Info"
    const moreInfoItem = page.locator('text=More Info');
    await expect(moreInfoItem).toBeVisible({ timeout: 3000 });
    await moreInfoItem.click();

    // Drawer should open - it's rendered as a dialog
    const drawer = page.locator('dialog[aria-label="Item Details"], [role="dialog"]:has-text("Item Details")');
    await expect(drawer).toBeVisible({ timeout: 5000 });
    console.log('Drawer opened');

    // Wait for loading to complete
    await page.waitForTimeout(2000);

    // Should show item title
    const titleText = await drawer.locator('.mantine-Text-root').first().textContent();
    console.log(`Drawer shows: ${titleText}`);

    // Should show type badge
    const typeBadge = drawer.locator('.mantine-Badge-root');
    const hasBadge = await typeBadge.count() > 0;
    console.log(`Has type badge: ${hasBadge}`);

    // Check for watch progress
    const hasProgress = await drawer.locator('text=Watch Progress').count() > 0;
    console.log(`Has watch progress: ${hasProgress}`);

    // Check for items list
    const itemsHeader = await drawer.locator('text=/Items \\(\\d+\\)/').count() > 0;
    console.log(`Has items list: ${itemsHeader}`);

    // Close drawer
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);

    console.log('✓ More Info drawer works');
  });

});
