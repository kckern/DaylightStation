import { expect, test } from '@playwright/test';

test.use({ serviceWorkers: 'block' });

test('Feed links to the first configured edition and keeps a usable default when the pages read fails', async ({ page }) => {
  let available = true;
  await page.routeWebSocket('**/*', () => {});
  await page.route('**/api/**', route => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/headlines/pages')) {
      return available
        ? route.fulfill({ json: [{ id: 'local', label: 'Local news' }, { id: 'world', label: 'World' }] })
        : route.fulfill({ status: 404, json: { error: 'unavailable' } });
    }
    return route.fulfill({ json: path.endsWith('/supervision/bootstrap') ? { enabled: false } : {} });
  });
  await page.goto('/feed/search');
  const headlines = page.getByRole('link', { name: 'Headlines' });
  await expect(headlines).toHaveAttribute('href', '/feed/headlines/local');
  await headlines.click();
  await page.getByLabel('Headline edition').selectOption('world');
  await expect(page).toHaveURL(/\/feed\/headlines\/world$/);

  available = false;
  const failed = page.waitForResponse(response => response.url().includes('/headlines/pages') && response.status() === 404);
  await page.goto('/feed/search');
  await failed;
  await expect(headlines).toHaveAttribute('href', '/feed/headlines/mainstream');
  await expect(page.getByRole('main', { name: 'Feed' })).toBeVisible();
});
