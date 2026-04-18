// tests/live/flow/media/media-app-discovery.runtime.test.mjs
import { test, expect } from '@playwright/test';

test.describe('MediaApp — P2 discovery', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/media');
    await page.evaluate(() => {
      localStorage.clear();
    });
  });

  test('renders Home view with browse cards', async ({ page }) => {
    await page.goto('/media');
    await expect(page.getByTestId('home-view')).toBeVisible({ timeout: 10000 });
  });

  test('search returns results and Play Now starts playback', async ({ page }) => {
    await page.goto('/media');
    await expect(page.getByTestId('media-search-input')).toBeVisible();

    await page.getByTestId('media-search-input').fill('lonesome');
    const firstRow = page.locator('[data-testid^="result-row-"]').first();
    await expect(firstRow).toBeVisible({ timeout: 15000 });

    const firstRowId = await firstRow.getAttribute('data-testid');
    const contentId = firstRowId?.replace(/^result-row-/, '');
    expect(contentId).toBeTruthy();

    await page.getByTestId(`result-play-now-${contentId}`).click();

    await page.getByTestId('mini-player-open-nowplaying').click();
    await expect(page.getByRole('heading', { name: new RegExp(`Now Playing: ${contentId}`, 'i') })).toBeVisible({ timeout: 10000 });
  });

  test('clicking a search result title opens the Detail view', async ({ page }) => {
    await page.goto('/media');
    await page.getByTestId('media-search-input').fill('lonesome');
    const firstRow = page.locator('[data-testid^="result-open-"]').first();
    await expect(firstRow).toBeVisible({ timeout: 15000 });
    await firstRow.click();
    await expect(page.getByTestId('detail-view')).toBeVisible({ timeout: 10000 });
  });
});
