import { test, expect } from '@playwright/test';

test('NowPlaying hand-off uses DispatchTargetPicker', async ({ page }) => {
  await page.route('**/api/v1/device/*/load*', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ ok: true, dispatchId: 'handoff-1', steps: [], totalElapsedMs: 8 }),
  }));
  await page.addInitScript(() => { try { localStorage.clear(); } catch {} });
  await page.goto('/media');

  await page.getByTestId('media-search-input').fill('lonesome');
  const firstRow = page.locator('[data-testid^="result-row-"]').first();
  await expect(firstRow).toBeVisible({ timeout: 15000 });
  const id = (await firstRow.getAttribute('data-testid')).replace(/^result-row-/, '');
  // JS click bypasses overlay pointer-event interception.
  await page.getByTestId(`result-play-now-${id}`).evaluate((el) => el.click());
  await expect(page.getByTestId('mini-toggle')).toBeVisible({ timeout: 15000 });

  // Open NowPlaying view
  await page.getByTestId('mini-player-open-nowplaying').click();

  // NowPlaying view contains a DispatchTargetPicker for hand-off
  const handoffPicker = page.locator('[data-testid="handoff-section"] [data-testid="dispatch-target-picker"]');
  await expect(handoffPicker).toBeVisible({ timeout: 5000 });
  const firstDevice = page.locator('[data-testid="handoff-section"] [data-testid^="picker-device-"]').first();
  await expect(firstDevice).toBeVisible();
  await firstDevice.click();
  await page.locator('[data-testid="handoff-section"] [data-testid="picker-submit"]').click();
});
