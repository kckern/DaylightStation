import { test, expect } from '@playwright/test';

test.describe('Office Screen Menu Switching', () => {
  test.beforeEach(async ({ page }) => {
    // Retry page load up to 3 times — container may still be starting
    let loaded = false;
    for (let attempt = 0; attempt < 3 && !loaded; attempt++) {
      await page.goto('/screen/office', { waitUntil: 'networkidle' });
      try {
        await page.waitForSelector('.screen-root', { timeout: 10000 });
        loaded = true;
      } catch {
        await page.waitForTimeout(3000);
      }
    }
    expect(loaded).toBe(true);
    // Wait for numpad adapter keymap to load
    await page.waitForTimeout(5000);
  });

  test('pressing F while health menu is open should open ambient menu, not advance cursor', async ({ page }) => {
    // Press E — opens health menu
    await page.keyboard.press('e');
    await page.waitForSelector('.screen-overlay--fullscreen', { timeout: 10000 });
    await page.waitForTimeout(2000);

    // Get the menu's rootMenu prop or first item identity
    const stateAfterE = await page.evaluate(() => {
      const overlay = document.querySelector('.screen-overlay--fullscreen');
      if (!overlay) return { found: false };
      // Grab all img srcs as fingerprint
      const imgs = [...overlay.querySelectorAll('img')].map(i => i.src).slice(0, 3);
      const itemCount = overlay.querySelectorAll('.menu-item, .menu-row, [data-content-id], .tv-menu-card').length;
      return { found: true, imgs, itemCount, html: overlay.innerHTML.length };
    });

    // Press F — should open ambient menu
    await page.keyboard.press('f');
    await page.waitForTimeout(2000);

    const stateAfterF = await page.evaluate(() => {
      const overlay = document.querySelector('.screen-overlay--fullscreen');
      if (!overlay) return { found: false };
      const imgs = [...overlay.querySelectorAll('img')].map(i => i.src).slice(0, 3);
      const itemCount = overlay.querySelectorAll('.menu-item, .menu-row, [data-content-id], .tv-menu-card').length;
      return { found: true, imgs, itemCount, html: overlay.innerHTML.length };
    });

    // At least one signal should differ: different images, different count, or different HTML
    const sameImages = JSON.stringify(stateAfterE.imgs) === JSON.stringify(stateAfterF.imgs);
    const sameCount = stateAfterE.itemCount === stateAfterF.itemCount;
    const sameHtml = stateAfterE.html === stateAfterF.html;

    // Menu MUST have changed — if all three match, F didn't switch menus
    const menuChanged = !sameImages || !sameCount || !sameHtml;
    expect(menuChanged).toBe(true);
  });
});
