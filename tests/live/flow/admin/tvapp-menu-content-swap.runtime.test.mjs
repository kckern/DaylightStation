/**
 * TVApp Menu Content Swap Test
 *
 * Verifies:
 * 1. Navigate to tvapp menu list
 * 2. Scroll to the "mar 4" row
 * 3. Click the content field to edit
 * 4. Replace query:feb20-videos with query:mar4-videos
 * 5. Press the preview button to confirm playback
 */

import { test, expect } from '@playwright/test';
import { BACKEND_URL } from '#fixtures/runtime/urls.mjs';

const BASE_URL = BACKEND_URL;
const MENU_URL = `${BASE_URL}/admin/content/lists/menus/tvapp`;
const TARGET_LABEL = /mar\s*4/i;
const OLD_VALUE = 'query:feb20-videos';
const NEW_VALUE = 'query:mar4-videos';

test.describe('TVApp menu content swap', () => {

  test('replace content value and preview queue', async ({ page }) => {
    // Navigate to tvapp menu list
    await page.goto(MENU_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForSelector('.item-row', { timeout: 10000 });

    // Find the "mar 4" row
    const row = page.locator('.item-row', {
      has: page.locator('.col-label', { hasText: TARGET_LABEL })
    }).first();

    await expect(row, '"mar 4" row should exist').toBeVisible({ timeout: 10000 });
    await row.scrollIntoViewIfNeeded();
    console.log('Found and scrolled to "mar 4" row');

    // Wait for content info to load
    await page.waitForTimeout(2000);

    // Click the content display to enter editing mode
    const inputCell = row.locator('.col-input');
    const contentDisplay = inputCell.locator('.content-display');

    // Content display might show resolved title or raw value
    const hasContentDisplay = await contentDisplay.count() > 0;
    if (hasContentDisplay) {
      await contentDisplay.click();
    } else {
      // Fallback: click the input cell directly
      await inputCell.click();
    }

    // Wait for the combobox input to appear
    const comboboxInput = inputCell.locator('input');
    await expect(comboboxInput, 'Combobox input should appear').toBeVisible({ timeout: 5000 });

    // Read current value
    const currentValue = await comboboxInput.inputValue();
    console.log(`Current input value: "${currentValue}"`);

    // Select all and type the new value
    await comboboxInput.fill(NEW_VALUE);
    await page.waitForTimeout(500);

    const typedValue = await comboboxInput.inputValue();
    console.log(`Typed value: "${typedValue}"`);
    expect(typedValue).toBe(NEW_VALUE);

    // Press Enter to commit the raw value
    await page.keyboard.press('Enter');
    await page.waitForTimeout(1000);

    // Verify the value was saved — content display should now show the new value
    // (it may show as unresolved/raw text or as resolved content)
    const updatedDisplay = inputCell.locator('.content-display');
    await expect(updatedDisplay, 'Content display should reappear after save').toBeVisible({ timeout: 5000 });

    const displayText = await updatedDisplay.textContent();
    console.log(`Display after save: "${displayText}"`);

    // The display should contain "mar4" (from query:mar4-videos)
    expect(displayText?.toLowerCase()).toContain('mar4');

    // Now click the preview button on this row
    const previewBtn = row.locator('.col-preview .mantine-ActionIcon-root');
    await expect(previewBtn, 'Preview button should be visible').toBeVisible({ timeout: 5000 });
    await previewBtn.click();

    // Preview modal should open
    const overlay = page.locator('.mantine-Modal-overlay:visible');
    await expect(overlay, 'Preview modal should open').toBeVisible({ timeout: 5000 });
    console.log('Preview modal opened');

    // Wait for media to appear inside the modal
    await page.waitForFunction(() => {
      const bodies = document.querySelectorAll('.mantine-Modal-body');
      for (const body of bodies) {
        if (body.offsetHeight === 0) continue;
        if (body.querySelector('audio, video, dash-video, iframe')) return true;
      }
      return false;
    }, { timeout: 30000 });

    console.log('Media element appeared in preview modal');

    // Close modal
    await overlay.click({ position: { x: 5, y: 5 } });
    await expect(overlay).not.toBeVisible({ timeout: 3000 });

    console.log('PASS: content swapped and preview queue played');
  });

});
