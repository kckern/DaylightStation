import { test, expect } from '@playwright/test';

test.describe('MediaApp — P5 peek', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/media');
    await page.evaluate(() => localStorage.clear());
  });

  test('FleetView has a Peek button per device that opens PeekPanel', async ({ page }) => {
    await page.goto('/media');
    await page.getByTestId('fleet-indicator').click();
    await expect(page.getByTestId('fleet-view')).toBeVisible({ timeout: 10000 });

    const peekBtn = page.locator('[data-testid^="fleet-peek-"]').first();
    await expect(peekBtn).toBeVisible({ timeout: 5000 });
    await peekBtn.click();

    await expect(page.getByTestId('peek-panel')).toBeVisible({ timeout: 5000 });
    await expect(page.getByTestId('peek-play')).toBeVisible();
    await expect(page.getByTestId('peek-pause')).toBeVisible();
  });
});
