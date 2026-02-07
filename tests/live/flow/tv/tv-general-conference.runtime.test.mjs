/**
 * TV App - General Conference Selection and Playback Test
 *
 * Verifies:
 * 1. TV page loads with menu items
 * 2. "General Conference" exists in the menu
 * 3. Selecting it starts talk playback
 * 4. Video element loads and plays without errors
 *
 * Created: 2026-02-06
 */

import { test, expect } from '@playwright/test';
import { BACKEND_URL } from '#fixtures/runtime/urls.mjs';

const BASE_URL = BACKEND_URL;

let sharedPage;
let sharedContext;

test.describe.configure({ mode: 'serial' });

test.describe('TV General Conference Playback', () => {

  test.beforeAll(async ({ browser }) => {
    sharedContext = await browser.newContext({
      viewport: { width: 1920, height: 1080 }
    });
    sharedPage = await sharedContext.newPage();

    try {
      const cdp = await sharedContext.newCDPSession(sharedPage);
      await cdp.send('Emulation.setAutoplayPolicy', { autoplayPolicy: 'no-user-gesture-required' });
    } catch (e) {
      console.log('Could not set autoplay policy:', e.message);
    }

    sharedPage.on('console', msg => {
      if (msg.type() === 'error') {
        console.log(`Browser console error: ${msg.text()}`);
      }
    });

    sharedPage.on('pageerror', error => {
      console.log(`Page error: ${error.message}`);
    });
  });

  test.afterAll(async () => {
    if (sharedPage) await sharedPage.close();
    if (sharedContext) await sharedContext.close();
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // TEST 1: API confirms General Conference is a talk action
  // ═══════════════════════════════════════════════════════════════════════════
  test('API returns General Conference with talk source', async ({ request }) => {
    const response = await request.get(`${BASE_URL}/api/v1/info/watchlist/TVApp`);
    expect(response.ok()).toBe(true);

    const data = await response.json();
    const items = data.items || [];

    const gc = items.find(i => i.title === 'General Conference');
    expect(gc, 'General Conference should exist in TVApp watchlist').toBeTruthy();
    expect(gc.metadata?.src, 'General Conference should have src=talk').toBe('talk');
    expect(gc.metadata?.assetId, 'General Conference should have an assetId').toBeTruthy();

    console.log(`General Conference assetId: ${gc.metadata.assetId}`);

    // Verify the talk endpoint resolves
    const talkResponse = await request.get(`${BASE_URL}/api/v1/local-content/talk/${gc.metadata.assetId}`);
    expect(talkResponse.ok(), `Talk endpoint should resolve ${gc.metadata.assetId}`).toBe(true);

    const talk = await talkResponse.json();
    expect(talk.title).toBeTruthy();
    expect(talk.mediaUrl).toBeTruthy();
    console.log(`Resolves to: "${talk.title}" (${talk.mediaUrl})`);
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // TEST 2: TV page loads and menu is visible
  // ═══════════════════════════════════════════════════════════════════════════
  test('TV page loads with menu items', async () => {
    await sharedPage.goto(`${BASE_URL}/tv`, {
      waitUntil: 'domcontentloaded',
      timeout: 30000
    });

    await sharedPage.waitForSelector('.menu-item', { timeout: 10000 });

    const menuItems = await sharedPage.locator('.menu-item').count();
    console.log(`Found ${menuItems} menu items`);
    expect(menuItems).toBeGreaterThan(0);
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // TEST 3: Select General Conference and confirm playback
  // ═══════════════════════════════════════════════════════════════════════════
  test('Select General Conference and confirm it plays', async () => {
    test.setTimeout(60000);

    const menuItems = await sharedPage.locator('.menu-item').all();
    expect(menuItems.length).toBeGreaterThan(0);

    // Find "General Conference" index
    let targetIndex = -1;
    for (let i = 0; i < menuItems.length; i++) {
      const label = await menuItems[i].locator('h3').textContent();
      if (label?.trim() === 'General Conference') {
        targetIndex = i;
        console.log(`Found "General Conference" at index ${i}`);
        break;
      }
    }
    expect(targetIndex, '"General Conference" should be in the menu').toBeGreaterThanOrEqual(0);

    // Navigate to it with arrow keys (5 columns)
    const columns = 5;
    const row = Math.floor(targetIndex / columns);
    const col = targetIndex % columns;

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
    expect(activeLabel?.trim()).toBe('General Conference');

    // Select it
    await sharedPage.keyboard.press('Enter');
    console.log('Pressed Enter to select General Conference');

    // Wait for player to load - look for a video element
    await sharedPage.waitForSelector('video', { timeout: 15000 });
    console.log('Video element appeared');

    // Give the video time to buffer
    await sharedPage.waitForTimeout(5000);

    // Verify video state
    const videoState = await sharedPage.evaluate(() => {
      const video = document.querySelector('video');
      if (!video) return null;
      return {
        src: video.src || video.currentSrc,
        readyState: video.readyState,
        duration: video.duration,
        currentTime: video.currentTime,
        paused: video.paused,
        error: video.error ? { code: video.error.code, message: video.error.message } : null
      };
    });

    console.log('Video state:', JSON.stringify(videoState, null, 2));

    expect(videoState, 'Video element should exist').toBeTruthy();
    expect(videoState.src, 'Video should have a source').toBeTruthy();
    expect(videoState.error, 'Video should have no errors').toBeNull();
    expect(videoState.readyState).toBeGreaterThanOrEqual(2);

    // Confirm playback progresses
    if (videoState.currentTime < 1) {
      await sharedPage.waitForTimeout(3000);
      const newTime = await sharedPage.evaluate(() => document.querySelector('video')?.currentTime);
      console.log(`Playback time after wait: ${newTime?.toFixed(2)}s`);
      expect(newTime).toBeGreaterThan(0);
    }

    console.log('General Conference playback confirmed');
  });

});
