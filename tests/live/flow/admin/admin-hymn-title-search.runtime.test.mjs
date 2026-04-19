import { test, expect } from '@playwright/test';
import { getAppUrl } from '../../../_lib/configHelper.mjs';

test('admin combobox finds hymn by title from inside a different hymn value', async ({ page }) => {
  const base = await getAppUrl();
  await page.goto(`${base}/admin`);

  // Navigate to an FHE-like list that contains a singalong:hymn/N row.
  // This assumes the admin home shows lists; adjust selector to match your routes.
  await page.getByRole('link', { name: /menus|lists|fhe/i }).first().click();

  // Click the first row whose current value is a singalong hymn.
  const hymnRow = page.locator('[data-content-value^="singalong:hymn/"]').first();
  await hymnRow.click();

  // Clear the input and type 'redeemer' within the singalong scope.
  const input = page.locator('input[placeholder*="Search"], input[data-combobox]').first();
  await input.fill('singalong:redeemer');

  // Wait for backend results.
  const option = page.getByRole('option', { name: /redeemer lives/i });
  await expect(option).toBeVisible({ timeout: 3000 });
});
