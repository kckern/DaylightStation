/**
 * Hymn Singalong Playback Runtime Test
 *
 * Confirms /tv?hymn=113 loads the singalong scroller with lyrics and audio.
 *
 * Prerequisites:
 * - Dev server running (npm run dev)
 */

import { test, expect } from '@playwright/test';
import { FRONTEND_URL } from '#fixtures/runtime/urls.mjs';

const HYMN_NUMBER = 113;

test.describe('Hymn singalong playback', () => {
  test(`tv?hymn=${HYMN_NUMBER} loads singalong scroller with lyrics and audio`, async ({ page }) => {
    test.setTimeout(30000);

    page.on('pageerror', (error) => {
      console.error('Page error:', error);
    });

    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        console.error('Console error:', msg.text());
      }
    });

    const url = `${FRONTEND_URL}/tv?hymn=${HYMN_NUMBER}`;
    console.log(`\nNavigating to: ${url}`);

    await page.goto(url, {
      waitUntil: 'domcontentloaded',
      timeout: 10000
    });

    // Wait for the singalong scroller to mount
    await page.waitForSelector('.singalong-scroller', {
      timeout: 10000
    });

    // Wait for stanzas to render (lyrics loaded from API)
    await page.waitForSelector('.singalong-scroller .stanza', {
      timeout: 10000
    });

    // Verify lyrics content
    const lyricState = await page.evaluate(() => {
      const scroller = document.querySelector('.singalong-scroller');
      const stanzas = scroller?.querySelectorAll('.stanza') || [];
      const lines = scroller?.querySelectorAll('.stanza .line') || [];
      const firstLine = lines[0]?.textContent?.trim() || '';
      return {
        scrollerExists: Boolean(scroller),
        stanzaCount: stanzas.length,
        lineCount: lines.length,
        firstLine
      };
    });

    console.log('Lyric state:', lyricState);

    expect(lyricState.scrollerExists).toBe(true);
    expect(lyricState.stanzaCount).toBeGreaterThan(0);
    expect(lyricState.lineCount).toBeGreaterThan(0);
    expect(lyricState.firstLine.length).toBeGreaterThan(0);

    // Wait for audio element to appear and start playing
    await page.waitForFunction(() => {
      const audio = document.querySelector('audio');
      return audio && audio.currentSrc;
    }, { timeout: 10000 });

    // Capture initial playback state
    const initialState = await page.evaluate(() => {
      const audio = document.querySelector('audio');
      return {
        src: audio?.currentSrc || audio?.src || null,
        currentTime: audio?.currentTime ?? null,
        paused: audio?.paused ?? null,
        readyState: audio?.readyState ?? null,
        error: audio?.error ? { code: audio.error.code, message: audio.error.message } : null
      };
    });

    console.log('Initial audio state:', initialState);

    expect(initialState.src).toBeTruthy();
    expect(initialState.error).toBeNull();

    // Wait for playback to advance
    await page.waitForFunction(() => {
      const audio = document.querySelector('audio');
      return audio && audio.currentTime > 0.2;
    }, { timeout: 10000 });

    const playingState = await page.evaluate(() => {
      const audio = document.querySelector('audio');
      return {
        currentTime: audio?.currentTime ?? null,
        paused: audio?.paused ?? null,
        readyState: audio?.readyState ?? null
      };
    });

    console.log('Playing state:', playingState);

    expect(playingState.paused).toBe(false);
    expect(playingState.currentTime).toBeGreaterThan(0);
    expect(playingState.readyState).toBeGreaterThanOrEqual(2);
  });
});
