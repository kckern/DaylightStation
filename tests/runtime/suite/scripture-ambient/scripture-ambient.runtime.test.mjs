/**
 * Scripture Ambient Playback Runtime Test
 *
 * Confirms /tv?scripture=nt loads and both ambient + main audio play.
 *
 * Prerequisites:
 * - Dev server running (npm run dev)
 */

import { test, expect } from '@playwright/test';
import { FRONTEND_URL } from '#fixtures/runtime/urls.mjs';

test.describe('Scripture ambient playback', () => {
  test('tv?scripture=nt plays main + ambient audio', async ({ page }) => {
    test.setTimeout(20000);

    const url = `${FRONTEND_URL}/tv?scripture=nt`;
    console.log(`\nNavigating to: ${url}`);

    await page.goto(url, {
      waitUntil: 'domcontentloaded',
      timeout: 10000
    });

    await page.waitForSelector('.content-scroller.scriptures, [data-visual-type="readalong"], .readalong-scroller', {
      timeout: 10000
    });

    await page.waitForFunction(() => {
      const audios = Array.from(document.querySelectorAll('audio'));
      const ambient = audios.find((audio) => audio.classList.contains('ambient'));
      const main = audios.find((audio) => !audio.classList.contains('ambient'));
      return Boolean(ambient && main);
    }, { timeout: 10000 });

    let playbackReady = true;
    try {
      await page.waitForFunction(() => {
        const audios = Array.from(document.querySelectorAll('audio'));
        const ambient = audios.find((audio) => audio.classList.contains('ambient'));
        const main = audios.find((audio) => !audio.classList.contains('ambient'));
        if (!ambient || !main) return false;
        return ambient.currentTime > 0.2 && main.currentTime > 0.2;
      }, { timeout: 15000 });
    } catch (error) {
      playbackReady = false;
      console.error('Timed out waiting for audio playback to start.');
    }

    const playbackState = await page.evaluate(() => {
      const audios = Array.from(document.querySelectorAll('audio'));
      const ambient = audios.find((audio) => audio.classList.contains('ambient'));
      const main = audios.find((audio) => !audio.classList.contains('ambient'));

      return {
        ambientExists: Boolean(ambient),
        mainExists: Boolean(main),
        ambientSrc: ambient?.currentSrc || ambient?.src || null,
        mainSrc: main?.currentSrc || main?.src || null,
        ambientTime: ambient?.currentTime ?? null,
        mainTime: main?.currentTime ?? null,
        ambientPaused: ambient?.paused ?? null,
        mainPaused: main?.paused ?? null
      };
    });

    console.log('Playback state:', playbackState);

    expect(playbackState.ambientExists).toBe(true);
    expect(playbackState.mainExists).toBe(true);
    expect(playbackState.ambientSrc).toBeTruthy();
    expect(playbackState.mainSrc).toBeTruthy();
    expect(playbackReady).toBe(true);
  });
});
