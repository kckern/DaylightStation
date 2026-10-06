import { test, expect } from '@playwright/test';
import { markFirstUseDone } from './lib/firstUse.mjs';

test.beforeEach(async ({ context }) => { await markFirstUseDone(context); });

test('NowPlaying hand-off shows truthful aim plus explicit move/keep choices', async ({ page }) => {
  await page.addInitScript(() => { try { (() => { const k = 'media-app.first-use-done'; const v = localStorage.getItem(k); localStorage.clear(); if (v) localStorage.setItem(k, v); })(); } catch {} });
  await page.goto('/media');

  const search = page.getByRole('textbox', { name: 'Search media…' });
  await expect(search).toBeVisible({ timeout: 30000 });
  await search.fill('lonesome');
  const option = page.getByRole('option').filter({ hasText: 'Lonesome' }).first();
  await expect(option).toBeVisible({ timeout: 15000 });
  await option.click();
  await expect(page.getByTestId('mini-toggle')).toBeVisible({ timeout: 15000 });

  // Open NowPlaying view
  await page.getByTestId('mini-player-open-nowplaying').click();
  await expect(page.getByTestId('media-mini-player')).toHaveCount(0);
  await expect(page.getByTestId('queue-panel')).toBeVisible();

  // NowPlaying view contains a DispatchTargetPicker for hand-off
  const handoffPicker = page.locator('[data-testid="handoff-section"] [data-testid="dispatch-target-picker"]');
  await expect(handoffPicker).toBeVisible({ timeout: 5000 });
  // The header's destination control carries the aim on this (wide) viewport.
  await expect(page.getByTestId('destination-control-name')).toHaveText(/this device/i);
  const firstDevice = page.locator('[data-testid="handoff-section"] [data-testid^="picker-device-"]').first();
  await expect(firstDevice).toBeVisible();
  await firstDevice.click();
  await expect(handoffPicker.getByTestId('picker-mode-transfer')).toBeEnabled();
  await expect(handoffPicker.getByTestId('picker-mode-transfer')).toHaveText(/Move playback/i);
  await expect(handoffPicker.getByTestId('picker-mode-fork')).toHaveText(/Keep playing here too/i);
});
