import { test, expect } from '@playwright/test';
import { markFirstUseDone } from './lib/firstUse.mjs';

test.beforeEach(async ({ context }) => { await markFirstUseDone(context); });

test.describe('MediaApp — Stop flow', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => { try { (() => { const k = 'media-app.first-use-done'; const v = localStorage.getItem(k); localStorage.clear(); if (v) localStorage.setItem(k, v); })(); } catch {} });
  });

  test('Stop keeps the queue reachable and separates Clear', async ({ page }) => {
    await page.goto('/media');
    const search = page.getByRole('textbox', { name: 'Search media…' });
    await expect(search).toBeVisible({ timeout: 30000 });
    await search.fill('lonesome');
    const option = page.getByRole('option').filter({ hasText: 'Lonesome' }).first();
    await expect(option).toBeVisible({ timeout: 15000 });
    await option.click();
    await expect(page.getByTestId('mini-toggle')).toBeVisible({ timeout: 15000 });

    // Stop
    await page.getByTestId('mini-stop').click();

    await expect(page.getByTestId('media-mini-player')).toHaveText(/Lonesome Day.*Ready to play.*Resume/s);
    await expect(page.getByTestId('mini-player-open-nowplaying')).toBeVisible();
    await page.getByTestId('mini-player-open-nowplaying').click();
    await expect(page.getByTestId('queue-clear')).toBeVisible();
    await expect(page.getByTestId('queue-clear')).toBeEnabled();
  });
});
