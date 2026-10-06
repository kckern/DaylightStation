import { test, expect } from '@playwright/test';
import { markFirstUseDone } from './lib/firstUse.mjs';

test.beforeEach(async ({ context }) => { await markFirstUseDone(context); });

const entry = (id, title) => ({ queueItemId: `q-${id}`, contentId: `plex:${id}`, title, format: 'video', priority: 'queue', addedAt: '' });
const SESSION = {
  schemaVersion: 1, sessionId: 'old', updatedAt: 't', wasPlayingOnUnload: true,
  snapshot: {
    sessionId: 'old', state: 'playing',
    currentItem: { contentId: 'plex:55854', title: 'Arrival', format: 'video' },
    position: 125,
    queue: { items: [entry(55854, 'Arrival'), entry(697368, 'Disclosure Day'), entry(675677, 'Third')], currentIndex: 0, upNextCount: 0 },
    config: { shuffle: false, repeat: 'off', shader: null, volume: 50, playbackRate: 1 },
    meta: { ownerId: 'test', updatedAt: '' },
  },
};

test.describe('MediaApp — Start fresh', () => {
  test.beforeEach(async ({ page }) => {
    // Seed once, BEFORE the first navigation, so it hydrates into state; a
    // later reload must see what the app itself left behind.
    await page.addInitScript((session) => {
      try {
        if (sessionStorage.getItem('seeded')) return;
        sessionStorage.setItem('seeded', '1');
        (() => { const k = 'media-app.first-use-done'; const v = localStorage.getItem(k); localStorage.clear(); if (v) localStorage.setItem(k, v); })();
        localStorage.setItem('media-app.session', JSON.stringify(session));
        localStorage.setItem('media-app.cast-target', JSON.stringify({ mode: 'fork', targetIds: ['acceptance-media'], activityAt: Date.now() }));
      } catch {}
    }, SESSION);
  });

  test('reset asks for confirmation before clearing', async ({ page }) => {
    await page.goto('/media');
    await expect(page.getByTestId('mini-player-open-nowplaying')).toBeVisible({ timeout: 10000 });

    await page.getByTestId('settings-menu-trigger').click();
    await page.getByTestId('settings-reset-session').click();
    await expect(page.getByTestId('confirm-dialog')).toBeVisible();

    // Cancel does nothing
    await page.getByTestId('confirm-cancel').click();
    await expect(page.getByTestId('confirm-dialog')).toBeHidden({ timeout: 2000 });
    await expect(page.getByTestId('mini-player-open-nowplaying')).toBeVisible();

    // Confirm actually resets
    await page.getByTestId('settings-menu-trigger').click();
    await page.getByTestId('settings-reset-session').click();
    await page.getByTestId('confirm-ok').click();
    await expect(page.getByTestId('mini-player-open-nowplaying')).toBeHidden({ timeout: 5000 });
  });

  test('[RELY.8a] Start fresh lists exactly what it clears, keeps what is unticked, and confirms first', async ({ page }) => {
    await page.goto('/media');
    await expect(page.getByTestId('mini-player-open-nowplaying')).toContainText('Arrival', { timeout: 15000 });
    await expect(page.getByRole('button', { name: /^Playing on Acceptance receiver/ }).first()).toBeVisible({ timeout: 30000 });

    // One step from anywhere: the settings gear lives in the persistent dock.
    await page.getByTestId('app-nav-fleet').click();
    await page.getByTestId('settings-menu-trigger').click();
    await page.getByRole('menuitem', { name: 'Start fresh' }).click();
    const dialog = page.getByTestId('confirm-dialog');
    await expect(dialog).toBeVisible();
    const playing = dialog.getByRole('checkbox', { name: "What's playing: Arrival" });
    const queue = dialog.getByRole('checkbox', { name: 'Queue: 2 more items' });
    const spot = dialog.getByRole('checkbox', { name: 'Spot: 2:05 into Arrival' });
    const aim = dialog.getByRole('checkbox', { name: /^Aim: Acceptance receiver/ });
    for (const box of [playing, queue, spot, aim]) await expect(box).toBeChecked();
    await expect(spot).toBeDisabled();

    // Keep the queue and the aim; clear what's playing (and its spot).
    await queue.uncheck();
    await aim.uncheck();
    await expect(page.getByTestId('mini-player-open-nowplaying')).toContainText('Arrival');
    await page.getByTestId('confirm-ok').click();
    await expect(dialog).toBeHidden();
    await expect(page.getByTestId('mini-state')).toHaveText('Ready to play');
    await expect(page.getByTestId('mini-queue-count')).toHaveText('2 queued');
    await expect(page.getByRole('button', { name: /^Playing on Acceptance receiver/ }).first()).toBeVisible();
    await expect(page.locator('video')).toHaveCount(0);

    // Clearing everything reads as new, and stays new after a reload.
    await page.getByTestId('settings-menu-trigger').click();
    await page.getByRole('menuitem', { name: 'Start fresh' }).click();
    await expect(dialog.getByRole('checkbox', { name: 'Queue: 2 items' })).toBeChecked();
    await page.getByTestId('confirm-ok').click();
    await expect(page.getByTestId('media-mini-player')).toHaveCount(0);
    await expect(page.getByRole('button', { name: /^Playing on Acceptance receiver/ })).toHaveCount(0);
    await page.reload();
    await expect(page.getByTestId('media-dock')).toBeVisible({ timeout: 30000 });
    await expect(page.getByTestId('media-mini-player')).toHaveCount(0);
  });
});
