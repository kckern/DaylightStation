import { test, expect } from '@playwright/test';

test.describe('MediaApp — P1 foundation', () => {
  test.beforeEach(async ({ page }) => {
    // Ensure a clean slate (no prior session, no prior URL dedupe token)
    await page.goto('/media');
    await page.evaluate(() => {
      localStorage.removeItem('media-app.session');
      localStorage.removeItem('media-app.url-command-token');
    });
  });

  test('renders an idle shell at /media', async ({ page }) => {
    await page.goto('/media');
    await expect(page.getByTestId('media-dock')).toBeVisible();
    await expect(page.getByTestId('media-canvas')).toBeVisible();
    await expect(page.getByText(/now playing: nothing/i)).toBeVisible();
  });

  test('autoplays content via ?play=<contentId>', async ({ page }) => {
    await page.goto('/media?play=plex-main:12345');
    await expect(page.getByText(/now playing: plex-main:12345/i)).toBeVisible({ timeout: 10000 });
  });

  test('resumes a persisted session after reload', async ({ page }) => {
    await page.goto('/media?play=plex-main:99999');
    await expect(page.getByText(/plex-main:99999/)).toBeVisible({ timeout: 10000 });

    // Navigate to a bare URL — no autoplay param
    await page.goto('/media');
    // The persisted session should re-hydrate and show the same current item
    await expect(page.getByText(/plex-main:99999/)).toBeVisible({ timeout: 5000 });
  });

  test('reset clears the persisted session', async ({ page }) => {
    await page.goto('/media?play=plex-main:abcd');
    await expect(page.getByText(/plex-main:abcd/)).toBeVisible({ timeout: 10000 });
    await page.getByTestId('session-reset-btn').click();
    await expect(page.getByText(/now playing: nothing/i)).toBeVisible();

    const persisted = await page.evaluate(() => localStorage.getItem('media-app.session'));
    expect(persisted).toBeNull();
  });
});
