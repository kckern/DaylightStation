import { test, expect } from '@playwright/test';
import { markFirstUseDone } from './lib/firstUse.mjs';
import { playArrivalHere } from './lib/mediaDriver.mjs';

test.describe('MediaApp — NowPlaying exit', () => {
  test.beforeEach(async ({ page, context }) => {
    // A fresh browser opens the first-use naming card over the header (a real overlay).
    await markFirstUseDone(context);
    await page.goto('/media');
    await page.evaluate(() => localStorage.clear());
  });

  // Search, tap the movie (plays here), then open NowPlaying from the handle.
  async function startPlayback(page) {
    await page.goto('/media');
    await playArrivalHere(page);
    await page.getByTestId('mini-player-open-nowplaying').click();
    await expect(page.getByTestId('now-playing-view')).toBeVisible({ timeout: 10000 });
  }

  test('Back button exits to Home', async ({ page }) => {
    await startPlayback(page);
    await page.getByTestId('now-playing-back').click();
    await expect(page.getByTestId('home-view')).toBeVisible({ timeout: 5000 });
  });

  test('Escape exits NowPlaying', async ({ page }) => {
    await startPlayback(page);
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('now-playing-view')).toBeHidden({ timeout: 5000 });
  });

  test('Escape with cast popover open closes only the popover, not NowPlaying', async ({ page }) => {
    await startPlayback(page);
    await page.getByTestId('cast-target-chip').click();
    await expect(page.getByTestId('cast-popover')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('cast-popover')).toBeHidden({ timeout: 2000 });
    // NowPlaying should still be visible (Escape did not pop the view)
    await expect(page.getByTestId('now-playing-view')).toBeVisible();
  });
});
