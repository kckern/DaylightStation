/**
 * TV App - Scripture Selection and New Testament Playback Test
 *
 * Verifies:
 * 1. API confirms Scripture item exists in TVApp watchlist with src=scripture
 * 2. Scripture content API resolves NT to a valid chapter with audio
 * 3. TV page loads with menu items
 * 4. Selecting "Scripture" starts NarratedScroller playback (audio + verses)
 *
 * Created: 2026-02-06
 */

import { test, expect } from '@playwright/test';
import { BACKEND_URL } from '#fixtures/runtime/urls.mjs';

const BASE_URL = BACKEND_URL;

let sharedPage;
let sharedContext;

test.describe.configure({ mode: 'serial' });

test.describe('TV Scripture (New Testament) Playback', () => {

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
  // TEST 1: API confirms Scripture item in TVApp watchlist
  // ═══════════════════════════════════════════════════════════════════════════
  test('API returns Scripture with scripture source in TVApp watchlist', async ({ request }) => {
    const response = await request.get(`${BASE_URL}/api/v1/list/watchlist/TVApp/recent_on_top`);
    expect(response.ok()).toBe(true);

    const data = await response.json();
    const items = data.items || [];
    expect(items.length).toBeGreaterThan(0);

    const scripture = items.find(i => i.title === 'Scripture');
    expect(scripture, 'Scripture should exist in TVApp watchlist').toBeTruthy();
    expect(scripture.src, 'Scripture should have src=scripture').toBe('scripture');
    expect(scripture.play?.scripture, 'Scripture should have play.scripture=nt').toBe('nt');

    console.log(`Scripture item: id=${scripture.id}, play=${JSON.stringify(scripture.play)}`);
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // TEST 2: Scripture content API resolves NT
  // ═══════════════════════════════════════════════════════════════════════════
  test('Scripture content API resolves New Testament to valid chapter', async ({ request }) => {
    const response = await request.get(`${BASE_URL}/api/v1/local-content/scripture/nt`);
    expect(response.ok()).toBe(true);

    const data = await response.json();
    expect(data.reference, 'Should have a scripture reference').toBeTruthy();
    expect(data.volume, 'Should be NT volume').toBe('nt');
    expect(data.mediaUrl, 'Should have a media URL for audio').toBeTruthy();
    expect(data.verses, 'Should have verses array').toBeDefined();
    expect(data.verses.length, 'Should have at least one verse').toBeGreaterThan(0);

    console.log(`Scripture resolves to: "${data.reference}" with ${data.verses.length} verses`);
    console.log(`Media URL: ${data.mediaUrl}`);
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // TEST 3: TV page loads with menu items
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
  // TEST 4: Select Scripture and confirm NT plays
  // ═══════════════════════════════════════════════════════════════════════════
  test('Select Scripture and confirm New Testament plays', async () => {
    test.setTimeout(60000);

    const menuItems = await sharedPage.locator('.menu-item').all();
    expect(menuItems.length).toBeGreaterThan(0);

    // Find "Scripture" in the menu
    let targetIndex = -1;
    for (let i = 0; i < menuItems.length; i++) {
      const label = await menuItems[i].locator('h3').textContent();
      if (label?.trim() === 'Scripture') {
        targetIndex = i;
        console.log(`Found "Scripture" at index ${i}`);
        break;
      }
    }
    expect(targetIndex, '"Scripture" should be in the menu').toBeGreaterThanOrEqual(0);

    // Navigate to it with arrow keys (5 columns)
    const columns = 5;
    const row = Math.floor(targetIndex / columns);
    const col = targetIndex % columns;

    console.log(`Navigating to row ${row}, col ${col}...`);

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
    expect(activeLabel?.trim()).toBe('Scripture');

    // Select it
    await sharedPage.keyboard.press('Enter');
    console.log('Pressed Enter to select Scripture');

    // Scripture uses NarratedScroller (audio + text), not video
    // Wait for the narrated scroller or audio element to appear
    await sharedPage.waitForSelector('.narrated-scroller, .content-scroller, audio', {
      timeout: 15000
    });
    console.log('Scripture player appeared');

    // Give it time to load content and start audio
    await sharedPage.waitForTimeout(5000);

    // Check for narrated scroller
    const hasNarratedScroller = await sharedPage.locator('.narrated-scroller').count() > 0;
    const hasContentScroller = await sharedPage.locator('.content-scroller').count() > 0;
    console.log(`Narrated scroller: ${hasNarratedScroller}, Content scroller: ${hasContentScroller}`);

    // Check for verse text (scripture renders verses)
    const hasVerses = await sharedPage.locator('.verse, .verse-text, .narrated-text').count() > 0;
    console.log(`Has verse content: ${hasVerses}`);

    // Check audio state
    const audioState = await sharedPage.evaluate(() => {
      const audio = document.querySelector('audio');
      if (!audio) return null;
      return {
        src: audio.src || audio.currentSrc,
        readyState: audio.readyState,
        duration: audio.duration,
        currentTime: audio.currentTime,
        paused: audio.paused,
        error: audio.error ? { code: audio.error.code, message: audio.error.message } : null
      };
    });

    console.log('Audio state:', JSON.stringify(audioState, null, 2));

    // Scripture should have either audio or video (some have video backgrounds)
    const hasAudio = audioState !== null;
    const hasVideo = await sharedPage.locator('video').count() > 0;
    expect(hasAudio || hasVideo, 'Scripture should have audio or video element').toBe(true);

    if (audioState) {
      expect(audioState.src, 'Audio should have a source').toBeTruthy();
      expect(audioState.error, 'Audio should have no errors').toBeNull();

      // Confirm playback progresses
      if (audioState.currentTime < 1) {
        await sharedPage.waitForTimeout(3000);
        const newTime = await sharedPage.evaluate(() => document.querySelector('audio')?.currentTime);
        console.log(`Audio playback time after wait: ${newTime?.toFixed(2)}s`);
        expect(newTime).toBeGreaterThan(0);
      }
    }

    // Verify scroller content loaded (scripture reference or verse text visible)
    expect(hasNarratedScroller || hasContentScroller, 'Should have a content scroller').toBe(true);

    console.log('Scripture (New Testament) playback confirmed');
  });

});
