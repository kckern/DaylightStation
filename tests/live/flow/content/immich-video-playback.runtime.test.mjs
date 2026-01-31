/**
 * Immich Video Playback Test
 *
 * Verifies:
 * 1. Search API can find Immich videos
 * 2. TV app can play Immich video via ?play=immich:{id}
 * 3. Video element loads and plays
 *
 * Prerequisites:
 * - Backend running at BACKEND_URL
 * - Immich adapter configured with at least one video
 *
 * Created: 2026-01-31
 */

import { test, expect } from '@playwright/test';
import { BACKEND_URL } from '#fixtures/runtime/urls.mjs';

const BASE_URL = BACKEND_URL;

let sharedPage;
let sharedContext;
let discoveredVideoId;

test.describe.configure({ mode: 'serial' });

test.describe('Immich Video Playback', () => {

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
        console.log(`❌ Browser console error: ${msg.text()}`);
      }
    });
  });

  test.afterAll(async () => {
    if (sharedPage) await sharedPage.close();
    if (sharedContext) await sharedContext.close();
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // TEST 1: Search API finds Immich video
  // ═══════════════════════════════════════════════════════════════════════════
  test('Search API returns Immich video', async ({ request }) => {
    console.log(`\n🔍 Searching for Immich videos via ${BASE_URL}/api/v1/content/search`);

    const response = await request.get(`${BASE_URL}/api/v1/content/search`, {
      params: {
        sources: 'immich',
        mediaType: 'video',
        take: 1
      }
    });

    // Handle case where Immich isn't configured
    if (response.status() === 404) {
      const body = await response.json();
      console.log(`⚠️  Immich not configured: ${body.error}`);
      test.skip(true, 'Immich adapter not configured');
      return;
    }

    expect(response.ok()).toBe(true);
    const data = await response.json();

    console.log(`📊 Search results: ${data.total} total, ${data.items?.length || 0} returned`);
    console.log(`   Sources searched: ${data.sources?.join(', ')}`);

    // Skip if no videos found
    if (!data.items || data.items.length === 0) {
      console.log('⚠️  No videos found in Immich');
      test.skip(true, 'No videos available in Immich');
      return;
    }

    const video = data.items[0];
    discoveredVideoId = video.id;

    console.log(`✅ Found video: "${video.title}"`);
    console.log(`   ID: ${video.id}`);
    console.log(`   Duration: ${video.duration || 'unknown'}s`);

    expect(video.id).toMatch(/^immich:/);
    expect(video.source).toBe('immich');
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // TEST 2: TV app loads with Immich video
  // ═══════════════════════════════════════════════════════════════════════════
  test('TV app plays Immich video', async () => {
    // Skip if no video was discovered
    if (!discoveredVideoId) {
      test.skip(true, 'No video discovered in previous test');
      return;
    }

    const playUrl = `${BASE_URL}/tv?play=${discoveredVideoId}`;
    console.log(`\n▶️  Opening TV app: ${playUrl}`);

    await sharedPage.goto(playUrl, {
      waitUntil: 'domcontentloaded',
      timeout: 30000
    });

    console.log('✅ Page loaded');

    // Wait for app to mount and player to initialize
    await sharedPage.waitForTimeout(3000);

    // Check for video element
    const videoExists = await sharedPage.locator('video').count();
    console.log(`\n🎬 Video elements found: ${videoExists}`);

    if (videoExists === 0) {
      // Debug: Check what's on screen
      const pageContent = await sharedPage.locator('body').innerHTML();
      console.log('Page content preview:', pageContent.substring(0, 500));

      // Check for error messages
      const errorText = await sharedPage.locator('[class*="error"], .error').textContent().catch(() => null);
      if (errorText) {
        console.log(`❌ Error displayed: ${errorText}`);
      }
    }

    expect(videoExists).toBeGreaterThan(0);
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // TEST 3: Video actually plays
  // ═══════════════════════════════════════════════════════════════════════════
  test('Video loads and plays', async () => {
    // Skip if no video was discovered
    if (!discoveredVideoId) {
      test.skip(true, 'No video discovered');
      return;
    }

    const video = sharedPage.locator('video').first();

    // Get video source to verify it's loading via proxy
    const videoSrc = await video.evaluate(el => el.src || el.currentSrc);
    console.log(`\n📹 Video source: ${videoSrc}`);

    // Verify it's using the Immich proxy
    expect(videoSrc).toContain('/api/v1/proxy/immich');

    // Wait for video to have metadata
    await sharedPage.waitForTimeout(3000);

    const videoState = await video.evaluate(el => ({
      paused: el.paused,
      currentTime: el.currentTime,
      duration: el.duration,
      readyState: el.readyState,
      networkState: el.networkState,
      error: el.error ? { code: el.error.code, message: el.error.message } : null
    }));

    console.log(`\n📊 Video state:`);
    console.log(`   - Paused: ${videoState.paused}`);
    console.log(`   - Time: ${videoState.currentTime?.toFixed(2)}s`);
    console.log(`   - Duration: ${isNaN(videoState.duration) ? 'unknown' : videoState.duration?.toFixed(2) + 's'}`);
    console.log(`   - ReadyState: ${videoState.readyState} (0=NOTHING, 1=METADATA, 2=CURRENT_DATA, 3=FUTURE_DATA, 4=ENOUGH_DATA)`);
    console.log(`   - NetworkState: ${videoState.networkState} (0=EMPTY, 1=IDLE, 2=LOADING, 3=NO_SOURCE)`);
    console.log(`   - Error: ${videoState.error ? `${videoState.error.code} - ${videoState.error.message}` : 'none'}`);

    // Verify video has loaded enough data
    expect(videoState.readyState).toBeGreaterThanOrEqual(2); // HAVE_CURRENT_DATA or better
    expect(videoState.error).toBeNull();

    // If video is stuck at 0, wait a bit more for playback
    if (videoState.currentTime < 0.5) {
      console.log('\n⏱️  Waiting for playback to progress...');
      await sharedPage.waitForTimeout(2000);

      const newTime = await video.evaluate(el => el.currentTime);
      console.log(`   - New time: ${newTime.toFixed(2)}s`);

      // Video should have progressed (unless it's paused)
      if (!videoState.paused) {
        expect(newTime).toBeGreaterThan(0);
      }
    }

    console.log('\n✅ Immich video playback test completed successfully');
  });

});
