import { expect, test } from '@playwright/test';

test.use({ serviceWorkers: 'block', hasTouch: true, viewport: { width: 390, height: 850 } });

const sessionPath = '/api/v1/feed/scroll/sessions';

test('Feed Assembly uses the shared sheet contract and keeps compact actions operable', async ({ page, baseURL }) => {
  const origin = new URL(baseURL).origin;
  await page.context().route('**/*', route => (
    new URL(route.request().url()).origin === origin ? route.fallback() : route.abort()
  ));
  await page.routeWebSocket('**/ws', () => {});
  await page.route('**/api/**', route => {
    const { pathname } = new URL(route.request().url());
    if (pathname.endsWith('/supervision/bootstrap')) return route.fulfill({ json: { enabled: false } });
    if (pathname.endsWith('/headlines/pages')) return route.fulfill({ json: [] });
    if (pathname.endsWith('/items/state/summary')) return route.fulfill({ json: { pendingSync: 0 } });
    if (pathname.endsWith('/feed/workspace')) return route.fulfill({ json: { preferencesStored: true } });
    if (pathname === sessionPath) return route.fulfill({ json: {
      items: [{ id: 'reddit:1', title: 'Assembly item', source: 'reddit', contentType: 'article' }],
      sessionId: 'assembly-session',
      hasMore: false,
      feed_assembly: {
        batchNumber: 1,
        wireDecayFactor: 1,
        tiers: { wire: { selected: 1, allocated: 1, sources: { Local: 1 } } },
      },
    } });
    return route.fulfill({ json: {} });
  });

  await page.goto('/feed/scroll?debug=1');
  const opener = page.getByRole('button', { name: 'Open Feed Assembly Debug', exact: true });
  const box = async locator => locator.evaluate(element => {
    const { width, height } = element.getBoundingClientRect();
    return { width, height };
  });
  const openerBox = await box(opener);
  expect(openerBox.width).toBeGreaterThanOrEqual(44);
  expect(openerBox.height).toBeGreaterThanOrEqual(44);

  await opener.press('Enter');
  const dialog = page.getByRole('dialog', { name: 'Feed Assembly', exact: true });
  const close = dialog.getByRole('button', { name: 'Close', exact: true });
  await expect(dialog).toBeVisible();
  await expect(close).toBeFocused();
  await expect(dialog.getByRole('button', { name: 'Copy JSON', exact: true })).toHaveCSS('min-block-size', '44px');
  await expect(close).toHaveCSS('min-block-size', '44px');

  const source = dialog.getByRole('button', { name: 'Local 1', exact: true });
  await expect(source).toHaveCSS('min-block-size', '44px');
  await source.press('Enter');
  await expect(source).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('/');
  await expect(page).toHaveURL('/feed/scroll?debug=1');
  await expect(dialog).toBeVisible();

  const clear = dialog.getByRole('button', { name: 'Clear All', exact: true });
  await expect(clear).toHaveCSS('min-block-size', '44px');
  await expect(clear).toHaveAttribute('aria-disabled', 'false');
  await clear.focus();
  await page.keyboard.press('Enter');
  await expect(clear).toHaveAttribute('aria-disabled', 'true');
  await expect(clear).toBeFocused();

  await source.focus();
  await page.keyboard.press('Tab');
  await expect(close).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(opener).toBeFocused();
});
