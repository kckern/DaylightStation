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

    await expect(page.getByText('DS Gallery')).toBeVisible();
    const controls = page.getByRole('button', { name: 'Controls', exact: true });
    const choices = page.getByRole('button', { name: 'Choices', exact: true });
    await expect(page.getByRole('link', { name: 'Admin', exact: true })).toHaveAttribute('href', '/admin');
    await expect(controls).toHaveAttribute('aria-current', 'page');
    await choices.click();
    await expect(choices).toHaveAttribute('aria-current', 'page');

    const order = page.getByRole('radio', { name: 'Title' });
    await order.check();
    await page.getByText('Library', { exact: true }).click();
    await page.getByText('Feed', { exact: true }).click();
    const saved = page.getByRole('checkbox', { name: 'Saved items only' });
    await saved.check();
    await expect(page.getByRole('checkbox', { name: 'Library' })).toBeChecked();
    await expect(page.getByRole('checkbox', { name: 'Feed' })).toBeChecked();
    await page.getByRole('button', { name: 'Filter actions' }).press('Enter');
    await page.getByRole('menuitem', { name: 'Reset filters' }).press('Enter');
    await expect(page.getByRole('radio', { name: 'Recently added' })).toBeChecked();
    await expect(saved).not.toBeChecked();
    await expect(page.getByRole('checkbox', { name: 'Library' })).not.toBeChecked();
    await expect(choices).toHaveAttribute('aria-current', 'page');
    await controls.click();

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
    const density = page.getByRole('combobox', { name: 'Density' });
    await density.selectOption('touch');
    await expect(opener).toHaveAttribute('data-density', 'touch');
    await density.selectOption('compact');
    await opener.click();
    await expect(page.getByText('Sheet body content.')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByText('Sheet body content.')).not.toBeVisible();
    await expect(opener).toBeFocused();

    await page.screenshot({ path: `test-results/ds-gallery-${viewport.name}.png`, fullPage: true });
  });
}

test.describe('coarse pointer choices', () => {
  test.use({ hasTouch: true, isMobile: true, viewport: { width: 390, height: 844 } });
  test('choice labels and portalled menu actions have a full touch target', async ({ page }) => {
    await page.goto('/dev/ds-gallery');
    await page.getByRole('button', { name: 'Choices', exact: true }).tap();
    for (const name of ['Recently added', 'Title', 'Library', 'Feed', 'Saved items only']) {
      const label = page.getByText(name, { exact: true });
      const bounds = await label.evaluate(el => el.closest('label').getBoundingClientRect().toJSON());
      expect(bounds.height, name).toBeGreaterThanOrEqual(44);
      expect(bounds.width, name).toBeGreaterThanOrEqual(44);
    }
    await page.getByRole('button', { name: 'Filter actions' }).tap();
    const bounds = await page.getByRole('menuitem', { name: 'Reset filters' }).boundingBox();
    expect(bounds.height).toBeGreaterThanOrEqual(44);
  });
});
