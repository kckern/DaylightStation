import { test, expect } from '@playwright/test';

test.describe('MediaApp — Resume and Recents on Home', () => {
  test('home shows the resume card when a session has been paused', async ({ page }) => {
    await page.addInitScript(() => { try { localStorage.clear(); } catch {} });
    await page.goto('/media');

    // Play, then pause, to leave a paused session
    await page.getByTestId('media-search-input').fill('lonesome');
    const firstRow = page.locator('[data-testid^="result-row-"]').first();
    await expect(firstRow).toBeVisible({ timeout: 15000 });
    const id = (await firstRow.getAttribute('data-testid')).replace(/^result-row-/, '');
    // JS click bypasses overlay pointer-event interception.
    await page.getByTestId(`result-play-now-${id}`).evaluate((el) => el.click());
    await expect(page.getByTestId('mini-toggle')).toBeVisible({ timeout: 15000 });
    await page.getByTestId('mini-toggle').click(); // pause

    // Navigate home
    await page.getByTestId('app-nav-home').click();
    await expect(page.getByTestId('resume-card')).toBeVisible();
    await expect(page.getByTestId('recents-row')).toBeVisible({ timeout: 8000 });
  });
});
