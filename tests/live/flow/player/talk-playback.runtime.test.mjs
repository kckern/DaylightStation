/**
 * Talk playback test
 * Verifies that talk video loads when given a conference ID
 */
import { test, expect } from '@playwright/test';

test('talk video should load from conference ID', async ({ page }) => {
  await page.goto('/tv?talk=ldsgc202510');

  // Wait for page to fully load
  await page.waitForTimeout(3000);

  // Check for video element (talk player uses video, not dash-video)
  const hasVideo = await page.evaluate(() => {
    const video = document.querySelector('video');
    return video !== null;
  });

  console.log('Video element found:', hasVideo);

  // Check video source
  const videoInfo = await page.evaluate(() => {
    const video = document.querySelector('video');
    if (!video) return null;
    return {
      src: video.src?.substring(0, 100),
      readyState: video.readyState,
      duration: video.duration,
      paused: video.paused
    };
  });

  console.log('Video info:', JSON.stringify(videoInfo, null, 2));

  // Video should exist and have a source
  expect(hasVideo).toBe(true);
  expect(videoInfo?.src).toBeTruthy();
});
