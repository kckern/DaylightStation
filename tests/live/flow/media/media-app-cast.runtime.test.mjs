import { test, expect } from '@playwright/test';

test.describe('MediaApp — P4 cast', () => {
  test.use({ viewport: { width: 1440, height: 900 } });
  test.beforeEach(async ({ page }) => {
    await page.goto('/media');
    await page.evaluate(() => localStorage.clear());
  });

  test('CastTargetChip renders and opens a popover', async ({ page }) => {
    await page.goto('/media');
    await expect(page.getByTestId('cast-target-chip')).toBeVisible({ timeout: 10000 });
    await page.getByTestId('cast-target-chip').click();
    await expect(page.getByTestId('cast-popover')).toBeVisible();
    await expect(page.getByTestId('cast-mode-transfer')).toBeVisible();
    await expect(page.getByTestId('cast-mode-fork')).toBeVisible();
  });

  test('opening the inline cast picker from a result row shows the DispatchTargetPicker', async ({ page }) => {
    // Stub dispatch so we don't actually wake a device.
    await page.route('**/api/v1/device/*/load*', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true, dispatchId: 'cast-tray-1', steps: [], totalElapsedMs: 5 }),
      });
    });
    await page.goto('/media');
    await page.getByRole('textbox', { name: 'Search media…' }).fill('Arrival');
    const more = page.locator('[data-testid^="result-more-"]').first();
    await expect(more).toBeVisible({ timeout: 15000 });

    // Open the destination picker from the result's ⋯ menu (Play on…).
    await more.click();
    await page.getByRole('menuitem', { name: 'Play on…' }).click();
    await expect(page.getByTestId('dispatch-target-picker')).toBeVisible({ timeout: 5000 });

    // Tap the first device: an idle target is sent to by the tap itself (NF-TAP-10).
    const firstDevice = page.locator('[data-testid^="picker-device-"]').first();
    await expect(firstDevice).toBeVisible();
    await firstDevice.click();

    // Picker closes once sent.
    await expect(page.getByTestId('dispatch-target-picker')).not.toBeVisible({ timeout: 5000 });
  });

  test('Escape closes the cast popover', async ({ page }) => {
    await page.goto('/media');
    await page.getByTestId('cast-target-chip').click();
    await expect(page.getByTestId('cast-popover')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('cast-popover')).toBeHidden({ timeout: 2000 });
  });

  test('outside click closes the cast popover', async ({ page }) => {
    await page.goto('/media');
    await page.getByTestId('cast-target-chip').click();
    await expect(page.getByTestId('cast-popover')).toBeVisible();
    await page.locator('[data-testid="media-canvas"]').click({ position: { x: 400, y: 400 } });
    await expect(page.getByTestId('cast-popover')).toBeHidden({ timeout: 2000 });
  });
});
