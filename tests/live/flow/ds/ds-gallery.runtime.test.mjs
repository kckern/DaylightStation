// tests/live/flow/ds/ds-gallery.runtime.test.mjs
// Visual verification for DS primitives — jsdom cannot see layout, this can.
import { test, expect } from '@playwright/test';

for (const viewport of [
  { name: 'phone', width: 390, height: 844 },
  { name: 'desktop', width: 1280, height: 900 },
]) {
  test(`ds gallery renders at ${viewport.name}`, async ({ page }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.goto('/dev/ds-gallery');
    await expect(page.getByTestId('gallery-grid')).toBeVisible();

    // Chrome renders: title, both tabs, footer affordance
    await expect(page.getByText('DS Gallery')).toBeVisible();
    await expect(page.getByRole('link', { name: /One/ })).toBeVisible();

    // No horizontal overflow (responsive containment gate G4)
    const overflow = await page.evaluate(() =>
      document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);

    // Sheet opens and closes
    await page.getByRole('button', { name: 'Open sheet' }).click();
    await expect(page.getByText('Sheet body content.')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByText('Sheet body content.')).not.toBeVisible();

    await page.screenshot({ path: `test-results/ds-gallery-${viewport.name}.png`, fullPage: true });
  });
}
