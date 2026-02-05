/**
 * TV App - Folder Submenu Navigation Test
 *
 * Verifies folders open submenus instead of routing to Player.
 */
import { test, expect } from '@playwright/test';
import { BACKEND_URL } from '#fixtures/runtime/urls.mjs';

const BASE_URL = BACKEND_URL;

test.describe('TV Folder Submenu Navigation', () => {

  test('API returns list action for folder items', async ({ request }) => {
    console.log('[TEST] Checking API response for FHE folder...');

    const response = await request.get(`${BASE_URL}/api/v1/info/folder/TVApp`);
    expect(response.ok()).toBe(true);

    const data = await response.json();
    const fhe = data.items?.find(item => item.label === 'FHE');

    if (!fhe) {
      console.log('FHE not found in menu, skipping');
      test.skip();
      return;
    }

    console.log('FHE item:', JSON.stringify({ list: fhe.list, play: fhe.play }, null, 2));

    // Verify list action is set (not play)
    expect(fhe.list).toBeTruthy();
    expect(fhe.list.list).toBe('FHE');

    // play should be undefined or null for folder items
    expect(fhe.play).toBeFalsy();  // Folder items should have no play action

    console.log('FHE has correct list action');
  });

  test('Selecting FHE opens submenu (not Player)', async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
    const page = await context.newPage();

    try {
      await page.goto(`${BASE_URL}/tv`, { waitUntil: 'domcontentloaded', timeout: 30000 });

      // Wait for menu items to load
      await page.waitForSelector('.menu-item', { timeout: 10000 });
      await page.waitForTimeout(1000); // Let menu fully render

      // Find FHE in menu
      const menuItems = await page.locator('.menu-item').all();
      let fheIndex = -1;

      for (let i = 0; i < menuItems.length && i < 50; i++) {
        const label = await menuItems[i].locator('h3').textContent();
        if (label?.trim() === 'FHE') {
          fheIndex = i;
          break;
        }
      }

      if (fheIndex === -1) {
        console.log('FHE not found in menu, skipping');
        test.skip();
        return;
      }

      console.log(`Found FHE at index ${fheIndex}`);

      // Navigate to FHE
      const columns = 5;
      const row = Math.floor(fheIndex / columns);
      const col = fheIndex % columns;

      for (let i = 0; i < row; i++) {
        await page.keyboard.press('ArrowDown');
        await page.waitForTimeout(100);
      }
      for (let i = 0; i < col; i++) {
        await page.keyboard.press('ArrowRight');
        await page.waitForTimeout(100);
      }

      // Select FHE
      await page.keyboard.press('Enter');

      // Wait for submenu to load (up to 10 seconds)
      let submenuItems = 0;
      let videoCount = 0;

      for (let attempt = 0; attempt < 20; attempt++) {
        await page.waitForTimeout(500);
        submenuItems = await page.locator('.menu-item').count();
        videoCount = await page.locator('video').count();

        // Success: found menu items (submenu loaded)
        if (submenuItems > 0) {
          break;
        }

        // If video player appeared, this is the bug - folder went to player
        if (videoCount > 0) {
          break;
        }
      }

      console.log(`After selecting FHE: ${submenuItems} submenu items, ${videoCount} video elements`);

      // Should NOT have video player (that would mean it incorrectly played the folder)
      if (videoCount > 0) {
        throw new Error('FHE folder incorrectly opened in player instead of submenu');
      }

      // Submenu should have items
      expect(submenuItems).toBeGreaterThan(0);

      console.log('FHE submenu opened successfully');

    } finally {
      await page.close();
      await context.close();
    }
  });

});
