// tests/live/flow/media/media-app-fleet.runtime.test.mjs
import { test, expect } from '@playwright/test';

test.describe('MediaApp — P3 fleet observation', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/media');
    await page.evaluate(() => localStorage.clear());
  });

  test('fleet indicator renders in the dock and opens the fleet view', async ({ page }) => {
    await page.goto('/media');
    await expect(page.getByTestId('fleet-indicator')).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId('fleet-indicator')).toHaveText(/Fleet \d+\/\d+/);

    await page.getByTestId('fleet-indicator').click();
    await expect(page.getByTestId('fleet-view')).toBeVisible({ timeout: 5000 });
  });

  test('fleet view shows cards for known playback devices', async ({ page }) => {
    await page.goto('/media');
    await page.getByTestId('fleet-indicator').click();
    await expect(page.getByTestId('fleet-view')).toBeVisible({ timeout: 5000 });

    const anyCard = page.locator('[data-testid^="fleet-card-"]').first();
    await expect(anyCard).toBeVisible({ timeout: 5000 });
  });
});
