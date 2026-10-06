// tests/live/flow/media/media-app-fleet.runtime.test.mjs
import { test, expect } from '@playwright/test';

test.describe('MediaApp — P3 fleet observation', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/media');
    await page.evaluate(() => localStorage.clear());
  });

  test('the Devices destination opens the fleet view', async ({ page }) => {
    await page.goto('/media');

    await page.locator('[data-testid="app-nav-fleet"]:visible, [data-testid="app-tab-fleet"]:visible').first().click();
    await expect(page.getByTestId('fleet-view')).toBeVisible({ timeout: 5000 });
  });

  test('fleet view shows cards for known playback devices', async ({ page }) => {
    await page.goto('/media');
    await page.locator('[data-testid="app-nav-fleet"]:visible, [data-testid="app-tab-fleet"]:visible').first().click();
    await expect(page.getByTestId('fleet-view')).toBeVisible({ timeout: 5000 });

    const anyCard = page.locator('[data-testid^="fleet-card-"]').first();
    await expect(anyCard).toBeVisible({ timeout: 5000 });
  });
});
