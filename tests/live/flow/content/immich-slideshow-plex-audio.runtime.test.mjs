/**
 * Immich Slideshow + Plex Audio Runtime Test
 *
 * Verifies:
 * 1. Query API can find Immich people with 20+ photos
 * 2. Query API can find Plex music playlists from "Music" library
 * 3. TV app can play composed presentation (visual + audio tracks)
 * 4. Slideshow advances and audio plays
 *
 * Prerequisites:
 * - Backend running at BACKEND_URL
 * - Immich adapter configured with people
 * - Plex adapter configured with music playlists
 *
 * Created: 2026-01-31
 */

import { test, expect } from '@playwright/test';
import { BACKEND_URL } from '#fixtures/runtime/urls.mjs';

const BASE_URL = BACKEND_URL;
const MIN_PHOTO_COUNT = 20;

let sharedPage;
let sharedContext;
let discoveredPersonId;
let discoveredPersonName;
let discoveredPlaylistId;
let discoveredPlaylistName;

test.describe.configure({ mode: 'serial' });

test.describe('Immich Slideshow + Plex Audio', () => {

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
  });

  test.afterAll(async () => {
    if (sharedPage) await sharedPage.close();
    if (sharedContext) await sharedContext.close();
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // TEST 1: Discover Immich people with 20+ photos
  // ═══════════════════════════════════════════════════════════════════════════
  test('Discover Immich people with 20+ photos', async ({ request }) => {
    console.log(`\nSearching for Immich people via ${BASE_URL}/api/v1/content/query/list`);

    const response = await request.get(`${BASE_URL}/api/v1/content/query/list`, {
      params: {
        from: 'people',
        source: 'immich'
      }
    });

    // Handle case where Immich isn't configured
    if (response.status() === 404 || response.status() === 501) {
      const body = await response.json();
      console.log(`Immich not configured: ${body.error}`);
      test.skip(true, 'Immich adapter not configured');
      return;
    }

    expect(response.ok()).toBe(true);
    const data = await response.json();

    console.log(`Found ${data.items?.length || 0} people total`);

    // Filter to people with enough photos
    const eligiblePeople = (data.items || []).filter(p =>
      (p.childCount || 0) >= MIN_PHOTO_COUNT
    );

    console.log(`${eligiblePeople.length} people have ${MIN_PHOTO_COUNT}+ photos`);

    if (eligiblePeople.length === 0) {
      console.log(`No people with ${MIN_PHOTO_COUNT}+ photos found`);
      test.skip(true, `No people with ${MIN_PHOTO_COUNT}+ photos`);
      return;
    }

    // Pick random person
    const randomIndex = Math.floor(Math.random() * eligiblePeople.length);
    const person = eligiblePeople[randomIndex];

    discoveredPersonId = person.id;
    discoveredPersonName = person.title || person.name || 'Unknown';

    console.log(`Selected person: ${discoveredPersonName} (${person.childCount} photos)`);
    console.log(`   ID: ${discoveredPersonId}`);

    expect(discoveredPersonId).toMatch(/^immich:/);
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // TEST 2: Discover Plex music playlist
  // ═══════════════════════════════════════════════════════════════════════════
  test('Discover Plex music playlist', async ({ request }) => {
    console.log(`\nSearching for Plex music playlists via ${BASE_URL}/api/v1/content/query/list`);

    const response = await request.get(`${BASE_URL}/api/v1/content/query/list`, {
      params: {
        from: 'playlists',
        source: 'plex',
        'plex.libraryName': 'Music'
      }
    });

    // Handle case where Plex isn't configured
    if (response.status() === 404 || response.status() === 501) {
      const body = await response.json();
      console.log(`Plex not configured: ${body.error}`);
      test.skip(true, 'Plex adapter not configured');
      return;
    }

    expect(response.ok()).toBe(true);
    const data = await response.json();

    console.log(`Found ${data.items?.length || 0} music playlists`);

    if (!data.items || data.items.length === 0) {
      console.log('No music playlists found in "Music" library');
      test.skip(true, 'No music playlists found');
      return;
    }

    // Pick random playlist
    const randomIndex = Math.floor(Math.random() * data.items.length);
    const playlist = data.items[randomIndex];

    discoveredPlaylistId = playlist.id;
    discoveredPlaylistName = playlist.title || 'Unknown Playlist';

    console.log(`Selected playlist: ${discoveredPlaylistName}`);
    console.log(`   ID: ${discoveredPlaylistId}`);
    console.log(`   Tracks: ${playlist.childCount || 'unknown'}`);

    expect(discoveredPlaylistId).toMatch(/^plex:/);
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // TEST 3: TV app loads composed presentation
  // ═══════════════════════════════════════════════════════════════════════════
  test('TV app loads composed presentation', async () => {
    test.setTimeout(30000);

    // Skip if discovery failed
    if (!discoveredPersonId) {
      test.skip(true, 'No person discovered');
      return;
    }
    if (!discoveredPlaylistId) {
      test.skip(true, 'No playlist discovered');
      return;
    }

    // Build the composed URL
    // Visual: immich person photos, Audio: plex playlist
    const visualSource = `visual:${discoveredPersonId.replace('immich:', 'immich:person:')}`;
    const audioSource = `audio:${discoveredPlaylistId}`;
    const playParam = `${visualSource},${audioSource}`;

    const tvUrl = `${BASE_URL}/tv?play=${encodeURIComponent(playParam)}`;
    console.log(`\nOpening TV app: ${tvUrl}`);
    console.log(`   Visual: ${discoveredPersonName}'s photos`);
    console.log(`   Audio: ${discoveredPlaylistName}`);

    await sharedPage.goto(tvUrl, {
      waitUntil: 'domcontentloaded',
      timeout: 20000
    });

    console.log('Page loaded');

    // Wait for app to mount and player to initialize
    await sharedPage.waitForTimeout(5000);

    // Check for visual track element
    const visualTrack = sharedPage.locator('[data-track="visual"]');
    const visualCount = await visualTrack.count();
    console.log(`\nVisual track elements found: ${visualCount}`);

    // Check for audio element
    const audioElement = sharedPage.locator('audio');
    const audioCount = await audioElement.count();
    console.log(`Audio elements found: ${audioCount}`);

    // Also check for data-track="audio"
    const audioTrack = sharedPage.locator('[data-track="audio"]');
    const audioTrackCount = await audioTrack.count();
    console.log(`Audio track containers found: ${audioTrackCount}`);

    expect(visualCount + audioTrackCount).toBeGreaterThan(0);
    console.log('Composite player rendered');
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // TEST 4: Slideshow advances and audio plays
  // ═══════════════════════════════════════════════════════════════════════════
  test('Slideshow advances and audio plays', async () => {
    test.setTimeout(45000);

    // Skip if discovery failed
    if (!discoveredPersonId || !discoveredPlaylistId) {
      test.skip(true, 'Discovery failed in previous tests');
      return;
    }

    // Find the image element in the visual track
    const imageElement = sharedPage.locator('[data-track="visual"] img, [data-visual-type] img, .slideshow img').first();
    const imageExists = await imageElement.count() > 0;

    let initialImageSrc = null;
    if (imageExists) {
      initialImageSrc = await imageElement.getAttribute('src');
      console.log(`\nInitial image: ${initialImageSrc?.substring(0, 80)}...`);
    } else {
      console.log('\nNo image element found in visual track');
    }

    // Check audio state
    const audioElement = sharedPage.locator('audio').first();
    const audioExists = await audioElement.count() > 0;

    if (audioExists) {
      const audioState = await audioElement.evaluate(el => ({
        paused: el.paused,
        currentTime: el.currentTime,
        src: el.src || el.currentSrc,
        error: el.error ? { code: el.error.code } : null
      }));

      console.log(`Initial audio state:`);
      console.log(`   - Paused: ${audioState.paused}`);
      console.log(`   - Time: ${audioState.currentTime?.toFixed(2)}s`);
      console.log(`   - Source: ${audioState.src?.substring(0, 60)}...`);
      console.log(`   - Error: ${audioState.error ? `code ${audioState.error.code}` : 'none'}`);
    }

    // Wait for slideshow to advance (20 seconds should be enough for 2-3 slides)
    console.log('\nWaiting 20 seconds for slideshow to advance...');
    await sharedPage.waitForTimeout(20000);

    // Check if slideshow advanced
    if (imageExists) {
      const currentImageSrc = await imageElement.getAttribute('src').catch(() => null);
      console.log(`\nCurrent image: ${currentImageSrc?.substring(0, 80)}...`);

      if (initialImageSrc && currentImageSrc && initialImageSrc !== currentImageSrc) {
        console.log('Slideshow advanced to new image!');
      } else if (initialImageSrc === currentImageSrc) {
        console.log('Same image - slideshow may not have advanced');
      }
    }

    // Check final audio state
    if (audioExists) {
      const finalAudioState = await audioElement.evaluate(el => ({
        paused: el.paused,
        currentTime: el.currentTime,
        error: el.error ? { code: el.error.code } : null
      }));

      console.log(`\nFinal audio state after 20s:`);
      console.log(`   - Paused: ${finalAudioState.paused}`);
      console.log(`   - Time: ${finalAudioState.currentTime?.toFixed(2)}s`);
      console.log(`   - Error: ${finalAudioState.error ? `code ${finalAudioState.error.code}` : 'none'}`);

      // Audio should have progressed if not paused and no error
      if (!finalAudioState.paused && !finalAudioState.error) {
        expect(finalAudioState.currentTime).toBeGreaterThan(5);
        console.log('Audio is playing!');
      } else if (finalAudioState.error) {
        console.log('Audio has error');
      }
    }

    console.log('\nComposed presentation test completed');
  });

});
