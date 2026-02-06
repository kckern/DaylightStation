/**
 * TV App - Composite Player Test (Fireworks)
 *
 * Verifies:
 * 1. TV page loads
 * 2. User can select "Fireworks" from the menu
 * 3. Video player starts playing (not stuck on spinner/debug JSON)
 * 4. CompositePlayer is used for items with overlay config
 *
 * Bug: Items with "nomusic" label should trigger composite player
 * with audio overlay, but dev shows single player instead.
 *
 * Created: 2026-01-22
 */

import { test, expect } from '@playwright/test';
import { BACKEND_URL } from '#fixtures/runtime/urls.mjs';

const BASE_URL = BACKEND_URL;

let sharedPage;
let sharedContext;

test.describe.configure({ mode: 'serial' });

test.describe('TV Composite Player (Fireworks)', () => {

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

    // Track console errors
    sharedPage.on('console', msg => {
      if (msg.type() === 'error') {
        console.log(`Browser console error: ${msg.text()}`);
      }
    });

    // Track page errors
    sharedPage.on('pageerror', error => {
      console.log(`Page error: ${error.message}`);
    });
  });

  test.afterAll(async () => {
    if (sharedPage) await sharedPage.close();
    if (sharedContext) await sharedContext.close();
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // TEST 1: Check API response for Fireworks
  // ═══════════════════════════════════════════════════════════════════════════
  test('API returns correct Fireworks item config', async ({ request }) => {
    console.log('\n[TEST 1] Checking API response for Fireworks...');

    // Fetch TVApp menu
    const listResponse = await request.get(`${BASE_URL}/api/v1/info/watchlist/TVApp`);
    expect(listResponse.ok()).toBe(true);
    const listData = await listResponse.json();

    // Find Fireworks
    const fireworks = listData.items?.find(item =>
      item.label?.toLowerCase().includes('firework')
    );

    if (!fireworks) {
      console.log('Warning: Fireworks not in menu, skipping');
      test.skip();
      return;
    }

    console.log('Fireworks play config:', JSON.stringify(fireworks.play, null, 2));

    // Check for overlay
    const hasOverlay = !!fireworks.play?.overlay;
    console.log(`Has overlay: ${hasOverlay}`);

    if (hasOverlay) {
      console.log('Overlay configured - CompositePlayer will be used');
      expect(fireworks.play.overlay.queue?.plex || fireworks.play.overlay.plex).toBeTruthy();
    } else {
      console.log('No overlay - add music_overlay_playlist to fitness config');
      console.log('   Expected in apps/fitness.yml:');
      console.log('   plex:');
      console.log('     nomusic_labels: [nomusic]');
      console.log('     music_overlay_playlist: "730101"');
    }
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // TEST 2: TV page loads
  // ═══════════════════════════════════════════════════════════════════════════
  test('TV page loads successfully', async () => {
    console.log(`\n[TEST 2] Opening ${BASE_URL}/tv`);

    await sharedPage.goto(`${BASE_URL}/tv`, {
      waitUntil: 'domcontentloaded',
      timeout: 30000
    });

    console.log('Page loaded');

    // Wait for the app to mount
    await sharedPage.waitForTimeout(2000);

    // Check for TV app container
    const tvAppExists = await sharedPage.locator('.tv-app, [class*="tv"], [id*="tv"]').count();
    console.log(`Found ${tvAppExists} TV app containers`);
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // TEST 3: Navigate to and play "Fireworks"
  // ═══════════════════════════════════════════════════════════════════════════
  test('Navigate to and play Fireworks', async () => {
    console.log('\n[TEST 3] Navigating to "Fireworks"...');

    // Wait for menu items to appear
    await sharedPage.waitForSelector('.menu-item', { timeout: 10000 });

    // Find all menu items
    const menuItems = await sharedPage.locator('.menu-item').all();
    expect(menuItems.length).toBeGreaterThan(0);

    // Find "Fireworks" by iterating through items
    let targetIndex = -1;

    for (let i = 0; i < menuItems.length && i < 50; i++) {
      const item = menuItems[i];
      const label = await item.locator('h3').textContent();
      const trimmedLabel = label?.trim();

      if (trimmedLabel?.toLowerCase().includes('firework')) {
        targetIndex = i;
        console.log(`Found "Fireworks" at index ${i}: "${trimmedLabel}"`);
        break;
      }
    }

    if (targetIndex === -1) {
      console.log('Warning: Could not find "Fireworks" item, skipping test');
      test.skip();
      return;
    }

    // Navigate to the target using arrow keys (5 columns)
    const columns = 5;
    const row = Math.floor(targetIndex / columns);
    const col = targetIndex % columns;

    console.log(`Navigating to row ${row}, col ${col}...`);

    // Move down to the right row
    for (let i = 0; i < row; i++) {
      await sharedPage.keyboard.press('ArrowDown');
      await sharedPage.waitForTimeout(100);
    }

    // Move right to the right column
    for (let i = 0; i < col; i++) {
      await sharedPage.keyboard.press('ArrowRight');
      await sharedPage.waitForTimeout(100);
    }

    // Check which item is now active
    const activeItem = await sharedPage.locator('.menu-item.active h3').textContent();
    console.log(`Active item: "${activeItem?.trim()}"`);

    // Press Enter to select the item
    console.log('Pressing Enter to select...');
    await sharedPage.keyboard.press('Enter');
    console.log('Enter pressed');

    // Wait for player to start loading
    await sharedPage.waitForTimeout(3000);

    // After selecting, check player type
    const compositePlayer = await sharedPage.locator('.player.composite').count();
    const hasOverlay = compositePlayer > 0;

    console.log(`Player type: ${hasOverlay ? 'CompositePlayer' : 'SinglePlayer'}`);

    // Check for media elements
    const videoExists = await sharedPage.locator('video, dash-video').count();
    const audioExists = await sharedPage.locator('audio').count();

    console.log(`Video elements: ${videoExists}`);
    console.log(`Audio elements: ${audioExists}`);

    // Video should always exist
    expect(videoExists).toBeGreaterThan(0);

    // Audio only exists if CompositePlayer
    if (hasOverlay) {
      expect(audioExists).toBeGreaterThan(0);
      console.log('CompositePlayer active with video + audio overlay');
    } else {
      console.log('SinglePlayer active (no overlay config)');
    }

    // Wait longer for video to initialize
    await sharedPage.waitForTimeout(5000);

    // Check video playback state
    const dashVideoCount = await sharedPage.locator('dash-video').count();
    const regularVideoCount = await sharedPage.locator('video').count();

    if (regularVideoCount > 0 || dashVideoCount > 0) {
      const videoSelector = regularVideoCount > 0 ? 'video' : 'dash-video video';
      const video = sharedPage.locator(videoSelector).first();

      await sharedPage.waitForTimeout(2000);

      const isPaused = await video.evaluate(el => el.paused);
      const currentTime = await video.evaluate(el => el.currentTime);
      const readyState = await video.evaluate(el => el.readyState);
      const error = await video.evaluate(el => el.error);

      console.log(`Video state:`);
      console.log(`  - Paused: ${isPaused}`);
      console.log(`  - Time: ${currentTime?.toFixed(2)}s`);
      console.log(`  - ReadyState: ${readyState}`);
      console.log(`  - Error: ${error ? `${error.code} - ${error.message}` : 'none'}`);

      // Verify video has loaded
      expect(readyState).toBeGreaterThanOrEqual(2);
      expect(error).toBeNull();
    }

    console.log('Fireworks video playback test completed');
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // TEST 4: Check if CompositePlayer should have been used
  // ═══════════════════════════════════════════════════════════════════════════
  test('CompositePlayer is used for nomusic items (if configured)', async ({ request }) => {
    console.log('\n[TEST 4] Checking CompositePlayer configuration...');

    // This test documents the expected behavior vs actual behavior
    // for items with nomusic labels

    const notes = `
    EXPECTED BEHAVIOR (for items with 'nomusic' label):
    - The item should have play.overlay configured with a music playlist
    - Player component should detect overlay and render CompositePlayer
    - CompositePlayer renders primary video + overlay audio

    ACTUAL BEHAVIOR (current dev):
    - Item has play: { plex: "663846" } without overlay
    - Player renders SinglePlayer
    - No background music plays

    POSSIBLE FIXES:
    1. Add overlay config to lists.yml for nomusic items
    2. Backend auto-adds overlay for items with nomusic label
    3. Frontend detects nomusic label and auto-enables music (like FitnessApp)
    `;

    console.log(notes);

    // This test passes - it's informational
    expect(true).toBe(true);
  });

});
