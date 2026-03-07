import { test, expect } from '@playwright/test';

test.describe('Office Screen Input Parity', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/screen/office');
    await page.waitForSelector('.screen-root', { timeout: 15000 });
    await page.waitForTimeout(2000);
  });

  test('Digit4 (escape at home) reloads the page', async ({ page }) => {
    // Inject a marker that will be cleared on reload
    await page.evaluate(() => { window.__reloadMarker = true; });

    // Press 4 which maps to escape; with idle->reload config should reload
    await page.keyboard.press('4');

    // Wait for marker to disappear (page reloaded)
    await page.waitForFunction(() => !window.__reloadMarker, { timeout: 10000 });
  });

  test('pressing k opens a menu overlay', async ({ page }) => {
    // No overlay initially
    expect(await page.locator('.screen-overlay--fullscreen').count()).toBe(0);

    await page.keyboard.press('k');

    // Menu overlay should appear
    await page.waitForSelector('.screen-overlay--fullscreen', { timeout: 5000 });
    await expect(page.locator('.screen-overlay--fullscreen')).toBeVisible();
  });

  test('pressing k again while menu is open triggers item selection', async ({ page }) => {
    // Open menu
    await page.keyboard.press('k');
    await page.waitForSelector('.screen-overlay--fullscreen', { timeout: 5000 });

    // Snapshot the current menu state
    const stateBefore = await page.evaluate(() => {
      const items = [...document.querySelectorAll('.menu-item, .menu-row')];
      return {
        count: items.length,
        labels: items.slice(0, 5).map(el => el.textContent.trim()),
      };
    });

    // Press k again — duplicate:'navigate' dispatches Enter, Menu.jsx calls onSelect
    await page.keyboard.press('k');
    await page.waitForTimeout(1000);

    // After selection, state should change (navigated into submenu, or player opened)
    const stateAfter = await page.evaluate(() => {
      const items = [...document.querySelectorAll('.menu-item, .menu-row')];
      const hasPlayer = !!document.querySelector('.player-container, video, audio');
      return {
        count: items.length,
        labels: items.slice(0, 5).map(el => el.textContent.trim()),
        hasPlayer,
      };
    });

    const changed = stateAfter.hasPlayer
      || stateAfter.count !== stateBefore.count
      || JSON.stringify(stateAfter.labels) !== JSON.stringify(stateBefore.labels);

    expect(changed).toBe(true);
  });
});
