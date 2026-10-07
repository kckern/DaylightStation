import { test, expect } from '@playwright/test';
import { markFirstUseDone } from './lib/firstUse.mjs';

test.use({ viewport: { width: 1280, height: 800 }, trace: 'retain-on-failure', actionTimeout: 10000 });
test.setTimeout(90000);

test.describe('MediaApp — search dropdown lifecycle', () => {
  const searchInput = page => page.getByRole('textbox', { name: 'Search media…' });

  test.beforeEach(async ({ page, context }) => {
    // A fresh browser opens the first-use naming card over the header and Home;
    // it is a real overlay (it intercepts the outside click), so mark it answered.
    await markFirstUseDone(context);
    await page.goto('/media');
    await page.evaluate(() => localStorage.clear());
  });

  test('Escape closes the search results dropdown', async ({ page }) => {
    await page.goto('/media');
    await searchInput(page).fill('lonesome');
    await expect(page.getByRole('listbox')).toBeVisible({ timeout: 15000 });
    await page.keyboard.press('Escape');
    await expect(page.getByRole('listbox')).toBeHidden({ timeout: 2000 });
  });

  test('outside click closes the search results dropdown', async ({ page }) => {
    await page.goto('/media');
    await searchInput(page).fill('lonesome');
    await expect(page.getByRole('listbox')).toBeVisible({ timeout: 15000 });
    await page.getByTestId('home-view').click({ position: { x: 8, y: 8 } });
    await expect(page.getByRole('listbox')).toBeHidden({ timeout: 2000 });
  });

  test('[FIND.1a/AC5] playable-row Play keeps the desktop search open with its exact query', async ({ page }) => {
    await page.goto('/media');
    await searchInput(page).fill('Arrival');
    const firstRow = page.locator('[data-testid^="combobox-option-"]').first();
    await expect(firstRow).toBeVisible({ timeout: 15000 });
    await firstRow.click();
    await expect(page.locator('[role="listbox"]')).toBeVisible();
    await expect(searchInput(page)).toHaveValue('Arrival');
  });
});
