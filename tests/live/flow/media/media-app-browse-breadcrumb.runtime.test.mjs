import { test, expect } from '@playwright/test';

test.describe('MediaApp — browse breadcrumb', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => { try { localStorage.clear(); } catch {} });
  });

  test('browse view renders a breadcrumb for each path segment', async ({ page }) => {
    await page.goto('/media');
    await page.locator('[data-testid^="home-card-"]').first().click();
    await expect(page.getByTestId('browse-view')).toBeVisible({ timeout: 10000 });
    const segments = page.locator('[data-testid^="browse-crumb-"]');
    await expect(segments.first()).toBeVisible({ timeout: 5000 });
    const firstCrumbText = await segments.first().textContent();
    expect(firstCrumbText?.trim().length).toBeGreaterThan(0);
  });

  test('clicking Home crumb returns to the home view', async ({ page }) => {
    await page.goto('/media');
    await page.locator('[data-testid^="home-card-"]').first().click();
    await expect(page.getByTestId('browse-view')).toBeVisible({ timeout: 10000 });
    await page.getByTestId('browse-crumb-home').click();
    await expect(page.getByTestId('home-view')).toBeVisible({ timeout: 5000 });
  });
});
