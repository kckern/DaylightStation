import { test, expect } from '@playwright/test';
import { markFirstUseDone } from './lib/firstUse.mjs';

test.describe('MediaApp — URL / history sync', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => { try { localStorage.clear(); } catch {} });
    // After the clear: the first-use card is a real overlay over the header and Home.
    await markFirstUseDone(page);
  });

  test('fleet view writes a URL that survives a reload', async ({ page }) => {
    await page.goto('/media');
    await page.locator('[data-testid="app-nav-fleet"]:visible, [data-testid="app-tab-fleet"]:visible').first().click();
    await expect(page.getByTestId('fleet-view')).toBeVisible({ timeout: 5000 });
    const url = new URL(page.url());
    expect(url.searchParams.get('view')).toBe('fleet');

    await page.reload();
    await expect(page.getByTestId('fleet-view')).toBeVisible({ timeout: 10000 });
  });

  test('browser Back returns to the previous view', async ({ page }) => {
    await page.goto('/media');
    await page.locator('[data-testid="app-nav-fleet"]:visible, [data-testid="app-tab-fleet"]:visible').first().click();
    await expect(page.getByTestId('fleet-view')).toBeVisible({ timeout: 5000 });
    await page.goBack();
    await expect(page.getByTestId('home-view')).toBeVisible({ timeout: 5000 });
  });

  test('browse path survives reload', async ({ page }) => {
    await page.goto('/media');
    // Home no longer has numbered cards: Browse is a primary destination, and
    // opening a collection there writes the path into the URL.
    await page.getByTestId('app-nav-browse').click();
    await expect(page.getByTestId('browse-view')).toBeVisible({ timeout: 10000 });
    await page.locator('[data-testid^="browse-open-"]').first().click();
    await expect.poll(() => new URL(page.url()).searchParams.get('path'), { timeout: 10000 }).toBeTruthy();
    const urlBefore = page.url();
    await page.reload();
    await expect(page.getByTestId('browse-view')).toBeVisible({ timeout: 10000 });
    expect(page.url()).toBe(urlBefore);
  });
});
