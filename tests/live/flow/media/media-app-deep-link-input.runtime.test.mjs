import { test, expect } from '@playwright/test';

test.describe('MediaApp — deep-link content-ID input', () => {
  test('typing source:id shows the Play This ID affordance', async ({ page }) => {
    await page.addInitScript(() => { try { localStorage.clear(); } catch {} });
    await page.goto('/media');
    await page.getByTestId('media-search-input').fill('plex-main:12345');
    await expect(page.getByTestId('search-deeplink-suggestion')).toBeVisible();
    await expect(page.getByTestId('search-deeplink-play')).toBeVisible();
  });
});
