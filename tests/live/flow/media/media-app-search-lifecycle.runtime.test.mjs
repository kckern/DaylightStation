import { test, expect } from '@playwright/test';

test.describe('MediaApp — search dropdown lifecycle', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/media');
    await page.evaluate(() => localStorage.clear());
  });

  test('Escape closes the search results dropdown', async ({ page }) => {
    await page.goto('/media');
    await page.getByTestId('media-search-input').fill('lonesome');
    await expect(page.locator('ul[data-testid="media-search-results"]')).toBeVisible({ timeout: 15000 });
    await page.keyboard.press('Escape');
    await expect(page.locator('ul[data-testid="media-search-results"]')).toBeHidden({ timeout: 2000 });
  });

  test('outside click closes the search results dropdown', async ({ page }) => {
    await page.goto('/media');
    await page.getByTestId('media-search-input').fill('lonesome');
    await expect(page.locator('ul[data-testid="media-search-results"]')).toBeVisible({ timeout: 15000 });
    // Click clearly outside the dropdown (search bar max-width is 560px; click far right).
    await page.mouse.click(1000, 600);
    await expect(page.locator('ul[data-testid="media-search-results"]')).toBeHidden({ timeout: 2000 });
  });

  test('Play Now from search auto-closes the dropdown and clears the query', async ({ page }) => {
    await page.goto('/media');
    await page.getByTestId('media-search-input').fill('lonesome');
    const firstRow = page.locator('[data-testid^="result-row-"]').first();
    await expect(firstRow).toBeVisible({ timeout: 15000 });
    const rowId = await firstRow.getAttribute('data-testid');
    const contentId = rowId?.replace(/^result-row-/, '');
    await firstRow.hover();
    await page.getByTestId(`result-play-now-${contentId}`).click();
    await expect(page.locator('ul[data-testid="media-search-results"]')).toBeHidden({ timeout: 2000 });
    await expect(page.getByTestId('media-search-input')).toHaveValue('');
  });
});
