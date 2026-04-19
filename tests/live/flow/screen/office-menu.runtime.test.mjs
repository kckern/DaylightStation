import { test, expect } from '@playwright/test';

/**
 * Office Screen Menu Tests
 *
 * The office screen uses a physical numpad — NO arrow keys.
 * Menu keys (c–m) open menus. Pressing the same key again
 * cycles selection via duplicate:navigate (dispatches ArrowRight internally).
 * MENU_TIMEOUT is 3000ms — auto-selects the highlighted item.
 * Key 4 = escape.
 *
 * Keyboard mapping (from keyboard.yml, folder: Office Keypad):
 *   c → menu:scripture, g → menu:music, h → menu:movie, k → menu:education
 *   4 → escape
 */

test.describe.configure({ mode: 'serial' });

/** @type {import('@playwright/test').Page} */
let sharedPage;
/** @type {import('@playwright/test').BrowserContext} */
let sharedContext;

async function getActiveIndex(page) {
  return page.evaluate(() => {
    const items = [...document.querySelectorAll('.menu-item:not(.menu-item-skeleton)')];
    return items.findIndex(el => el.classList.contains('active'));
  });
}

async function getMenuTitle(page) {
  return page.evaluate(() => {
    const h2 = document.querySelector('.screen-overlay--fullscreen .menu-header h2');
    return h2?.textContent?.trim() || null;
  });
}

async function dismissOverlay(page) {
  for (let i = 0; i < 3; i++) {
    if (await page.locator('.screen-overlay--fullscreen').count() === 0) break;
    await page.keyboard.press('4');
    await page.waitForTimeout(500);
  }
}

