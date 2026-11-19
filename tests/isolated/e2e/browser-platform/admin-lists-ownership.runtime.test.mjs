import { expect, test } from '@playwright/test';

test.use({ serviceWorkers: 'block' });

const root = '/admin/content/lists/';
const api = '/api/v1' + root;
const lists = (...names) => ({ lists: names.map(name => ({ name, active: true })) });

for (const width of [390, 1280]) {
  test('keeps Watchlists active after a delayed Menus response and retries a committed create with one read at ' + width + 'px', async ({ page }) => {
    await page.setViewportSize({ width, height: 850 });
    let pendingMenus;
    const calls = [];
    await page.routeWebSocket('**/*', () => {});
    await page.route('**/api/**', route => {
      const request = route.request();
      const path = new URL(request.url()).pathname;
      if (path === api + 'menus') {
        pendingMenus = route;
        return;
      }
      if (path === api + 'watchlists') {
        calls.push(request.method());
        if (request.method() === 'POST') return route.fulfill({ json: { list: request.postDataJSON().name } });
        if (calls.length === 3) return route.fulfill({ status: 503, json: { error: 'Watchlists unavailable' } });
        return route.fulfill({ json: calls.length === 1 ? lists('todays-picks') : lists('new-watchlist', 'todays-picks') });
      }
      return route.fulfill({ json: path.endsWith('/supervision/bootstrap') ? { enabled: false } : {} });
    });

    await page.goto(root + 'menus');
    await expect.poll(() => Boolean(pendingMenus)).toBe(true);
    await page.evaluate(path => {
      history.pushState({ idx: (history.state?.idx ?? 0) + 1, key: 'watchlists', usr: null }, '', path);
      dispatchEvent(new PopStateEvent('popstate', { state: history.state }));
    }, root + 'watchlists');
    const current = page.getByRole('link', { name: /Todays Picks/ });
    await expect(current).toBeVisible();
    const completed = page.waitForResponse(response => response.request() === pendingMenus.request());
    await pendingMenus.fulfill({ json: lists('previous-menu') });
    await (await completed).finished();
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await expect(current).toHaveAttribute('href', root + 'watchlists/todays-picks');
    await expect(page.getByTestId('list-card-previous-menu')).toHaveCount(0);

    await page.getByRole('button', { name: 'New Watchlist' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Watchlist Name').fill('new-watchlist');
    await dialog.getByRole('button', { name: 'Create' }).click();
    await expect(dialog).toHaveCount(0);
    const error = page.getByRole('alert').filter({ hasText: 'Watchlists failed to load' });
    await expect(error).toBeVisible();
    await error.getByRole('button', { name: 'Retry' }).click();
    await expect(page.getByRole('link', { name: /New Watchlist/ })).toHaveAttribute('href', root + 'watchlists/new-watchlist');
    expect(calls).toEqual(['GET', 'POST', 'GET', 'GET']);
  });
}
