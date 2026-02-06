/**
 * Scripture playback test
 * Verifies that scripture narration loads and advances
 */
import { test, expect } from '@playwright/test';

test('scripture audio should play and advance', async ({ page }) => {
  await page.goto('/tv?scripture=dc88');

  // Wait for page to fully load
  await page.waitForTimeout(3000);

  // Check audio elements
  const audioInfo = await page.evaluate(() => {
    const audios = document.querySelectorAll('audio');
    return Array.from(audios).map(a => ({
      src: a.src?.substring(0, 100),
      paused: a.paused,
      currentTime: a.currentTime,
      readyState: a.readyState
    }));
  });
  console.log('Audio elements:', JSON.stringify(audioInfo, null, 2));

  // Try to play the scripture audio manually
  await page.evaluate(() => {
    const audios = document.querySelectorAll('audio');
    audios.forEach(a => {
      if (a.src?.includes('scripture')) {
        a.play().catch(e => console.log('Play error:', e.message));
      }
    });
  });

  await page.waitForTimeout(3000);

  // Check position 1
  const pos1 = await page.evaluate(() => {
    const a = Array.from(document.querySelectorAll('audio')).find(x => x.src?.includes('scripture'));
    return a?.currentTime || 0;
  });

  await page.waitForTimeout(2000);

  // Check position 2
  const pos2 = await page.evaluate(() => {
    const a = Array.from(document.querySelectorAll('audio')).find(x => x.src?.includes('scripture'));
    return a?.currentTime || 0;
  });

  console.log(`Scripture audio advanced: ${pos1.toFixed(1)}s -> ${pos2.toFixed(1)}s`);
  expect(pos2).toBeGreaterThan(pos1);
});
