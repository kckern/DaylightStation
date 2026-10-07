import { test, expect } from '@playwright/test';
import { markFirstUseDone } from './lib/firstUse.mjs';

// An id typed with a source prefix that names no source (`plex-main:12345`)
// used to sit on "Searching…" for as long as the slowest adapter took to time
// out (the literal text was searched everywhere). It must settle quickly with a
// stated outcome — on the desktop dropdown and on the phone's full-screen
// search — and must never start anything by itself.
test.beforeEach(async ({ context }) => { await markFirstUseDone(context); });
test.use({ trace: 'retain-on-failure', serviceWorkers: 'block' });
test.setTimeout(120000);

const SETTLE_MS = 12000;

async function openMedia(page) {
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    await page.goto('/media', { waitUntil: 'domcontentloaded' });
    if (await page.getByTestId('media-shell').waitFor({ state: 'visible', timeout: 40000 }).then(() => true, () => false)) return;
  }
  await expect(page.getByTestId('media-shell')).toBeVisible({ timeout: 1000 });
}

test('[FIND.4a/AC4] desktop: an id for a source that does not exist settles to "No results" within seconds', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openMedia(page);
  const search = page.getByRole('textbox', { name: 'Search media…' });
  await expect(search).toBeVisible({ timeout: 30000 });
  const started = Date.now();
  await search.fill('plex-main:12345');
  await expect(search).toHaveValue('plex-main:12345');
  await expect(page.getByRole('listbox')).toContainText(/No results/i, { timeout: SETTLE_MS });
  const elapsed = Date.now() - started;
  expect(elapsed, `settled in ${elapsed} ms`).toBeLessThan(SETTLE_MS);
  await expect(page.getByTestId('stream-status-line')).toHaveCount(0);
  await expect(page.getByTestId('media-mini-player')).toHaveCount(0);
  await page.screenshot({ path: 'test-results/media-p0-features/search-unknown-source-laptop.png' });
});

test('[FIND.4a/AC4] phone: the same id settles to a stated outcome in the full-screen search', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openMedia(page);
  await page.getByTestId('media-search-launcher').click();
  const box = page.getByRole('searchbox', { name: 'Search media', exact: true });
  const started = Date.now();
  await box.fill('plex-main:12345');
  await expect(page.getByTestId('search-mode-empty')).toContainText(/No results for/i, { timeout: SETTLE_MS });
  expect(Date.now() - started).toBeLessThan(SETTLE_MS);
  await expect(page.getByTestId('media-mini-player')).toHaveCount(0);
  await page.screenshot({ path: 'test-results/media-p0-features/search-unknown-source-phone.png' });
});
