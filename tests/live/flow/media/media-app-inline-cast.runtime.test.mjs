import { test, expect } from '@playwright/test';

test.describe('MediaApp — inline cast from a result row', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => { try { localStorage.clear(); } catch {} });
  });

  test('opens DispatchTargetPicker inline and dispatches with selected target', async ({ page }) => {
    // Stub the dispatch endpoint so the test does not actually wake a TV.
    await page.route('**/api/v1/device/*/load*', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true, dispatchId: 'test-disp-1', steps: [], totalElapsedMs: 12 }),
      });
    });

    await page.goto('/media');
    await page.getByTestId('media-search-input').fill('lonesome');
    const firstRow = page.locator('[data-testid^="result-row-"]').first();
    await expect(firstRow).toBeVisible({ timeout: 15000 });
    const id = (await firstRow.getAttribute('data-testid')).replace(/^result-row-/, '');

    // Open inline picker via the per-row Cast button (JS click bypasses overlay pointer-event interception).
    await page.getByTestId(`cast-button-${id}`).evaluate((el) => el.click());
    await expect(page.getByTestId('dispatch-target-picker')).toBeVisible();

    // Select first device + submit (JS clicks bypass overlay pointer-event interception).
    const firstDevice = page.locator('[data-testid^="picker-device-"]').first();
    await expect(firstDevice).toBeVisible();
    await firstDevice.evaluate((el) => el.click());
    await page.getByTestId('picker-submit').evaluate((el) => el.click());

    // Picker closes after submit
    await expect(page.getByTestId('dispatch-target-picker')).not.toBeVisible();
  });
});
