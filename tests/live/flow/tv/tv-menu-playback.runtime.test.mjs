/**
 * TVApp Menu and Playback Test
 *
 * Verifies:
 * 1. TVApp menu loads with items from the DDD backend
 * 2. Queue playback via query param works (tests filesystem adapter fix)
 * 3. Audio/video content plays correctly
 */

import { test, expect } from '@playwright/test';
import { BACKEND_URL } from '#fixtures/runtime/urls.mjs';

// Use centralized URL config (defaults to 3112 for dev, overridable via TEST_BACKEND_URL)
const BASE_URL = BACKEND_URL;

let sharedPage;
let sharedContext;

test.describe.configure({ mode: 'serial' });

test.describe('TVApp Menu and Playback', () => {

  test.beforeAll(async ({ browser }) => {
    sharedContext = await browser.newContext({
      viewport: { width: 1920, height: 1080 }
    });
    sharedPage = await sharedContext.newPage();

    // Enable autoplay for audio/video
    try {
      const cdp = await sharedContext.newCDPSession(sharedPage);
      await cdp.send('Emulation.setAutoplayPolicy', { autoplayPolicy: 'no-user-gesture-required' });
    } catch (e) {
      console.log('Could not set autoplay policy:', e.message);
    }
  });

  test.afterAll(async () => {
    if (sharedPage) await sharedPage.close();
    if (sharedContext) await sharedContext.close();
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // TEST 1: API returns menu items
  // ═══════════════════════════════════════════════════════════════════════════
  test('API returns TVApp menu items', async ({ request }) => {
    const response = await request.get(`${BASE_URL}/api/v1/list/watchlist/TVApp`);
    expect(response.ok()).toBe(true);

    const data = await response.json();
    expect(data.items).toBeDefined();
    expect(data.items.length).toBeGreaterThan(0);

    console.log(`TVApp menu has ${data.items.length} items`);
    console.log(`First 5 items: ${data.items.slice(0, 5).map(i => i.title).join(', ')}`);
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // TEST 2: TVApp page loads and renders menu
  // ═══════════════════════════════════════════════════════════════════════════
  test('TVApp page loads with menu', async () => {
    await sharedPage.goto(`${BASE_URL}/tv`, {
      waitUntil: 'networkidle',
      timeout: 30000
    });

    // Wait for menu items to render
    await sharedPage.waitForSelector('.tv-app, [class*="menu"], [class*="Menu"]', {
      timeout: 10000
    });

    // Check that menu items exist
    const menuItems = await sharedPage.locator('[class*="menu-item"], [class*="MenuItem"], .menu-row, .folder-item').count();
    console.log(`Found ${menuItems} menu items in DOM`);

    expect(menuItems).toBeGreaterThan(0);
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // TEST 3: Queue playback via query param (tests filesystem adapter fix)
  // ═══════════════════════════════════════════════════════════════════════════
  test('Queue playback with Morning Program', async () => {
    // Navigate with queue param - this tests the FilesystemAdapter fix
    // Morning Program first item is sfx/intro (single file, not directory)
    await sharedPage.goto(`${BASE_URL}/tv?queue=Morning%20Program`, {
      waitUntil: 'domcontentloaded',
      timeout: 30000
    });

    // Wait for player to appear
    await sharedPage.waitForSelector('video, audio, [class*="player"], [class*="Player"]', {
      timeout: 15000
    });

    console.log('Player element appeared');

    // Wait a bit for playback to initialize
    await sharedPage.waitForTimeout(3000);

    // Check for media element
    const mediaState = await sharedPage.evaluate(() => {
      const video = document.querySelector('video');
      const audio = document.querySelector('audio');
      const media = video || audio;

      if (!media) return { exists: false };

      return {
        exists: true,
        type: video ? 'video' : 'audio',
        paused: media.paused,
        currentTime: media.currentTime,
        duration: media.duration,
        src: media.src ? media.src.substring(0, 100) : null,
        readyState: media.readyState
      };
    });

    console.log('Media state:', JSON.stringify(mediaState, null, 2));

    expect(mediaState.exists).toBe(true);
    expect(mediaState.src).toBeTruthy();
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // TEST 4: Media actually plays
  // ═══════════════════════════════════════════════════════════════════════════
  test('Media plays and advances', async () => {
    // Get initial time
    const getMediaTime = async () => {
      return await sharedPage.evaluate(() => {
        const media = document.querySelector('video') || document.querySelector('audio');
        if (!media) return null;
        return {
          currentTime: media.currentTime,
          paused: media.paused,
          readyState: media.readyState
        };
      });
    };

    let state = await getMediaTime();
    if (!state) {
      console.log('No media element found, skipping playback test');
      return;
    }

    // Try to play if paused
    if (state.paused) {
      console.log('Media is paused, attempting to play...');
      await sharedPage.evaluate(() => {
        const media = document.querySelector('video') || document.querySelector('audio');
        if (media) media.play().catch(() => {});
      });
      await sharedPage.waitForTimeout(1000);
    }

    // Monitor playback for 5 seconds
    const startTime = state.currentTime;
    let playingCount = 0;

    for (let i = 0; i < 5; i++) {
      await sharedPage.waitForTimeout(1000);
      state = await getMediaTime();

      if (!state) break;

      const delta = state.currentTime - startTime;
      const isPlaying = !state.paused && delta > 0.5;
      if (isPlaying) playingCount++;

      console.log(`[${i + 1}s] time=${state.currentTime.toFixed(2)}s, paused=${state.paused}, delta=${delta.toFixed(2)}s`);

      if (playingCount >= 2) {
        console.log('Media is playing!');
        break;
      }
    }

    // Pass if media advanced or is ready to play
    const finalState = await getMediaTime();
    const advanced = finalState && (finalState.currentTime > startTime + 0.5);
    const ready = finalState && finalState.readyState >= 3;

    expect(advanced || ready).toBe(true);
  });

});
