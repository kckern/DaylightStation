import { test, expect } from '@playwright/test';
import { markFirstUseDone } from './lib/firstUse.mjs';
import { playResultHere } from './lib/search.mjs';

test.beforeEach(async ({ context }) => { await markFirstUseDone(context); });

test.describe('MediaApp — Stop flow', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => { try { (() => { const k = 'media-app.first-use-done'; const v = localStorage.getItem(k); localStorage.clear(); if (v) localStorage.setItem(k, v); })(); } catch {} });
  });

  test('Stop on the bar clears the item at once, and Undo in the toast brings it back paused (owner ruling 2026-11-27)', async ({ page }) => {
    await page.goto('/media');
    const search = page.getByRole('textbox', { name: 'Search media…' });
    await expect(search).toBeVisible({ timeout: 30000 });
    await search.fill('lonesome');
    const option = page.getByRole('option').filter({ hasText: 'Lonesome' }).first();
    await expect(option).toBeVisible({ timeout: 15000 });
    await playResultHere(page, option); // a row only opens the info view; PLAY plays
    await expect(page.getByTestId('mini-toggle')).toBeVisible({ timeout: 15000 });

    // Stop: the bar is gone at once — no "Ready to play / Resume" leftover.
    await page.getByTestId('mini-stop').click();
    await expect(page.getByTestId('media-mini-player')).toHaveCount(0);
    const row = page.locator('[data-testid^="dispatch-row-"]').filter({ hasText: /Stopped Lonesome Day/ });
    await expect(row).toBeVisible({ timeout: 5000 });

    // Undo restores it (paused) while the toast offers it.
    await row.getByTestId('item-action-undo').click();
    await expect(page.getByTestId('media-mini-player')).toHaveText(/Lonesome Day/, { timeout: 5000 });
    await page.getByTestId('mini-stop').click();
    await expect(page.getByTestId('media-mini-player')).toHaveCount(0);

    // Nothing brings the stopped session back on reload.
    await page.reload();
    await expect(page.getByRole('textbox', { name: 'Search media…' })).toBeVisible({ timeout: 30000 });
    await page.waitForTimeout(1500);
    await expect(page.getByTestId('media-mini-player')).toHaveCount(0);
  });
});
