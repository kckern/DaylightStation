import { test, expect } from '@playwright/test';
import { markFirstUseDone } from './lib/firstUse.mjs';
import { aimHere } from './lib/aim.mjs';

test.use({ viewport: { width: 390, height: 844 }, trace: 'retain-on-failure', actionTimeout: 10000 });
test.setTimeout(90000);

test.afterEach(async ({ page }) => {
  if (page.isClosed()) return;
  const closeSearch = page.getByTestId('search-mode-close');
  if (await closeSearch.isVisible()) await closeSearch.click();
  const stop = page.getByTestId('np-stop');
  if (!(await stop.isVisible())) {
    const open = page.getByTestId('mini-player-open-nowplaying');
    if (await open.isVisible()) await open.click();
  }
  if (await stop.isVisible()) await stop.click();
});

test('[FIND.1a/AC5] phone a row opens the info view (nothing plays) and only PLAY starts actual media', async ({ page }) => {
  const title = process.env.MEDIA_ACCEPTANCE_TITLE || 'Disclosure Day';
  await markFirstUseDone(page);
  await page.goto('/media');
  await aimHere(page); // PLAY then reads "Play here"
  await expect(page.getByTestId('media-search-launcher')).toBeVisible({ timeout: 30000 });
  await page.getByTestId('media-search-launcher').click();
  const search = page.getByRole('dialog', { name: 'Search media', exact: true });
  const input = search.getByRole('searchbox', { name: 'Search media', exact: true });
  await input.fill(title);
  await search.getByRole('button', { name: 'Video', exact: true }).click();
  const result = search.getByTestId('search-mode-results').getByText(title, { exact: true });
  await expect(result).toHaveCount(1, { timeout: 15000 });
  const row = result.locator('xpath=ancestor::li');
  await expect(row.getByText('Film', { exact: true })).toBeVisible();
  expect(await row.locator('img, [data-testid="result-artwork-placeholder"]').count()).toBeGreaterThan(0);

  await row.getByRole('button', { name: 'More actions' }).click();
  await page.getByRole('menuitem', { name: 'Add to Queue', exact: true }).click();
  await expect(search, 'Add must retain the same search work surface').toBeVisible();
  await expect(input).toHaveValue(title);
  await expect(search.getByRole('button', { name: 'Video', exact: true })).toHaveAttribute('aria-pressed', 'true');

  // Selecting the row only opens its info view (nothing plays); PLAY plays.
  await result.click();
  await expect(page.getByTestId('detail-play-now'), 'a row opens the info view with PLAY').toBeVisible({ timeout: 30000 });
  await expect(page.locator('video'), 'selecting a result must not start playback').toHaveCount(0);
  await page.getByTestId('detail-play-now').click();
  const video = page.locator('video');
  // An item other screens hold different places in asks where to continue
  // from (SpotChooser, PLAY.4a/AC2; the seed's Disclosure Day has two): take
  // the first offered place, which is still PLAY's own start.
  const firstSpot = page.getByTestId('spot-choice-0');
  await expect(video.or(firstSpot).first()).toBeAttached({ timeout: 30000 });
  if (await firstSpot.isVisible()) await firstSpot.click();
  await expect(video).toHaveCount(1, { timeout: 30000 });
  await expect.poll(() => video.evaluate(el => !el.paused && el.readyState >= 2 && el.currentTime > 0), {
    timeout: 30000, message: 'Keeping search open must not prevent actual playback',
  }).toBe(true);
  const firstPosition = await video.evaluate(el => el.currentTime);
  await expect.poll(() => video.evaluate(el => el.currentTime), { timeout: 10000 })
    .toBeGreaterThan(firstPosition + 0.25);
});