test.describe('Office Screen Menu', () => {

  test.beforeAll(async ({ browser }) => {
    sharedContext = await browser.newContext({
      viewport: { width: 1280, height: 720 },
    });
    sharedPage = await sharedContext.newPage();
    await sharedPage.goto('/screen/office');
    await sharedPage.waitForSelector('.screen-root', { timeout: 15000 });
    await sharedPage.waitForTimeout(2000);
  });

  test.afterAll(async () => {
    await sharedPage?.close();
    await sharedContext?.close();
  });

  test('no overlay is present initially', async () => {
    expect(await sharedPage.locator('.screen-overlay--fullscreen').count()).toBe(0);
  });

  test('pressing a menu key opens the overlay with items', async () => {
    await sharedPage.keyboard.press('g');
    await sharedPage.waitForSelector('.screen-overlay--fullscreen', { timeout: 5000 });
    await sharedPage.waitForSelector('.menu-item:not(.menu-item-skeleton)', { timeout: 10000 });

    const itemCount = await sharedPage.locator('.menu-item:not(.menu-item-skeleton)').count();
    expect(itemCount).toBeGreaterThan(0);

    const title = await getMenuTitle(sharedPage);
    expect(title).toBeTruthy();

    // First item should be active
    expect(await getActiveIndex(sharedPage)).toBe(0);
  });

  test('pressing the same key cycles selection (duplicate:navigate)', async () => {
    await expect(sharedPage.locator('.screen-overlay--fullscreen')).toBeVisible();
    const totalItems = await sharedPage.locator('.menu-item:not(.menu-item-skeleton)').count();

    // Each press of 'g' while music menu is open should advance by 1
    for (let i = 0; i < totalItems; i++) {
      const before = await getActiveIndex(sharedPage);
      await sharedPage.keyboard.press('g');
      await sharedPage.waitForTimeout(300);
      const after = await getActiveIndex(sharedPage);
      expect(after).toBe((before + 1) % totalItems);
    }
  });

  test('escape (key 4) dismisses the overlay', async () => {
    await sharedPage.keyboard.press('4');
    await sharedPage.waitForTimeout(500);
    expect(await sharedPage.locator('.screen-overlay--fullscreen').count()).toBe(0);
  });

  test('auto-select fires after timeout and pushes content', async () => {
    await sharedPage.keyboard.press('g');
    await sharedPage.waitForSelector('.screen-overlay--fullscreen', { timeout: 5000 });
    await sharedPage.waitForSelector('.menu-item:not(.menu-item-skeleton)', { timeout: 10000 });

    expect(await sharedPage.locator('.menu-item:not(.menu-item-skeleton)').count()).toBeGreaterThan(0);

    // Let the 3s auto-select timer fire
    await sharedPage.waitForTimeout(3500);

    // After auto-select, content should be pushed onto the MenuStack
    const overlayState = await sharedPage.evaluate(() => {
      const overlay = document.querySelector('.screen-overlay--fullscreen');
      if (!overlay) return { present: false };
      return {
        present: true,
        hasPlayer: !!overlay.querySelector('video, audio, [class*="player"]'),
        hasSubMenu: !!overlay.querySelector('.menu-items-container'),
        hasApp: !!overlay.querySelector('[class*="app-container"]'),
        hasDisplayer: !!overlay.querySelector('[class*="displayer"]'),
        hasLaunchCard: !!overlay.querySelector('[class*="launch-card"]'),
        hasLoading: !!overlay.querySelector('[class*="loading"], [class*="skeleton"]'),
      };
    });

    if (overlayState.present) {
      const { hasPlayer, hasSubMenu, hasApp, hasDisplayer, hasLaunchCard, hasLoading } = overlayState;
      expect(hasPlayer || hasSubMenu || hasApp || hasDisplayer || hasLaunchCard || hasLoading).toBe(true);
    }

    await dismissOverlay(sharedPage);
  });

  test('single escape dismisses overlay after auto-select (no escape trap)', async () => {
    await sharedPage.keyboard.press('g');
    await sharedPage.waitForSelector('.screen-overlay--fullscreen', { timeout: 5000 });
    await sharedPage.waitForSelector('.menu-item:not(.menu-item-skeleton)', { timeout: 10000 });

    // Wait for auto-select
    await sharedPage.waitForTimeout(3500);

    // Content should be pushed (player, submenu, etc.)
    expect(await sharedPage.locator('.screen-overlay--fullscreen').count()).toBe(1);

    // Single escape should dismiss the overlay entirely
    // (not return to the timed menu which would re-trigger auto-select)
    await sharedPage.keyboard.press('4');
    await sharedPage.waitForTimeout(500);
    expect(await sharedPage.locator('.screen-overlay--fullscreen').count()).toBe(0);
  });

  test('cycling resets the auto-select timer (no premature selection)', async () => {
    await sharedPage.keyboard.press('g');
    await sharedPage.waitForSelector('.screen-overlay--fullscreen', { timeout: 5000 });
    await sharedPage.waitForSelector('.menu-item:not(.menu-item-skeleton)', { timeout: 10000 });

    // Cycle every 1s for 5s total — well past the 3s MENU_TIMEOUT.
    // If the timer doesn't reset, auto-select fires at ~3s and we leave the menu.
    for (let i = 0; i < 5; i++) {
      await sharedPage.waitForTimeout(1000);
      await sharedPage.keyboard.press('g'); // cycle to next item
    }

    // Menu should still be open (timer kept resetting)
    const menuStillOpen = await sharedPage.locator('.menu-items').count();
    expect(menuStillOpen, 'Menu closed prematurely — timer did not reset on cycle').toBe(1);

    // Active index should have advanced 5 times from 0
    const totalItems = await sharedPage.locator('.menu-item:not(.menu-item-skeleton)').count();
    const activeIdx = await getActiveIndex(sharedPage);
    expect(activeIdx).toBe(5 % totalItems);

    await dismissOverlay(sharedPage);
  });

  test('different menu keys show different menus', async () => {
    // Open scripture
    await sharedPage.keyboard.press('c');
    await sharedPage.waitForSelector('.screen-overlay--fullscreen', { timeout: 5000 });
    await sharedPage.waitForSelector('.menu-item:not(.menu-item-skeleton)', { timeout: 10000 });
    // Reset timer
    await sharedPage.keyboard.press('c');
    await sharedPage.waitForTimeout(200);
    const title1 = await getMenuTitle(sharedPage);
    expect(title1).toBeTruthy();
    await dismissOverlay(sharedPage);

    // Open movie
    await sharedPage.keyboard.press('h');
    await sharedPage.waitForSelector('.screen-overlay--fullscreen', { timeout: 5000 });
    await sharedPage.waitForSelector('.menu-item:not(.menu-item-skeleton)', { timeout: 10000 });
    // Reset timer
    await sharedPage.keyboard.press('h');
    await sharedPage.waitForTimeout(200);
    const title2 = await getMenuTitle(sharedPage);
    expect(title2).toBeTruthy();
    expect(title2).not.toBe(title1);
    await dismissOverlay(sharedPage);
  });

  test('switching menus after auto-select resets stack (no cross-menu state leakage)', async () => {
    // Open menu g (music), let auto-select fire (pushes content onto stack)
    await sharedPage.keyboard.press('g');
    await sharedPage.waitForSelector('.screen-overlay--fullscreen', { timeout: 5000 });
    await sharedPage.waitForSelector('.menu-item:not(.menu-item-skeleton)', { timeout: 10000 });

    // Wait for auto-select (3s MENU_TIMEOUT)
    await sharedPage.waitForTimeout(3500);

    // After auto-select, content should be pushed onto the stack (player, submenu, etc.)
    // Verify the overlay is still present (content was pushed, not just dismissed)
    expect(await sharedPage.locator('.screen-overlay--fullscreen').count()).toBe(1);

    // Now press a DIFFERENT menu key (h = movie) — this should reset the stack
    // and show the movie menu at its root, not the stale content from music
    await sharedPage.keyboard.press('h');
    await sharedPage.waitForSelector('.menu-item:not(.menu-item-skeleton)', { timeout: 10000 });
    await sharedPage.waitForTimeout(500);

    // The new menu should show its own root items with a proper header
    const title = await getMenuTitle(sharedPage);
    expect(title).toBeTruthy();
    // It should NOT be the music menu title
    expect(title).not.toMatch(/music/i);

    // The first item should be active (index 0)
    const indexOnNewMenu = await getActiveIndex(sharedPage);
    expect(indexOnNewMenu, 'Selection from previous menu leaked into new menu').toBe(0);

    await dismissOverlay(sharedPage);
  });

  test('menu items have images or gradient placeholders', async () => {
    await sharedPage.keyboard.press('g');
    await sharedPage.waitForSelector('.screen-overlay--fullscreen', { timeout: 5000 });
    await sharedPage.waitForSelector('.menu-item:not(.menu-item-skeleton)', { timeout: 10000 });

    const items = await sharedPage.locator('.menu-item:not(.menu-item-skeleton)').all();
    expect(items.length).toBeGreaterThan(0);

    for (const item of items) {
      const imgContainer = item.locator('.menu-item-img');
      await expect(imgContainer).toBeVisible();

      const hasImg = await imgContainer.locator('img').count() > 0;
      const hasPlaceholder = await imgContainer.evaluate(el => el.classList.contains('no-image'));
      expect(hasImg || hasPlaceholder).toBe(true);
    }

    await dismissOverlay(sharedPage);
  });
});
