import { test, expect } from '@playwright/test';

test('detail view loads and play button works', async ({ page }) => {
  // Navigate to detail view for Star Wars (plex:653701)
  await page.goto('http://localhost:3111/media/view/plex:653701', { waitUntil: 'domcontentloaded', timeout: 15000 });

  // Verify detail view rendered
  const title = page.locator('.content-detail-title');
  await expect(title).toBeVisible({ timeout: 10000 });
  const titleText = await title.textContent();
  console.log('Detail view title:', titleText);
  expect(titleText).toContain('Star Wars');

  // Verify hero image loaded
  const hero = page.locator('.content-detail-hero');
  await expect(hero).toBeVisible();

  // Verify Play button exists
  const playBtn = page.locator('.action-btn--primary').first();
  await expect(playBtn).toBeVisible();
  const playText = await playBtn.textContent();
  console.log('Play button text:', playText);

  // Click Play
  await playBtn.click();
  console.log('Clicked Play button');

  // Wait a moment for queue to process
  await page.waitForTimeout(2000);

  // Check queue state via API
  const queueRes = await page.evaluate(async () => {
    const res = await fetch('/api/v1/media/queue');
    return res.json();
  });
  console.log('Queue state:', JSON.stringify({ position: queueRes.position, itemCount: queueRes.items?.length, firstItem: queueRes.items?.[0]?.title }));

  // Verify item is in queue and position is valid
  expect(queueRes.items.length).toBeGreaterThan(0);
  expect(queueRes.items[queueRes.position]).toBeDefined();
  expect(queueRes.items[queueRes.position].contentId).toBe('plex:653701');

  // Check if mini-player or now-playing rendered (currentItem not null)
  const miniPlayer = page.locator('.mini-player');
  const nowPlaying = page.locator('.now-playing-content');
  const hasPlayer = await miniPlayer.isVisible().catch(() => false) || await nowPlaying.isVisible().catch(() => false);
  console.log('Player visible:', hasPlayer);
});
