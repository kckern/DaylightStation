import { test, expect } from '@playwright/test';

const title = process.env.MEDIA_ACCEPTANCE_TITLE || 'Disclosure Day';
test.use({ viewport: { width: 1440, height: 900 }, trace: 'retain-on-failure', actionTimeout: 10000 });
test.setTimeout(90000);

test.afterEach(async ({ page }) => {
  // Release only this test's local playback through the ordinary UI.
  const stop = page.getByTestId('np-stop');
  if (!page.isClosed() && await stop.isVisible().catch(() => false)) {
    await stop.click().catch(() => {});
  }
});

test('[FIND.1a/AC5] keyboard opens row actions and adds without clearing search or starting playback', async ({ page }) => {
  await page.goto('/media');
  const search = page.getByRole('textbox', { name: 'Search media…' });
  await expect(search).toBeVisible({ timeout: 30000 });
  await search.fill(title);
  const result = page.getByRole('option').filter({ hasText: title });
  await expect(result).toHaveCount(1, { timeout: 15000 });
  const more = result.getByRole('button', { name: 'More actions' });
  await more.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('menuitem', { name: 'Add to Queue', exact: true })).toBeVisible();
  for (const action of ['Play Now', 'Play Next', 'Up Next', 'Add to Queue']) {
    await page.keyboard.press('ArrowDown');
    await expect(page.getByRole('menuitem', { name: action, exact: true })).toBeFocused();
  }
  await page.keyboard.press('Enter');
  await expect(search).toHaveValue(title);
  await expect(page.locator('video')).toHaveCount(0);
  await page.getByTestId('mini-player-open-nowplaying').click();
  await expect(page.getByTestId('queue-panel').locator('.queue-item-title')).toHaveText([title]);
});

test('[PLAY.6a/AC1][STEER.8a/AC2] add without interrupting, then jump to a same-title queue entry at zero', async ({ page }) => {
  await page.goto('/media');
  const search = page.getByRole('textbox', { name: 'Search media…' });
  await expect(search).toBeVisible({ timeout: 30000 });
  await search.fill(title);
  const result = page.getByRole('option').filter({ hasText: title });
  await expect(result).toHaveCount(1, { timeout: 15000 });
  await result.click();
  await page.getByTestId('mini-player-open-nowplaying').click();
  const video = page.getByTestId('now-playing-host').locator('video');
  await expect(video).toHaveCount(1, { timeout: 30000 });
  await expect.poll(() => video.evaluate(el => !el.paused && el.readyState >= 2 && el.currentTime > 0), { timeout: 30000 }).toBe(true);
  const startedAt = await video.evaluate(el => el.currentTime);
  await expect.poll(() => video.evaluate(el => el.currentTime), {
    message: 'The decoder must advance before testing queue actions',
  }).toBeGreaterThan(startedAt + 0.25);
  await page.getByTestId('np-toggle').click();
  await expect.poll(() => video.evaluate(el => el.paused)).toBe(true);
  await page.getByRole('button', { name: 'Forward 10 seconds' }).click();
  await expect.poll(() => video.evaluate(el => el.currentTime)).toBeGreaterThan(5);
  await expect.poll(() => video.evaluate(el => el.paused && !el.seeking && el.readyState >= 2), {
    timeout: 15000, message: 'The paused seek must complete before opening result actions',
  }).toBe(true);

  await search.fill(title);
  await expect(result).toHaveCount(1, { timeout: 15000 });
  await result.getByRole('button', { name: 'More actions' }).click();
  await page.getByRole('menuitem', { name: 'Add to Queue', exact: true }).click();
  await expect(search).toHaveValue(title);
  await expect.poll(() => video.evaluate(el => el.paused), {
    message: 'Opening actions and adding must not resume paused playback',
  }).toBe(true);
  await page.keyboard.press('Escape');
  const entries = page.getByTestId('queue-panel').locator('.queue-item-title');
  await expect(entries).toHaveCount(2);
  await entries.nth(1).click();
  await expect.poll(() => video.evaluate(el => !el.paused && el.readyState >= 2
    && el.currentTime > 0 && el.currentTime < 3), {
    timeout: 30000, message: 'A new same-title queue entry must actually restart, not only update the selected row',
  }).toBe(true);
});
