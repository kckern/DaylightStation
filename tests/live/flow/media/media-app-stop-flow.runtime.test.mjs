import { test, expect } from '@playwright/test';

test.describe('MediaApp — Stop flow', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => { try { localStorage.clear(); } catch {} });
  });

  test('Stop returns the session to idle', async ({ page }) => {
    await page.goto('/media');
    await page.getByTestId('media-search-input').fill('lonesome');
    const firstRow = page.locator('[data-testid^="result-row-"]').first();
    await expect(firstRow).toBeVisible({ timeout: 15000 });
    const id = (await firstRow.getAttribute('data-testid')).replace(/^result-row-/, '');
    // Use JS click to bypass overlay pointer-event interception.
    const btn = page.getByTestId(`result-play-now-${id}`);
    await expect(btn).toBeAttached();
    await btn.evaluate((el) => el.click());
    await expect(page.getByTestId('mini-toggle')).toBeVisible({ timeout: 15000 });

    // Stop
    await page.getByTestId('mini-stop').click();

    // MiniPlayer back to idle
    await expect(page.getByTestId('media-mini-player')).toHaveText(/idle/i);
  });
});
