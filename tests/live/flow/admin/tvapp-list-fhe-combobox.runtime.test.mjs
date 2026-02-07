/**
 * Admin TVApp Menu Combobox Test
 *
 * Verifies that the TVApp menu list loads and the Fhe input
 * opens a combobox with sibling options.
 */

import { test, expect } from '@playwright/test';
import { BACKEND_URL } from '#fixtures/runtime/urls.mjs';

const BASE_URL = BACKEND_URL;

const MENU_URL = `${BASE_URL}/admin/content/lists/menus/tvapp`;
const TARGET_LABEL = /fhe/i;

test.describe('Admin TVApp menu combobox', () => {
  test('opens Fhe input and loads combobox options', async ({ page }) => {
    page.on('response', (response) => {
      const url = response.url();
      if (url.includes('/api/v1/info/menu/FHE') || url.includes('/api/v1/list/menu/')) {
        console.log(`API response ${response.status()}: ${url}`);
      }
    });

    await page.goto(MENU_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });

    await page.waitForSelector('.item-row', { timeout: 10000 });

    const row = page.locator('.item-row', {
      has: page.locator('.col-label', { hasText: TARGET_LABEL })
    }).first();

    await expect(row, 'Fhe row should exist').toBeVisible({ timeout: 10000 });
    await row.scrollIntoViewIfNeeded();

    const inputCell = row.locator('.col-input');
    const contentDisplay = inputCell.locator('.content-display');

    await expect(contentDisplay, 'Fhe content display should be visible').toBeVisible({ timeout: 10000 });

    await contentDisplay.click();

    const dropdown = page.locator('.mantine-Combobox-dropdown:visible');
    await expect(dropdown, 'Combobox dropdown should be visible').toBeVisible({ timeout: 10000 });

    const options = dropdown.locator('.mantine-Combobox-option');
    await expect(options.first(), 'Combobox should load sibling options').toBeVisible({ timeout: 15000 });

    const emptyState = dropdown.locator('.mantine-Combobox-empty');
    const emptyText = await emptyState.textContent().catch(() => null);

    if (emptyText && emptyText.trim() === 'Type to search...') {
      throw new Error('Combobox shows search empty state instead of siblings.');
    }
  });
});
