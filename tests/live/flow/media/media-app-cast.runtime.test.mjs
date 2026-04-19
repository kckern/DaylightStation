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

  test('selecting a device and casting a search result places a row in the dispatch tray', async ({ page }) => {
    await page.goto('/media');
    await page.getByTestId('cast-target-chip').click();
    const firstTarget = page.locator('[data-testid^="cast-target-checkbox-"]').first();
    await expect(firstTarget).toBeVisible({ timeout: 5000 });
    await firstTarget.check();
    await page.getByTestId('cast-target-chip').click();

    await page.getByTestId('media-search-input').fill('lonesome');
    const firstRow = page.locator('[data-testid^="result-row-"]').first();
    await expect(firstRow).toBeVisible({ timeout: 15000 });

    const rowId = await firstRow.getAttribute('data-testid');
    const contentId = rowId?.replace(/^result-row-/, '');
    expect(contentId).toBeTruthy();

    await page.getByTestId(`cast-button-${contentId}`).click();

    await expect(page.getByTestId('dispatch-tray')).toBeVisible({ timeout: 10000 });
    const anyRow = page.locator('[data-testid^="dispatch-row-"]').first();
    await expect(anyRow).toBeVisible({ timeout: 10000 });
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
