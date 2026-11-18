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
    const one = page.getByRole('button', { name: 'One', exact: true });
    const two = page.getByRole('button', { name: 'Two', exact: true });
    await expect(one).toHaveAttribute('aria-current', 'page');
    await two.click();
    await expect(two).toHaveAttribute('aria-current', 'page');

    const field = page.getByRole('textbox', { name: 'Search term' });
    await expect(field).toHaveAccessibleDescription(/Use at least two characters/);
    await field.fill('a');
    await field.press('Tab');
    await expect(field).toHaveAttribute('aria-invalid', 'true');
    await expect(field).toHaveAccessibleDescription(/Enter another character/);
    await field.fill('ab');
    await expect(page.getByText('Enter another character.')).toHaveCount(0);

    // No horizontal overflow (responsive containment gate G4)
    const overflow = await page.evaluate(() =>
      document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);

    // Sheet opens and closes
    const opener = page.getByRole('button', { name: 'Open sheet' });
    await opener.click();
    await expect(page.getByText('Sheet body content.')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByText('Sheet body content.')).not.toBeVisible();
    await expect(opener).toBeFocused();

    await page.screenshot({ path: `test-results/ds-gallery-${viewport.name}.png`, fullPage: true });
  });
}
