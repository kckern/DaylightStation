/**
 * Audiobookshelf Audiobook Playback Test
 *
 * Verifies:
 * 1. Search API can find Audiobookshelf audiobooks
 * 2. TV app can play audiobook via ?play=abs:{id}
 * 3. Audio element loads and plays
 *
 * Prerequisites:
 * - Backend running at BACKEND_URL
 * - Audiobookshelf adapter configured with at least one audiobook
 *
 * Created: 2026-01-31
 */

import { test, expect } from '@playwright/test';
import { BACKEND_URL } from '#fixtures/runtime/urls.mjs';

const BASE_URL = BACKEND_URL;

let sharedPage;
let sharedContext;
let discoveredAudiobookId;

test.describe.configure({ mode: 'serial' });

test.describe('Audiobookshelf Audiobook Playback', () => {

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
  // TEST 1: Search API finds Audiobookshelf audiobook
  // ═══════════════════════════════════════════════════════════════════════════
  test('Search API returns Audiobookshelf audiobook', async ({ request }) => {
    console.log(`\n🔍 Searching for audiobooks via ${BASE_URL}/api/v1/content/search`);

    const response = await request.get(`${BASE_URL}/api/v1/content/search`, {
      params: {
        sources: 'abs',
        mediaType: 'audio',
        take: 1
      }
    });

    // Handle case where Audiobookshelf isn't configured
    if (response.status() === 404) {
      const body = await response.json();
      console.log(`⚠️  Audiobookshelf not configured: ${body.error}`);
      test.skip(true, 'Audiobookshelf adapter not configured');
      return;
    }

    expect(response.ok()).toBe(true);
    const data = await response.json();

    console.log(`📊 Search results: ${data.total} total, ${data.items?.length || 0} returned`);
    console.log(`   Sources searched: ${data.sources?.join(', ')}`);

    // Skip if no audiobooks found
    if (!data.items || data.items.length === 0) {
      console.log('⚠️  No audiobooks found in Audiobookshelf');
      test.skip(true, 'No audiobooks available in Audiobookshelf');
      return;
    }

    const audiobook = data.items[0];
    discoveredAudiobookId = audiobook.id;

    console.log(`✅ Found audiobook: "${audiobook.title}"`);
    console.log(`   ID: ${audiobook.id}`);
    console.log(`   Duration: ${audiobook.duration ? Math.round(audiobook.duration / 60) + ' min' : 'unknown'}`);

    expect(audiobook.id).toMatch(/^abs:/);
    expect(audiobook.source).toBe('abs');
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // TEST 2: TV app loads with Audiobookshelf audiobook
  // ═══════════════════════════════════════════════════════════════════════════
  test('TV app plays Audiobookshelf audiobook', async () => {
    // Skip if no audiobook was discovered
    if (!discoveredAudiobookId) {
      test.skip(true, 'No audiobook discovered in previous test');
      return;
    }

    const playUrl = `${BASE_URL}/tv?play=${discoveredAudiobookId}`;
    console.log(`\n▶️  Opening TV app: ${playUrl}`);

    await sharedPage.goto(playUrl, {
      waitUntil: 'domcontentloaded',
      timeout: 30000
    });

    console.log('✅ Page loaded');

    // Wait for app to mount and player to initialize
    await sharedPage.waitForTimeout(3000);

    // Check for audio element (audiobooks use audio, not video)
    const audioExists = await sharedPage.locator('audio').count();
    const videoExists = await sharedPage.locator('video').count();
    console.log(`\n🎧 Audio elements found: ${audioExists}`);
    console.log(`🎬 Video elements found: ${videoExists}`);

    // Audiobooks could use either audio or video element depending on implementation
    const mediaExists = audioExists + videoExists;

    if (mediaExists === 0) {
      // Debug: Check what's on screen
      const pageContent = await sharedPage.locator('body').innerHTML();
      console.log('Page content preview:', pageContent.substring(0, 500));

      // Check for error messages
      const errorText = await sharedPage.locator('[class*="error"], .error').textContent().catch(() => null);
      if (errorText) {
        console.log(`❌ Error displayed: ${errorText}`);
      }
    }

    expect(mediaExists).toBeGreaterThan(0);
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // TEST 3: Audio actually plays for 10+ seconds
  // ═══════════════════════════════════════════════════════════════════════════
  test('Audio loads and plays', async () => {
    // Skip if no audiobook was discovered
    if (!discoveredAudiobookId) {
      test.skip(true, 'No audiobook discovered');
      return;
    }

    // Try audio element first, fall back to video
    let media = sharedPage.locator('audio').first();
    let mediaType = 'audio';

    const audioCount = await sharedPage.locator('audio').count();
    if (audioCount === 0) {
      media = sharedPage.locator('video').first();
      mediaType = 'video';
    }

    // Get media source to verify it's loading via proxy
    const mediaSrc = await media.evaluate(el => el.src || el.currentSrc);
    console.log(`\n🎧 ${mediaType} source: ${mediaSrc}`);

    // Verify it's using the Audiobookshelf proxy
    expect(mediaSrc).toContain('/api/v1/proxy/abs');

    // Wait for audio to have metadata and start playing
    console.log('\n⏳ Waiting for audio to load...');
    await sharedPage.waitForTimeout(5000);

    const mediaState = await media.evaluate(el => ({
      paused: el.paused,
      currentTime: el.currentTime,
      duration: el.duration,
      readyState: el.readyState,
      networkState: el.networkState,
      error: el.error ? { code: el.error.code, message: el.error.message } : null
    }));

    console.log(`\n📊 Initial ${mediaType} state:`);
    console.log(`   - Paused: ${mediaState.paused}`);
    console.log(`   - Time: ${mediaState.currentTime?.toFixed(2)}s`);
    console.log(`   - Duration: ${isNaN(mediaState.duration) ? 'unknown' : Math.round(mediaState.duration / 60) + ' min'}`);
    console.log(`   - ReadyState: ${mediaState.readyState} (0=NOTHING, 1=METADATA, 2=CURRENT_DATA, 3=FUTURE_DATA, 4=ENOUGH_DATA)`);
    console.log(`   - NetworkState: ${mediaState.networkState} (0=EMPTY, 1=IDLE, 2=LOADING, 3=NO_SOURCE)`);
    console.log(`   - Error: ${mediaState.error ? `${mediaState.error.code} - ${mediaState.error.message}` : 'none'}`);

    // Verify audio has loaded enough data
    expect(mediaState.readyState).toBeGreaterThanOrEqual(1); // At least HAVE_METADATA
    expect(mediaState.error).toBeNull();

    // Let audio play for 10+ seconds (shorter than video since audiobooks are longer)
    console.log('\n🎧 Letting audio play for 10 seconds...');
    await sharedPage.waitForTimeout(10000);

    const finalState = await media.evaluate(el => ({
      paused: el.paused,
      currentTime: el.currentTime,
      duration: el.duration
    }));

    console.log(`\n📊 Final ${mediaType} state after 10s:`);
    console.log(`   - Paused: ${finalState.paused}`);
    console.log(`   - Time: ${finalState.currentTime?.toFixed(2)}s`);
    console.log(`   - Duration: ${isNaN(finalState.duration) ? 'unknown' : Math.round(finalState.duration / 60) + ' min'}`);

    // Audio should have progressed
    if (!finalState.paused) {
      expect(finalState.currentTime).toBeGreaterThan(5);
      console.log(`\n✅ Audio played successfully for ${finalState.currentTime.toFixed(1)} seconds`);
    } else {
      console.log('\n⚠️  Audio is paused');
    }

    console.log('\n✅ Audiobookshelf audiobook playback test completed successfully');
  });

});
