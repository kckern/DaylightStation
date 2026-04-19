import { test, expect } from '@playwright/test';

test.describe('MediaApp — URL / history sync', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => { try { localStorage.clear(); } catch {} });
  });

  test('fleet view writes a URL that survives a reload', async ({ page }) => {
    await page.goto('/media');
    await page.getByTestId('fleet-indicator').click();
    await expect(page.getByTestId('fleet-view')).toBeVisible({ timeout: 5000 });
    const url = new URL(page.url());
    expect(url.searchParams.get('view')).toBe('fleet');

    await page.reload();
    await expect(page.getByTestId('fleet-view')).toBeVisible({ timeout: 10000 });
  });

  test('browser Back returns to the previous view', async ({ page }) => {
    await page.goto('/media');
    await page.getByTestId('fleet-indicator').click();
    await expect(page.getByTestId('fleet-view')).toBeVisible({ timeout: 5000 });
    await page.goBack();
    await expect(page.getByTestId('home-view')).toBeVisible({ timeout: 5000 });
  });

  test('browse path survives reload', async ({ page }) => {
    await page.goto('/media');
    await page.locator('[data-testid^="home-card-"]').first().click();
    await expect(page.getByTestId('browse-view')).toBeVisible({ timeout: 10000 });
    const urlBefore = page.url();
    await page.reload();
    await expect(page.getByTestId('browse-view')).toBeVisible({ timeout: 10000 });
    expect(page.url()).toBe(urlBefore);
  });
});
