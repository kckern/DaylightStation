import { test, expect } from '@playwright/test';

test.describe('MediaApp — P4 cast', () => {
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
    await page.addInitScript(() => { try { localStorage.clear(); } catch {} });

    await page.getByTestId('media-search-input').fill('lonesome');
    const firstRow = page.locator('[data-testid^="result-row-"]').first();
    await expect(firstRow).toBeVisible({ timeout: 15000 });

    const rowId = await firstRow.getAttribute('data-testid');
    const contentId = rowId?.replace(/^result-row-/, '');
    expect(contentId).toBeTruthy();

    // Open inline DispatchTargetPicker via the per-row Cast button.
    // JS click bypasses search-overlay pointer-event interception.
    await page.getByTestId(`cast-button-${contentId}`).evaluate((el) => el.click());
    await expect(page.getByTestId('dispatch-target-picker')).toBeVisible({ timeout: 5000 });

    // Select first device and submit.
    const firstDevice = page.locator('[data-testid^="picker-device-"]').first();
    await expect(firstDevice).toBeVisible();
    await firstDevice.evaluate((el) => el.click());
    await page.getByTestId('picker-submit').evaluate((el) => el.click());

    // Picker closes after submit.
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
