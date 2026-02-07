/**
 * Talk Ambient Playback Runtime Test
 *
 * Confirms /tv?talk=ldsgc202510 loads and both ambient + main video play
 * without resetting playback time.
 *
 * Prerequisites:
 * - Dev server running (npm run dev)
 */

import { test, expect } from '@playwright/test';
import { FRONTEND_URL } from '#fixtures/runtime/urls.mjs';

test.describe('Talk ambient playback', () => {
  test('tv?talk=ldsgc202510 plays main video + ambient audio without looping', async ({ page }) => {
    test.setTimeout(25000);

    page.on('pageerror', (error) => {
      console.error('Page error:', error);
    });

    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        console.error('Console error:', msg.text());
      }
    });

    const url = `${FRONTEND_URL}/tv?talk=ldsgc202510`;
    console.log(`\nNavigating to: ${url}`);

    await page.goto(url, {
      waitUntil: 'domcontentloaded',
      timeout: 10000
    });

    await page.waitForSelector('.tv-app', {
      timeout: 15000,
      state: 'attached'
    });

    await page.waitForTimeout(2000);

    const mediaCounts = await page.evaluate(() => ({
      videoCount: document.querySelectorAll('video').length,
      audioCount: document.querySelectorAll('audio').length,
      ambientCount: document.querySelectorAll('audio.ambient').length
    }));

    const pageSnapshot = await page.evaluate(() => ({
      title: document.title,
      bodyText: document.body?.innerText?.slice(0, 200) || '',
      rootExists: Boolean(document.querySelector('#root')),
      location: window.location.href
    }));

    console.log('Page snapshot:', pageSnapshot);
    console.log('Media element counts:', mediaCounts);
    expect(mediaCounts.videoCount).toBeGreaterThan(0);

    await page.waitForFunction(() => {
      const video = document.querySelector('video');
      const audios = Array.from(document.querySelectorAll('audio'));
      const ambient = audios.find((audio) => audio.classList.contains('ambient'));
      return Boolean(video && ambient);
    }, { timeout: 15000 });

    const initialTimes = await page.evaluate(() => {
      const video = document.querySelector('video');
      const audios = Array.from(document.querySelectorAll('audio'));
      const ambient = audios.find((audio) => audio.classList.contains('ambient'));
      return {
        videoTime: video?.currentTime ?? null,
        ambientTime: ambient?.currentTime ?? null,
        videoPaused: video?.paused ?? null,
        ambientPaused: ambient?.paused ?? null,
        ambientSrc: ambient?.currentSrc || ambient?.src || null,
        ambientReadyState: ambient?.readyState ?? null,
        ambientNetworkState: ambient?.networkState ?? null,
        ambientError: ambient?.error ? { code: ambient.error.code, message: ambient.error.message } : null
      };
    });

    await page.waitForTimeout(3000);

    const laterTimes = await page.evaluate(() => {
      const video = document.querySelector('video');
      const audios = Array.from(document.querySelectorAll('audio'));
      const ambient = audios.find((audio) => audio.classList.contains('ambient'));
      return {
        videoTime: video?.currentTime ?? null,
        ambientTime: ambient?.currentTime ?? null,
        videoPaused: video?.paused ?? null,
        ambientPaused: ambient?.paused ?? null,
        ambientSrc: ambient?.currentSrc || ambient?.src || null,
        ambientReadyState: ambient?.readyState ?? null,
        ambientNetworkState: ambient?.networkState ?? null,
        ambientError: ambient?.error ? { code: ambient.error.code, message: ambient.error.message } : null
      };
    });

    console.log('Initial times:', initialTimes);
    console.log('Later times:', laterTimes);

    expect(laterTimes.videoPaused).toBe(false);
    expect(laterTimes.videoTime).toBeGreaterThan(initialTimes.videoTime);
    expect(laterTimes.ambientSrc).toBeTruthy();
    expect(laterTimes.ambientSrc).toBe(initialTimes.ambientSrc);
    expect(laterTimes.ambientReadyState).toBeGreaterThanOrEqual(2);
    expect(laterTimes.ambientTime).toBeGreaterThan(initialTimes.ambientTime);
  });
});
