import { test, expect } from '@playwright/test';

test.describe('MediaApp — inline cast from a result row', () => {
  test.use({ viewport: { width: 1440, height: 900 } });
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
    await page.getByRole('textbox', { name: 'Search media…' }).fill('Arrival');
    const more = page.locator('[data-testid^="result-more-"]').first();
    await expect(more).toBeVisible({ timeout: 15000 });

    // Open the destination picker from the result's ⋯ menu (Play on…).
    await more.click();
    await page.getByRole('menuitem', { name: 'Play on…' }).click();
    await expect(page.getByTestId('dispatch-target-picker')).toBeVisible();

    // Tap the first device (JS clicks bypass overlay pointer-event interception); an idle target is sent to by the tap itself (NF-TAP-10).
    const firstDevice = page.locator('[data-testid^="picker-device-"]').first();
    await expect(firstDevice).toBeVisible();
    await firstDevice.click();

    // Picker closes once sent
    await expect(page.getByTestId('dispatch-target-picker')).not.toBeVisible();
  });
});
