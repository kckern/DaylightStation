/**
 * FHE Opening Hymn Navigation Runtime Test
 *
 * Confirms navigating /tv → FHE menu → Opening Hymn loads the singalong
 * scroller with lyrics and audio playback.
 *
 * Prerequisites:
 * - Dev server running (npm run dev)
 */

import { test, expect } from '@playwright/test';
import { FRONTEND_URL } from '#fixtures/runtime/urls.mjs';

test.describe('FHE Opening Hymn navigation', () => {
  test('tv → FHE → Opening Hymn plays singalong', async ({ page }) => {
    test.setTimeout(30000);

    page.on('pageerror', (error) => {
      console.error('Page error:', error);
    });

    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        console.error('Console error:', msg.text());
      }
    });

    // Step 1: Load TV menu
    const url = `${FRONTEND_URL}/tv`;
    console.log(`\nNavigating to: ${url}`);

    await page.goto(url, {
      waitUntil: 'domcontentloaded',
      timeout: 10000
    });

    // Wait for menu items to render
    await page.waitForSelector('.menu-item', { timeout: 10000 });

    const rootItems = await page.evaluate(() => {
      return Array.from(document.querySelectorAll('.menu-item-label'))
        .map(el => el.textContent.trim());
    });
    console.log('Root menu items:', rootItems);

    // Step 2: Find and select FHE
    const fheIndex = rootItems.findIndex(label => label === 'FHE');
    expect(fheIndex, 'FHE should exist in root menu').toBeGreaterThanOrEqual(0);

    // Navigate to FHE item using arrow keys (first item is index 0, already active)
    for (let i = 0; i < fheIndex; i++) {
      await page.keyboard.press('ArrowRight');
      await page.waitForTimeout(100);
    }

    // Verify FHE is the active item
    const activeLabel = await page.evaluate(() => {
      const active = document.querySelector('.menu-item.active .menu-item-label');
      return active?.textContent?.trim() || '';
    });
    console.log(`Active item before Enter: "${activeLabel}"`);
    expect(activeLabel).toBe('FHE');

    // Press Enter to open FHE submenu
    await page.keyboard.press('Enter');

    // Step 3: Wait for FHE submenu to load
    await page.waitForFunction(() => {
      const labels = Array.from(document.querySelectorAll('.menu-item-label'))
        .map(el => el.textContent.trim());
      return labels.some(l => l === 'Opening Hymn');
    }, { timeout: 10000 });

    const fheItems = await page.evaluate(() => {
      return Array.from(document.querySelectorAll('.menu-item-label'))
        .map(el => el.textContent.trim());
    });
    console.log('FHE submenu items:', fheItems);

    // Step 4: Find and select Opening Hymn
    const hymnIndex = fheItems.findIndex(label => label === 'Opening Hymn');
    expect(hymnIndex, 'Opening Hymn should exist in FHE menu').toBeGreaterThanOrEqual(0);

    // Navigate to Opening Hymn if not already at index 0
    for (let i = 0; i < hymnIndex; i++) {
      await page.keyboard.press('ArrowRight');
      await page.waitForTimeout(100);
    }

    const activeHymnLabel = await page.evaluate(() => {
      const active = document.querySelector('.menu-item.active .menu-item-label');
      return active?.textContent?.trim() || '';
    });
    console.log(`Active item before Enter: "${activeHymnLabel}"`);
    expect(activeHymnLabel).toBe('Opening Hymn');

    // Press Enter to play Opening Hymn
    await page.keyboard.press('Enter');

    // Step 5: Wait for singalong scroller with lyrics
    await page.waitForSelector('.singalong-scroller', { timeout: 10000 });
    await page.waitForSelector('.singalong-scroller .stanza', { timeout: 10000 });

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

    // Step 6: Wait for audio to load and start playing
    await page.waitForFunction(() => {
      const audio = document.querySelector('audio');
      return audio && audio.currentSrc;
    }, { timeout: 10000 });

    await page.waitForFunction(() => {
      const audio = document.querySelector('audio');
      return audio && audio.currentTime > 0.2;
    }, { timeout: 10000 });

    const playingState = await page.evaluate(() => {
      const audio = document.querySelector('audio');
      return {
        src: audio?.currentSrc || audio?.src || null,
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
