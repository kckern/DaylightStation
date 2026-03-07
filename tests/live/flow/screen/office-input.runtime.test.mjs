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

  test('pressing k again while menu is open advances selection (does not select)', async ({ page }) => {
    // Open menu
    await page.keyboard.press('k');
    await page.waitForSelector('.screen-overlay--fullscreen', { timeout: 5000 });
    await page.waitForTimeout(500);

    // Get the initially selected index
    const indexBefore = await page.evaluate(() => {
      const items = [...document.querySelectorAll('.menu-item, .menu-row')];
      return items.findIndex(el =>
        el.classList.contains('selected') ||
        el.classList.contains('menu-item--selected') ||
        el.getAttribute('data-selected') === 'true' ||
        el.classList.contains('active')
      );
    });

    // Press k again — with duplicate:'navigate', dispatches ArrowDown to advance
    await page.keyboard.press('k');
    await page.waitForTimeout(300);

    // Selection should have moved down by 1
    const indexAfter = await page.evaluate(() => {
      const items = [...document.querySelectorAll('.menu-item, .menu-row')];
      return items.findIndex(el =>
        el.classList.contains('selected') ||
        el.classList.contains('menu-item--selected') ||
        el.getAttribute('data-selected') === 'true' ||
        el.classList.contains('active')
      );
    });

    // The selected index should have advanced (wraps around if at end)
    expect(indexAfter).not.toBe(indexBefore);
  });
});
