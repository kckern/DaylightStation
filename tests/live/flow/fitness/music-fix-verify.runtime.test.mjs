import { test, expect } from '@playwright/test';

test('Music auto-enables and plays on NoMusic video (599479)', async ({ page }) => {
  const musicRequests = [];

  page.on('request', req => {
    const url = req.url();
    // Track music playlist fetch requests (not the video itself)
    if (url.includes('/playable') && !url.includes('/599479/')) {
      musicRequests.push(url);
    }
  });

  // Load NoMusic video - should auto-enable music
  await page.goto('http://localhost:3111/fitness/play/599479');
  await page.waitForSelector('video', { timeout: 15000 });

  // Wait for music to auto-enable and queue to load
  await page.waitForTimeout(8000);

  const result = await page.evaluate(() => ({
    hasMusicSection: !!document.querySelector('.fitness-sidebar-music'),
    trackTitle: document.querySelector('.track-title')?.textContent?.trim() || 'NONE',
    audioCount: document.querySelectorAll('audio').length,
    audioHasSrc: Array.from(document.querySelectorAll('audio')).some(a => !!(a.src || a.currentSrc))
  }));

  // Key assertions
  expect(musicRequests.length, 'Music queue should be fetched').toBeGreaterThan(0);
  expect(result.hasMusicSection, 'Music section should be visible').toBe(true);
  expect(result.audioCount, 'Audio element should exist').toBeGreaterThan(0);
  expect(result.audioHasSrc, 'Audio should have source').toBe(true);
  expect(result.trackTitle, 'Track should be playing').not.toBe('No track playing');
  expect(result.trackTitle, 'Track title should not be empty').not.toBe('NONE');
});
