/**
 * Simple playback test for video and audio
 * Verifies that Plex media can load and start playing
 */
import { test, expect } from '@playwright/test';

const PLEX_ID = process.env.PLEX_ID || '663034';

test('media should load and play', async ({ page }) => {
  await page.goto(`/tv?play=${PLEX_ID}`);

  // Wait for media to start playing (check for progress > 0)
  await page.waitForFunction(() => {
    // Check dash-video (for video)
    const dashEl = document.querySelector('dash-video');
    if (dashEl) {
      const v = dashEl.shadowRoot?.querySelector('video') || dashEl;
      if (v && v.duration > 0 && v.currentTime > 0) return true;
    }
    // Check audio element
    const audio = document.querySelector('audio');
    if (audio && audio.duration > 0 && audio.currentTime > 0) return true;
    return false;
  }, { timeout: 20000 });

  // Verify not paused
  const isPlaying = await page.evaluate(() => {
    const dashEl = document.querySelector('dash-video');
    if (dashEl) {
      const v = dashEl.shadowRoot?.querySelector('video') || dashEl;
      if (v) return !v.paused;
    }
    const audio = document.querySelector('audio');
    if (audio) return !audio.paused;
    return false;
  });

  expect(isPlaying).toBe(true);
});
