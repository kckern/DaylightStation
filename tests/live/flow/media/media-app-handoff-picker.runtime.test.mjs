import { test, expect } from '@playwright/test';
import { markFirstUseDone } from './lib/firstUse.mjs';
import { playResultHere } from './lib/search.mjs';

test.beforeEach(async ({ context }) => { await markFirstUseDone(context); });

test('NowPlaying hand-off shows truthful aim plus an explicit move/keep choice', async ({ page }) => {
  await page.addInitScript(() => { try { (() => { const k = 'media-app.first-use-done'; const v = localStorage.getItem(k); localStorage.clear(); if (v) localStorage.setItem(k, v); })(); } catch {} });
  await page.goto('/media');

  const search = page.getByRole('textbox', { name: 'Search media…' });
  await expect(search).toBeVisible({ timeout: 30000 });
  await search.fill('lonesome');
  const option = page.getByRole('option').filter({ hasText: 'Lonesome' }).first();
  await expect(option).toBeVisible({ timeout: 15000 });
  await playResultHere(page, option); // a row only opens the info view; PLAY plays
  await expect(page.getByTestId('mini-toggle')).toBeVisible({ timeout: 15000 });

  // Open NowPlaying view
  await page.getByTestId('mini-player-open-nowplaying').click();
  await expect(page.getByTestId('media-mini-player')).toHaveCount(0);
  await expect(page.getByTestId('queue-panel')).toBeVisible();

  // NowPlaying view contains a DispatchTargetPicker for hand-off
  const handoffPicker = page.locator('[data-testid="handoff-section"] [data-testid="dispatch-target-picker"]');
  await expect(handoffPicker).toBeVisible({ timeout: 5000 });
  // On this (wide) viewport the search box's destination chip carries the aim:
  // This device, chosen on purpose for the play above, sticks.
  await expect(page.getByTestId('search-destination-chip')).toHaveText(/This device/);
  const firstDevice = page.locator('[data-testid="handoff-section"] [data-testid^="picker-device-"]').first();
  await expect(firstDevice).toBeVisible();
  // Move or keep is one explicit "Stop it here" switch, said before any tap
  // (a tap on a screen sends at once, so this journey does not tap one).
  const stopHere = handoffPicker.getByRole('switch', { name: 'Stop it here' });
  await expect(stopHere).toBeAttached();
  await expect(handoffPicker.locator('label', { hasText: 'Stop it here' })).toBeVisible();
  const before = await stopHere.isChecked();
  await handoffPicker.locator('label', { hasText: 'Stop it here' }).click();
  if (before) await expect(stopHere).not.toBeChecked(); else await expect(stopHere).toBeChecked();
});
