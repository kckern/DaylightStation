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

test('Admin saves a raw alias during an outage and validates again when its picker reopens', async ({ page }) => {
  const listPath = api + 'menus/source-fixture';
  const aliasesPath = '/api/v1/content/aliases';
  let input = 'plex:123';
  let pendingAliases;
  let aliasReads = 0;
  const updates = [];

  await page.routeWebSocket('**/*', () => {});
  await page.route('**/api/**', route => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path === listPath) return route.fulfill({
      json: { name: 'source-fixture', sections: [{ items: [{ uid: 'source-fixture', label: 'Catalog source', action: 'Play', input }] }] },
    });
    if (path === listPath + '/items/0' && request.method() === 'PUT') {
      input = request.postDataJSON().input;
      updates.push(input);
      return route.fulfill({ json: {} });
    }
    if (path === '/api/v1/content/sources') return route.fulfill({ json: { sources: ['plex'] } });
    if (path === aliasesPath) {
      aliasReads += 1;
      if (aliasReads === 1) {
        pendingAliases = route;
        return;
      }
      return route.fulfill({ json: { userDefined: ['family-alias'] } });
    }
    return route.fulfill({ json: path.endsWith('/supervision/bootstrap') ? { enabled: false } : {} });
  });

  await page.goto(root + 'menus/source-fixture');
  await expect.poll(() => Boolean(pendingAliases)).toBe(true);
  const row = page.getByTestId('item-row-0-0');
  const card = row.locator('.col-input .content-display');
  const editor = row.getByRole('textbox', { name: 'Search content...' });
  await card.click();
  await expect(editor).toBeFocused();
  let aliasResponse = page.waitForResponse(response => response.request() === pendingAliases.request());
  await pendingAliases.fulfill({ status: 503, json: { error: 'Service unavailable' } });
  await (await aliasResponse).finished();
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await editor.fill('family-alias:7');
  await editor.press('Enter');
  await expect(page.getByText('Saved as raw id', { exact: true })).toBeVisible();
  await expect.poll(() => updates).toEqual(['family-alias:7']);
  await expect(card).toContainText(/family-alias:\s*7/i);

  aliasResponse = page.waitForResponse(response => new URL(response.url()).pathname === aliasesPath);
  await card.click();
  await (await aliasResponse).finished();
  await expect(editor).toBeFocused();
  await editor.fill('invented:8');
  await editor.press('Enter');
  await expect(page.getByText('Unknown source “invented”', { exact: true })).toBeVisible();
  await expect.poll(() => updates).toEqual(['family-alias:7', 'invented:8']);
  expect(aliasReads).toBe(2);
});
