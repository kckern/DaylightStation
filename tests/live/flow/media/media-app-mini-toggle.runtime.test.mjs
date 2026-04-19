import { test, expect } from '@playwright/test';

test.describe('MediaApp — mini player toggle', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/media');
    await page.evaluate(() => localStorage.clear());
  });

  async function startPlayback(page) {
    await page.goto('/media');
    await page.getByTestId('media-search-input').fill('lonesome');
    const row = page.locator('[data-testid^="result-row-"]').first();
    await expect(row).toBeVisible({ timeout: 15000 });
    const rowId = await row.getAttribute('data-testid');
    const contentId = rowId?.replace(/^result-row-/, '');
    await row.hover();
    await page.getByTestId(`result-play-now-${contentId}`).click();
  }

  test('mini player shows exactly one transport button that toggles', async ({ page }) => {
    await startPlayback(page);
    const toggle = page.getByTestId('mini-toggle');
    await expect(toggle).toBeVisible({ timeout: 5000 });
    // When playing, toggle label should indicate Pause
    await expect(toggle).toHaveAttribute('aria-label', /pause/i);
    await toggle.click();
    // After click the element should be paused and label should read Play
    await expect(toggle).toHaveAttribute('aria-label', /play/i, { timeout: 2000 });
    // And there should be only one transport button, not both mini-play and mini-pause
    await expect(page.getByTestId('mini-play')).toHaveCount(0);
    await expect(page.getByTestId('mini-pause')).toHaveCount(0);
  });
});
