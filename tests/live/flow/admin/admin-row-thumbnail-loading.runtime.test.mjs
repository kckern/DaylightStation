/**
 * Admin Row Thumbnail Loading State
 *
 * Verifies that when a user changes a content/image value in a ContentList row,
 * the row icon shows a shimmer placeholder during the image transition instead
 * of displaying the stale image until the new one finishes downloading.
 */

import { test, expect } from '@playwright/test';
import { FRONTEND_URL } from '#fixtures/runtime/urls.mjs';

test('row thumbnail shows shimmer placeholder between save and new image load', async ({ page }) => {
  await page.goto(`${FRONTEND_URL}/admin`);

  // Throttle image loads to make the shimmer state observable.
  await page.route('**/*.{png,jpg,jpeg,webp,gif}', async (route) => {
    await new Promise(resolve => setTimeout(resolve, 800));
    await route.continue();
  });

  // Navigate to a ContentList with a canvas-image row.
  await page.getByRole('link', { name: /menus|lists|fhe/i }).first().click();

  const row = page.locator('[data-content-value^="canvas:"]').first();
  await row.click();

  // Change the value via freeform enter.
  const input = page.locator('input[placeholder*="Search"], input[data-combobox]').first();
  await input.fill('canvas:religious/serpent.jpg');
  await input.press('Enter');

  // Immediately check for the shimmer placeholder on the row icon.
  const shimmer = page.locator('[data-content-value] .avatar-shimmer, .col-icon .avatar-shimmer').first();
  await expect(shimmer).toBeVisible({ timeout: 500 });

  // Eventually the shimmer should disappear (image loaded).
  await expect(shimmer).toBeHidden({ timeout: 3000 });
});
