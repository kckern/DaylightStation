import { test, expect } from '@playwright/test';
import { BACKEND_URL } from '#fixtures/runtime/urls.mjs';

test.describe('Feed Player Sheet', () => {

  test.beforeAll(async ({ request }) => {
    const res = await request.get(`${BACKEND_URL}/api/v1/feed/scroll`);
    expect(res.ok(), 'Feed scroll API should be healthy').toBe(true);
  });

  test('clicking mini bar info opens sheet with full controls', async ({ page }) => {
    await page.goto('/feed/scroll?filter=plex', { waitUntil: 'networkidle', timeout: 30000 });
    await expect(page.locator('.scroll-item-wrapper').first()).toBeVisible({ timeout: 15000 });

    // Start playback via card play button
    const playBtn = page.locator('.feed-card button[aria-label="Play"]').first();
    await expect(playBtn).toBeVisible({ timeout: 10000 });
    await playBtn.click();

    // Wait for mini bar
    const miniBar = page.locator('.feed-mini-bar');
    await expect(miniBar).toBeVisible({ timeout: 10000 });

    // Click mini bar info area to open sheet
    await miniBar.locator('.feed-mini-bar-info').click();

    // Sheet should be visible
    const sheet = page.locator('.feed-player-sheet.open');
    await expect(sheet, 'Bottom sheet should open').toBeVisible({ timeout: 5000 });

    // Mini bar should be hidden
    await expect(miniBar).not.toBeVisible();

    // Sheet should have key controls
    await expect(sheet.locator('.sheet-play-btn'), 'Play/pause button').toBeVisible();
    await expect(sheet.locator('.sheet-skip-btn').first(), 'Skip button').toBeVisible();
    await expect(sheet.locator('.sheet-speed-pill').first(), 'Speed pills').toBeVisible();
    await expect(sheet.locator('.sheet-scrubber'), 'Seek scrubber').toBeVisible();
    await expect(sheet.locator('.sheet-cover, .sheet-cover-fallback').first(), 'Cover art').toBeVisible();

    // Close by clicking scrim
    await page.locator('.feed-player-sheet-scrim').click({ position: { x: 10, y: 10 } });

    // Sheet should close, mini bar should return
    await expect(sheet).not.toBeVisible({ timeout: 3000 });
    await expect(miniBar).toBeVisible({ timeout: 3000 });

    console.log('Player sheet open/close verified');
  });

  test('speed pills change playback rate', async ({ page }) => {
    await page.goto('/feed/scroll?filter=plex', { waitUntil: 'networkidle', timeout: 30000 });
    await expect(page.locator('.scroll-item-wrapper').first()).toBeVisible({ timeout: 15000 });

    // Start playback
    const playBtn = page.locator('.feed-card button[aria-label="Play"]').first();
    await expect(playBtn).toBeVisible({ timeout: 10000 });
    await playBtn.click();

    // Open sheet
    const miniBar = page.locator('.feed-mini-bar');
    await expect(miniBar).toBeVisible({ timeout: 10000 });
    await miniBar.locator('.feed-mini-bar-info').click();

    const sheet = page.locator('.feed-player-sheet.open');
    await expect(sheet).toBeVisible({ timeout: 5000 });

    // Click the 1.5x speed pill
    const pill15 = sheet.locator('.sheet-speed-pill', { hasText: '1.5x' });
    await pill15.click();

    // Verify the pill is active
    await expect(pill15).toHaveClass(/active/);

    // Verify the actual media element playback rate changed
    await expect(async () => {
      const rate = await page.evaluate(() => {
        const el = document.querySelector('audio, video');
        return el?.playbackRate;
      });
      expect(rate, 'Media playback rate should be 1.5').toBe(1.5);
    }).toPass({ timeout: 5000 });

    console.log('Speed pill change verified');
  });
});
