// tests/live/flow/media/media-app-discovery.runtime.test.mjs
import { test, expect } from '@playwright/test';
import { markFirstUseDone } from './lib/firstUse.mjs';
import { searchFor } from './lib/mediaDriver.mjs';

// The header search is the dock's "Search media…" textbox (laptop width, the
// default here); results are combobox options whose ⋯ menu carries the verbs.
// There is no media-search-input / result-row / inline-peek surface any more:
// a result's detail is the Open detail verb (FIND.8a).
const TITLE = 'Arrival';
const resultOption = (page) => page.getByRole('option').filter({ hasText: TITLE }).filter({ hasText: 'Movie' });
async function contentIdOf(option) {
  const testId = await option.getAttribute('data-testid');
  const contentId = testId?.replace(/^combobox-option-/, '');
  expect(contentId).toBeTruthy();
  return contentId;
}

test.describe('MediaApp — P2 discovery', () => {
  test.beforeEach(async ({ page, context }) => {
    await markFirstUseDone(context);
    await page.goto('/media');
    await page.evaluate(() => {
      localStorage.clear();
    });
  });

  test('renders Home view with browse cards', async ({ page }) => {
    await page.goto('/media');
    await expect(page.getByTestId('home-view')).toBeVisible({ timeout: 10000 });
  });

  test('search returns results and Play Now starts playback', async ({ page }) => {
    await page.goto('/media');
    await searchFor(page, TITLE);
    const option = resultOption(page);
    await expect(option).toHaveCount(1, { timeout: 15000 });
    const contentId = await contentIdOf(option);

    await option.getByRole('button', { name: 'More actions' }).click();
    await page.getByTestId(`result-action-playNow-${contentId}`).click();

    await page.getByTestId('mini-player-open-nowplaying').click();
    // The heading shows the human title; the canonical id is exposed as a
    // data attribute so we can assert the RIGHT item is playing.
    const npTitle = page.getByTestId('now-playing-title');
    await expect(npTitle).toBeVisible({ timeout: 10000 });
    await expect(npTitle).toContainText(/Now Playing:/i, { timeout: 30000 });
    await expect(npTitle).toHaveAttribute('data-content-id', contentId, { timeout: 10000 });
  });

  test('Open detail on a search result shows its detail without starting playback', async ({ page }) => {
    await page.goto('/media');
    await searchFor(page, TITLE);
    const option = resultOption(page);
    await expect(option).toHaveCount(1, { timeout: 15000 });
    const contentId = await contentIdOf(option);

    await option.getByRole('button', { name: 'More actions' }).click();
    await page.getByTestId(`result-action-detail-${contentId}`).click();

    await expect(page.getByTestId('detail-view')).toBeVisible({ timeout: 15000 });
    await expect(page.getByTestId('detail-play-now')).toBeVisible();
    // Looking at a result's detail never starts it: no session, no handle.
    await expect(page.getByTestId('media-mini-player')).toHaveCount(0);
  });
});
