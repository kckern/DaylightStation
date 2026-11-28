import { test, expect } from '@playwright/test';

test.describe('MediaApp — P4 cast', () => {
  test.use({ viewport: { width: 1440, height: 900 } });
  test.beforeEach(async ({ page }) => {
    await page.goto('/media');
    await page.evaluate(() => localStorage.clear());
  });

  test('desktop: the destination lives in the search box chip, not the header, and a click walks the cycle', async ({ page }) => {
    await page.goto('/media');
    const chip = page.getByTestId('search-destination-chip');
    await expect(chip).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId('cast-target-chip')).toHaveCount(0);
    await expect(chip).toHaveText(/^▶ \S/);
    const first = (await chip.innerText()).trim();
    await chip.click();
    await expect.poll(async () => (await chip.innerText()).trim()).not.toBe(first);
  });

  // A phone has no header "Playing on" control either: the same chip and ▾
  // ride the right end of the search launcher (one destination, where you type).
  test.describe('phone launcher chip', () => {
    test.use({ viewport: { width: 390, height: 844 } });
    const row = (page) => page.getByTestId('media-search-launcher-row');

    test('the launcher carries the chip; no header control', async ({ page }) => {
      await page.goto('/media');
      const chip = row(page).getByTestId('search-destination-chip');
      await expect(chip).toBeVisible({ timeout: 10000 });
      await expect(page.getByText('Playing on', { exact: true })).toHaveCount(0);
      await expect(chip).toHaveText(/^▶ \S/);
      const first = (await chip.innerText()).trim();
      await chip.click();
      await expect.poll(async () => (await chip.innerText()).trim()).not.toBe(first);
    });

    test('the ▾ opens the destination list and Escape closes it', async ({ page }) => {
      await page.goto('/media');
      await row(page).getByTestId('search-destination-list-toggle').click();
      await expect(page.getByTestId('dest-list')).toBeVisible();
      await expect(page.getByTestId('dest-list-row-local')).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(page.getByTestId('dest-list')).toBeHidden({ timeout: 2000 });
    });
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

    // Tap the first idle device: an idle target is sent to by the tap itself
    // (NF-TAP-10). A busy one asks first, and the picker leads with what is on
    // now, so a screen an earlier journey left playing would come first.
    const firstDevice = page.locator('[data-testid^="picker-device-"]').filter({ hasNotText: /Playing|Paused|Starting/ }).first();
    await expect(firstDevice).toBeVisible();
    await firstDevice.click();

    // Picker closes once sent.
    await expect(page.getByTestId('dispatch-target-picker')).not.toBeVisible({ timeout: 5000 });
  });
});
