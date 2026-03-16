// tests/live/flow/tv/tv-fhe-back-navigation.runtime.test.mjs
// Repro: FHE > Opening Hymn > Escape should return to FHE menu, not base menu.
// Bug: Escape dismisses entire MenuStack overlay instead of popping the Player.
import { test, expect } from '@playwright/test';
import { BACKEND_URL } from '#fixtures/runtime/urls.mjs';

const SCREEN_URL = `${BACKEND_URL}/screens/living-room`;

test.describe.configure({ mode: 'serial' });

let sharedPage, sharedContext;

test.describe('FHE Back Navigation Bug', () => {
  test.beforeAll(async ({ browser }) => {
    sharedContext = await browser.newContext({
      viewport: { width: 1920, height: 1080 },
    });
    sharedPage = await sharedContext.newPage();

    try {
      const cdp = await sharedContext.newCDPSession(sharedPage);
      await cdp.send('Emulation.setAutoplayPolicy', { autoplayPolicy: 'no-user-gesture-required' });
    } catch (e) {
      console.log('Could not set autoplay policy:', e.message);
    }
  });

  test.afterAll(async () => {
    await sharedPage?.close();
    await sharedContext?.close();
  });

  test('Screen loads with root menu', async () => {
    await sharedPage.goto(SCREEN_URL, {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    });

    await sharedPage.waitForSelector('.menu-item', { timeout: 10000 });
    await sharedPage.waitForTimeout(1000);

    const count = await sharedPage.locator('.menu-item').count();
    console.log(`Root menu: ${count} items`);
    expect(count).toBeGreaterThan(0);

    // Confirm FHE exists in root menu
    const labels = await sharedPage.locator('.menu-item h3').allTextContents();
    console.log('Root menu items:', labels.map(l => l.trim()).join(', '));
    expect(labels.map(l => l.trim())).toContain('FHE');
  });

  test('Navigate to FHE submenu', async () => {
    // Find FHE and navigate to it
    const menuItems = await sharedPage.locator('.menu-item').all();
    let fheIndex = -1;
    for (let i = 0; i < menuItems.length; i++) {
      const label = await menuItems[i].locator('h3').textContent();
      if (label?.trim() === 'FHE') {
        fheIndex = i;
        break;
      }
    }
    expect(fheIndex, 'FHE should exist in root menu').toBeGreaterThanOrEqual(0);

    // Navigate with arrow keys (5-column grid)
    const columns = 5;
    for (let i = 0; i < Math.floor(fheIndex / columns); i++) {
      await sharedPage.keyboard.press('ArrowDown');
      await sharedPage.waitForTimeout(100);
    }
    for (let i = 0; i < fheIndex % columns; i++) {
      await sharedPage.keyboard.press('ArrowRight');
      await sharedPage.waitForTimeout(100);
    }

    // Verify and select FHE
    const activeLabel = await sharedPage.locator('.menu-item.active h3').textContent();
    expect(activeLabel?.trim()).toBe('FHE');
    await sharedPage.keyboard.press('Enter');

    // Wait for FHE submenu
    await expect(async () => {
      const labels = await sharedPage.locator('.menu-item h3').allTextContents();
      expect(labels.map(l => l.trim())).toContain('Opening Hymn');
    }).toPass({ timeout: 10000 });

    const fheLabels = await sharedPage.locator('.menu-item h3').allTextContents();
    console.log('FHE menu items:', fheLabels.map(l => l.trim()).join(', '));
  });

  test('Select Opening Hymn — player launches', async () => {
    test.setTimeout(30000);

    // Opening Hymn should be at index 0 (first item)
    const activeLabel = await sharedPage.locator('.menu-item.active h3').textContent();
    console.log(`Active after entering FHE: "${activeLabel?.trim()}"`);

    // If not already on Opening Hymn, it's index 0 so just make sure
    if (activeLabel?.trim() !== 'Opening Hymn') {
      // Press Home or navigate to first item
      for (let i = 0; i < 10; i++) {
        await sharedPage.keyboard.press('ArrowUp');
        await sharedPage.waitForTimeout(50);
      }
      for (let i = 0; i < 10; i++) {
        await sharedPage.keyboard.press('ArrowLeft');
        await sharedPage.waitForTimeout(50);
      }
    }

    await sharedPage.keyboard.press('Enter');

    // Wait for audio/player to appear (singalong)
    let hasMedia = false;
    for (let i = 0; i < 15; i++) {
      hasMedia = await sharedPage.evaluate(() => {
        return !!document.querySelector('audio[src], video[src], .singalong-scroller, .content-scroller');
      });
      if (hasMedia) break;
      await sharedPage.waitForTimeout(1000);
    }

    expect(hasMedia, 'Player/singalong should have launched').toBe(true);
    console.log('Player launched successfully');

    // Let it play briefly
    await sharedPage.waitForTimeout(2000);
  });

  test('Escape from player should return to FHE menu, NOT base menu', async () => {
    test.setTimeout(15000);

    // Press Escape to go back
    await sharedPage.keyboard.press('Escape');

    // Wait for menu to reappear
    await sharedPage.waitForSelector('.menu-item', { timeout: 10000 });
    await sharedPage.waitForTimeout(1000);

    // Get the menu items now visible
    const labels = await sharedPage.locator('.menu-item h3').allTextContents();
    const trimmed = labels.map(l => l.trim());
    console.log('Menu after Escape:', trimmed.join(', '));

    // THE BUG: if we see root menu items (Cartoons, Games, Music, etc.) instead of FHE items
    const isBaseMenu = trimmed.includes('Cartoons') || trimmed.includes('Games') || trimmed.includes('Music');
    const isFHEMenu = trimmed.includes('Opening Hymn') || trimmed.includes('Closing Hymn');

    if (isBaseMenu && !isFHEMenu) {
      console.error('BUG CONFIRMED: Escape returned to BASE menu instead of FHE submenu');
      console.error('Expected: FHE items (Opening Hymn, Spotlight, Felix, ...)');
      console.error('Got: Base menu items (Cartoons, Games, Music, ...)');
    }

    expect(isFHEMenu, 'Should return to FHE submenu, not base menu').toBe(true);
    expect(isBaseMenu, 'Should NOT be at base menu').toBe(false);
  });
});
