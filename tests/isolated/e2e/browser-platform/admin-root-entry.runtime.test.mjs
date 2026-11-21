import { expect, test } from '@playwright/test';

test.use({ serviceWorkers: 'block' });
test.beforeEach(async ({ page }) => {
  await page.routeWebSocket('**/*', () => {});
  await page.route('**/api/**', route => route.fulfill({ json: {} }));
  await page.route('**/auth/context', route => route.fulfill({ json: { needsSetup: false } }));
  await page.route('**/supervision/bootstrap', route => route.fulfill({ json: { enabled: false } }));
});

for (const width of [390, 1440]) {
  test(`Site root opens Admin Menus and Back returns to the previous page at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 850 });
    const main = page.getByRole('main');
    await page.goto('/admin/content/lists/watchlists');
    await expect(main.getByRole('button', { name: 'New Watchlist', exact: true })).toBeVisible();

    await page.goto('/');
    await expect(page).toHaveURL(/\/admin\/content\/lists\/menus$/);
    await expect(main).toHaveCount(1);
    await expect(main.getByRole('button', { name: 'New Menu', exact: true })).toBeVisible();

    await page.goBack();
    await expect(page).toHaveURL(/\/admin\/content\/lists\/watchlists$/);
    await expect(main.getByRole('button', { name: 'New Watchlist', exact: true })).toBeVisible();
  });
}
