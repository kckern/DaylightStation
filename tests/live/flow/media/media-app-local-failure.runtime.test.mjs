import { test, expect } from '@playwright/test';

// RELY.5a — a local playback failure is reported wherever the person is,
// naming the item, this device and what plays instead, and the handle shows a
// problem sign until playback recovers. The failure is a real withheld media
// stream for the first item only; nothing fabricates the skip or recovery.
test.use({ viewport: { width: 1440, height: 900 }, trace: 'retain-on-failure' });
test.setTimeout(300000);

async function addToQueue(page, title) {
  const search = page.getByRole('textbox', { name: 'Search media…' });
  await search.fill(title);
  const row = page.getByRole('option').filter({ hasText: title }).filter({ hasText: 'Movie' });
  await expect(row).toHaveCount(1, { timeout: 15000 });
  await row.getByRole('button', { name: 'More actions' }).click();
  await page.getByRole('menuitem', { name: 'Add to Queue', exact: true }).click();
  await page.keyboard.press('Escape');
}

test('[RELY.5a] a local item that stops making progress is skipped with a notice anywhere in the app and a problem sign until the next item plays', async ({ page }) => {
  await page.goto('/media');
  await expect(page.getByRole('textbox', { name: 'Search media…' })).toBeVisible({ timeout: 30000 });
  await addToQueue(page, 'Arrival');
  await addToQueue(page, 'Disclosure Day');
  await expect(page.getByTestId('mini-player-open-nowplaying')).toHaveText('2 items ready');

  // Start the queue for real.
  await page.getByTestId('mini-toggle').click();
  await page.getByTestId('mini-player-open-nowplaying').click();
  const video = page.getByTestId('now-playing-host').locator('video');
  await expect.poll(() => video.evaluate(el => !el.paused && el.readyState >= 2 && el.currentTime > 1), { timeout: 60000 }).toBe(true);

  // The network stops delivering Arrival's bytes (a real outage, not a
  // fabricated event), and the person jumps past what is buffered.
  const withheld = [];
  await page.route(/\/api\/v1\/proxy\/plex\/(?:stream\/55854(?:\?|$)|library\/parts\/58864\/)/, async route => {
    withheld.push(route.request().url());
    await route.abort('failed');
  });
  const seek = page.getByTestId('np-seek');
  const box = await seek.boundingBox();
  await page.mouse.click(box.x + box.width * 0.6, box.y + box.height / 2);
  await page.getByTestId('now-playing-back').click();

  const notice = page.locator('[data-testid^="dispatch-row-"]').filter({ hasText: 'Arrival' }).filter({ hasText: 'this device' });
  await expect(notice).toBeVisible({ timeout: 240000 });
  await expect(notice).toContainText('Now playing Disclosure Day');
  await expect(notice).toHaveAttribute('data-phase', 'skipped');
  await expect(notice.getByRole('button', { name: /Retry/ })).toBeVisible();
  // The handle carries a problem sign naming the item until playback recovers.
  await expect(page.getByTestId('media-mini-player')).toHaveClass(/mini-player--problem/);
  await expect(page.getByTestId('mini-problem')).toHaveAccessibleName(/Arrival was skipped/);
  expect(withheld.length).toBeGreaterThan(0);
  await expect(page.getByTestId('mini-player-open-nowplaying')).toContainText('Disclosure Day');

  // Recovery: the replacement actually plays, and only then the sign clears.
  await expect.poll(() => page.evaluate(() => [...document.querySelectorAll('video')].some(v => !v.paused && v.readyState >= 2 && v.currentTime > 0)), { timeout: 60000 }).toBe(true);
  await expect(page.getByTestId('mini-problem')).toHaveCount(0, { timeout: 30000 });
  // The notice itself stays until dismissed.
  await expect(notice).toBeVisible();
  await notice.getByRole('button', { name: 'Dismiss' }).click();
  await expect(notice).toHaveCount(0);
});
