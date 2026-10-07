import { test, expect } from '@playwright/test';

// In P2 the default canvas view is HomeView. These tests click the MiniPlayer
// title (available when a current item exists) to navigate to NowPlayingView,
// where the "Now Playing: X" heading lives. When idle (STEER.7a) there is no
// session to show a handle for, so the MiniPlayer renders nothing: no strip and
// no "Idle" text -- we assert that via Home view instead.

test.describe('MediaApp — P1 foundation', () => {
  test.beforeEach(async ({ page }) => {
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
    // Home view is the default canvas view; with no session the handle is absent.
    await expect(page.getByTestId('home-view')).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId('media-mini-player')).toHaveCount(0);
    await expect(page.getByTestId('mini-player-open-nowplaying')).toHaveCount(0);
  });

  test('autoplays content via ?play=<contentId>', async ({ page }) => {
    await page.goto('/media?play=plex-main:12345');
    // MiniPlayer title button shows the current item's text; clicking it navigates to NowPlayingView
    await expect(page.getByTestId('mini-player-open-nowplaying')).toBeVisible({ timeout: 10000 });
    await page.getByTestId('mini-player-open-nowplaying').click();
    await expect(page.getByRole('heading', { name: /Now Playing: plex-main:12345/i })).toBeVisible({ timeout: 10000 });
  });

  test('resumes a persisted session after reload', async ({ page }) => {
    await page.goto('/media?play=plex-main:99999');
    await expect(page.getByTestId('mini-player-open-nowplaying')).toBeVisible({ timeout: 10000 });

    // Reload with no autoplay param
    await page.goto('/media');
    // The persisted session should re-hydrate; MiniPlayer shows the restored item
    await expect(page.getByTestId('mini-player-open-nowplaying')).toBeVisible({ timeout: 5000 });
    await page.getByTestId('mini-player-open-nowplaying').click();
    await expect(page.getByRole('heading', { name: /Now Playing: plex-main:99999/i })).toBeVisible({ timeout: 5000 });
  });

  test('reset clears the persisted session', async ({ page }) => {
    await page.goto('/media?play=plex-main:abcd');
    await expect(page.getByTestId('mini-player-open-nowplaying')).toBeVisible({ timeout: 10000 });

    await page.getByTestId('settings-menu-trigger').click();
    await page.getByTestId('settings-reset-session').click();
    await page.getByTestId('confirm-ok').click();
    // After reset there is no session, so the handle is gone again (no item, no queue).
    await expect(page.getByTestId('media-mini-player')).toHaveCount(0);

    const persisted = await page.evaluate(() => localStorage.getItem('media-app.session'));
    const parsed = persisted ? JSON.parse(persisted) : null;
    expect(parsed?.snapshot?.currentItem).toBeNull();
    expect(parsed?.snapshot?.state).toBe('idle');
  });
});
