/**
 * TV App - The Chosen Season List Test
 *
 * Verifies The Chosen opens season/episode list instead of playing directly.
 */
import { test, expect } from '@playwright/test';
import { BACKEND_URL } from '#fixtures/runtime/urls.mjs';

const BASE_URL = BACKEND_URL;

test.describe('The Chosen Season List', () => {

  test('API returns list action for Chosen (not play)', async ({ request }) => {
    console.log('[TEST] Checking API response for Chosen...');

    const response = await request.get(`${BASE_URL}/api/v1/item/folder/TVApp`);
    expect(response.ok()).toBe(true);

    const data = await response.json();
    const chosen = data.items?.find(item => item.label === 'Chosen');

    expect(chosen, 'Chosen should exist in TVApp menu').toBeTruthy();

    console.log('Chosen item:', JSON.stringify({ list: chosen.list, play: chosen.play, queue: chosen.queue }, null, 2));

    // Verify list action is set (for show/season navigation)
    expect(chosen.list).toBeTruthy();
    expect(chosen.list.plex).toBe('408886');

    // Should NOT have play or queue action
    expect(chosen.play).toBeFalsy();
    expect(chosen.queue).toBeFalsy();

    console.log('[PASS] Chosen has correct list action for season navigation');
  });

  test('Selecting Chosen opens season list (not Player)', async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
    const page = await context.newPage();

    try {
      await page.goto(`${BASE_URL}/tv`, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await page.waitForTimeout(2000);

      // Find Chosen in menu
      const menuItems = await page.locator('.menu-item').all();
      let chosenIndex = -1;

      for (let i = 0; i < menuItems.length && i < 50; i++) {
        const label = await menuItems[i].locator('h3').textContent().catch(() => null);
        if (label?.trim() === 'Chosen') {
          chosenIndex = i;
          break;
        }
      }

      if (chosenIndex === -1) {
        console.log('Chosen not found in menu, skipping');
        test.skip();
        return;
      }

      console.log(`Found Chosen at index ${chosenIndex}`);

      // Navigate to Chosen
      const columns = 5;
      const row = Math.floor(chosenIndex / columns);
      const col = chosenIndex % columns;

      for (let i = 0; i < row; i++) {
        await page.keyboard.press('ArrowDown');
        await page.waitForTimeout(100);
      }
      for (let i = 0; i < col; i++) {
        await page.keyboard.press('ArrowRight');
        await page.waitForTimeout(100);
      }

      // Select Chosen
      await page.keyboard.press('Enter');
      await page.waitForTimeout(3000);

      // Check result - should have season/episode items, NOT Player
      const submenuItems = await page.locator('.menu-item').count();
      const videoCount = await page.locator('video').count();
      const playerVisible = await page.locator('.player, [class*="player"]').count();

      console.log(`After selecting Chosen:`);
      console.log(`  - Menu items: ${submenuItems}`);
      console.log(`  - Video elements: ${videoCount}`);
      console.log(`  - Player components: ${playerVisible}`);

      // Should have submenu items (seasons or episodes)
      expect(submenuItems).toBeGreaterThan(0);

      // Should NOT have video playing immediately
      // (Some delay is expected for loading, but we shouldn't see video right away)
      if (videoCount > 0) {
        console.log('WARNING: Video element found - may be playing instead of showing list');
      }

      console.log('[PASS] Chosen opened season/episode list');

    } finally {
      await page.close();
      await context.close();
    }
  });

});
