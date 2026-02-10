// tests/live/flow/tv/tv-fhe-navigation.runtime.test.mjs
// Runtime test: open TV, navigate to FHE menu, select it, pick Opening Hymn, verify playback
import { test, expect } from '@playwright/test';
import { BACKEND_URL } from '#fixtures/runtime/urls.mjs';

const BASE_URL = BACKEND_URL;

test.describe.configure({ mode: 'serial' });

let sharedPage, sharedContext;

test.describe('TV FHE Menu Navigation', () => {
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

  test('TV page loads with root menu', async () => {
    await sharedPage.goto(`${BASE_URL}/tv`, {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    });

    await sharedPage.waitForSelector('.menu-item', { timeout: 10000 });
    await sharedPage.waitForTimeout(1000);

    const count = await sharedPage.locator('.menu-item').count();
    console.log(`Root menu: ${count} items`);
    expect(count).toBeGreaterThan(0);
  });

  test('Navigate to FHE and select it', async () => {
    const menuItems = await sharedPage.locator('.menu-item').all();

    // Find FHE index
    let fheIndex = -1;
    for (let i = 0; i < menuItems.length; i++) {
      const label = await menuItems[i].locator('h3').textContent();
      if (label?.trim() === 'FHE') {
        fheIndex = i;
        break;
      }
    }

    expect(fheIndex, 'FHE should be in the root menu').toBeGreaterThanOrEqual(0);
    console.log(`FHE at index ${fheIndex}`);

    // Navigate with arrow keys (5-column grid)
    const columns = 5;
    const row = Math.floor(fheIndex / columns);
    const col = fheIndex % columns;

    for (let i = 0; i < row; i++) {
      await sharedPage.keyboard.press('ArrowDown');
      await sharedPage.waitForTimeout(100);
    }
    for (let i = 0; i < col; i++) {
      await sharedPage.keyboard.press('ArrowRight');
      await sharedPage.waitForTimeout(100);
    }

    // Verify FHE is active
    const activeLabel = await sharedPage.locator('.menu-item.active h3').textContent();
    console.log(`Active item: "${activeLabel?.trim()}"`);
    expect(activeLabel?.trim()).toBe('FHE');

    // Select FHE
    await sharedPage.keyboard.press('Enter');

    // Wait for submenu to load
    let submenuLoaded = false;
    for (let attempt = 0; attempt < 20; attempt++) {
      await sharedPage.waitForTimeout(500);
      const items = await sharedPage.locator('.menu-item').all();
      if (items.length > 0) {
        // Check if we're in the FHE submenu by looking for "Opening Hymn"
        for (const item of items) {
          const label = await item.locator('h3').textContent();
          if (label?.trim() === 'Opening Hymn') {
            submenuLoaded = true;
            break;
          }
        }
        if (submenuLoaded) break;
      }
    }

    expect(submenuLoaded, 'FHE submenu should load with Opening Hymn').toBe(true);

    const submenuCount = await sharedPage.locator('.menu-item').count();
    console.log(`FHE submenu: ${submenuCount} items`);
    expect(submenuCount).toBeGreaterThan(0);
  });

  test('FHE submenu contains expected items', async () => {
    const items = await sharedPage.locator('.menu-item').all();
    const labels = [];
    for (const item of items) {
      const label = await item.locator('h3').textContent();
      labels.push(label?.trim());
    }

    console.log('FHE items:', labels.join(', '));

    expect(labels).toContain('Opening Hymn');
    expect(labels).toContain('Closing Hymn');
  });

  test('Select Opening Hymn and verify singalong plays', async () => {
    test.setTimeout(60000);

    const menuItems = await sharedPage.locator('.menu-item').all();

    // Find Opening Hymn index
    let hymnIndex = -1;
    for (let i = 0; i < menuItems.length; i++) {
      const label = await menuItems[i].locator('h3').textContent();
      if (label?.trim() === 'Opening Hymn') {
        hymnIndex = i;
        break;
      }
    }

    expect(hymnIndex, 'Opening Hymn should be in FHE menu').toBeGreaterThanOrEqual(0);
    console.log(`Opening Hymn at index ${hymnIndex}`);

    // Navigate to it
    const columns = 5;
    const row = Math.floor(hymnIndex / columns);
    const col = hymnIndex % columns;

    for (let i = 0; i < row; i++) {
      await sharedPage.keyboard.press('ArrowDown');
      await sharedPage.waitForTimeout(100);
    }
    for (let i = 0; i < col; i++) {
      await sharedPage.keyboard.press('ArrowRight');
      await sharedPage.waitForTimeout(100);
    }

    // Verify correct item is active
    const activeLabel = await sharedPage.locator('.menu-item.active h3').textContent();
    console.log(`Active item: "${activeLabel?.trim()}"`);
    expect(activeLabel?.trim()).toBe('Opening Hymn');

    // Select it
    await sharedPage.keyboard.press('Enter');

    // Wait for audio element (singalong uses <audio>)
    let media = null;
    for (let i = 0; i < 20; i++) {
      media = await sharedPage.$('audio[src], video[src]');
      if (media) break;
      await sharedPage.waitForTimeout(1000);
    }

    expect(media, 'Audio/video element should appear').toBeTruthy();

    // Give it time to buffer and start
    await sharedPage.waitForTimeout(3000);

    const mediaState = await sharedPage.evaluate(() => {
      const el = document.querySelector('audio[src], video[src]');
      if (!el) return null;
      return {
        tag: el.tagName,
        currentTime: el.currentTime,
        paused: el.paused,
        readyState: el.readyState,
        src: (el.src || el.currentSrc || '').substring(0, 100),
        duration: el.duration,
      };
    });

    console.log('Media state:', JSON.stringify(mediaState, null, 2));
    expect(mediaState).not.toBeNull();
    expect(mediaState.readyState, 'Media should have loaded').toBeGreaterThan(0);
    expect(mediaState.paused, 'Media should be playing').toBe(false);
    expect(mediaState.duration, 'Media should have a duration').toBeGreaterThan(0);
  });

  test('Playhead advances', async () => {
    const time1 = await sharedPage.evaluate(() => {
      const el = document.querySelector('audio[src], video[src]');
      return el?.currentTime ?? null;
    });
    expect(time1, 'Media should exist').not.toBeNull();

    await sharedPage.waitForTimeout(5000);

    const time2 = await sharedPage.evaluate(() => {
      const el = document.querySelector('audio[src], video[src]');
      return el?.currentTime ?? null;
    });

    console.log(`Playhead: ${time1.toFixed(1)}s → ${time2.toFixed(1)}s (Δ${(time2 - time1).toFixed(1)}s)`);
    expect(time2 - time1, 'Playhead should advance at least 3s in 5s window').toBeGreaterThanOrEqual(3);
  });
});
