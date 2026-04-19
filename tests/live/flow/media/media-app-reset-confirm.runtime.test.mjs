import { test, expect } from '@playwright/test';

test.describe('MediaApp — reset session confirmation', () => {
  test.beforeEach(async ({ page }) => {
    // Pre-populate a session BEFORE the first navigation so it hydrates into state.
    await page.addInitScript(() => {
      try {
        localStorage.clear();
        localStorage.setItem('media-app.session', JSON.stringify({
          schemaVersion: 1, sessionId: 'old', updatedAt: 't', wasPlayingOnUnload: false,
          snapshot: {
            sessionId: 'old', state: 'paused',
            currentItem: { contentId: 'plex:42', format: 'video' },
            position: 0,
            queue: { items: [{ queueItemId: 'q1', contentId: 'plex:42', format: 'video', priority: 'queue', addedAt: '' }], currentIndex: 0, upNextCount: 0 },
            config: { shuffle: false, repeat: 'off', shader: null, volume: 50, playbackRate: 1 },
            meta: { ownerId: 'test', updatedAt: '' },
          },
        }));
      } catch {}
    });
  });

  test('reset asks for confirmation before clearing', async ({ page }) => {
    await page.goto('/media');
    await expect(page.getByTestId('mini-player-open-nowplaying')).toBeVisible({ timeout: 10000 });

    await page.getByTestId('session-reset-btn').click();
    await expect(page.getByTestId('confirm-dialog')).toBeVisible();

    // Cancel does nothing
    await page.getByTestId('confirm-cancel').click();
    await expect(page.getByTestId('confirm-dialog')).toBeHidden({ timeout: 2000 });
    await expect(page.getByTestId('mini-player-open-nowplaying')).toBeVisible();

    // Confirm actually resets
    await page.getByTestId('session-reset-btn').click();
    await page.getByTestId('confirm-ok').click();
    await expect(page.getByTestId('mini-player-open-nowplaying')).toBeHidden({ timeout: 5000 });
  });
});
