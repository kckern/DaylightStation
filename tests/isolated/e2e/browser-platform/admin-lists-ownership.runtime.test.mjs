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

test('Admin list rows share current capability reads and retire an obsolete alternate lookup', async ({ page }) => {
  const listPath = api + 'menus/capabilities';
  const infoPath = '/api/v1/info/';
  const alternatesPath = '/api/v1/content/alternates/';
  const items = ['retired', 'shared', 'shared', 'missing', 'lookup-failed'].map((id, index) => ({
    uid: `fixture-item-${index}`, label: `Capability row ${index + 1}`, action: index === 2 ? 'Open' : 'Display', input: `files:${id}`,
  }));
  const reads = [];
  const alternatives = [];
  const writes = [];
  const releaseRetired = Promise.withResolvers();
  await page.routeWebSocket('**/*', () => {});
  await page.route('**/api/**', async route => {
    const request = route.request();
    const path = decodeURIComponent(new URL(request.url()).pathname);
    if (path === listPath) {
      return route.fulfill({ json: { name: 'capabilities', sections: [{ items }] } });
    }
    if (request.method() === 'PUT' && path.startsWith(listPath + '/items/')) {
      const index = Number(path.split('/').at(-1));
      const changes = request.postDataJSON();
      writes.push([index, changes.input]);
      items[index] = { ...items[index], ...changes };
      return route.fulfill({ json: {} });
    }
    if (path.startsWith(infoPath)) {
      const key = path.slice(infoPath.length);
      reads.push(key);
      if (key === 'files/retired') await releaseRetired.promise;
      if (key === 'files/missing') return route.fulfill({ status: 404, json: { error: 'Missing content' } });
      const capabilities = key.startsWith('canvas/') ? ['displayable'] : ['playable'];
      return route.fulfill({ json: { title: key, capabilities } });
    }
    if (path.startsWith(alternatesPath)) {
      const key = path.slice(alternatesPath.length);
      alternatives.push(key);
      if (key === 'files/lookup-failed') return route.fulfill({ status: 503, json: { error: 'Unavailable' } });
      return route.fulfill({ json: { alternates: [
        { contentId: 'canvas:shared', capabilities: ['displayable'] },
        { contentId: 'app:shared', capabilities: ['openable'] },
      ] } });
    }
    if (path === '/api/v1/content/sources') return route.fulfill({ json: { sources: ['files', 'canvas'] } });
    return route.fulfill({ json: path.endsWith('/supervision/bootstrap') ? { enabled: false } : {} });
  });

  const row = index => page.getByTestId(`item-row-0-${index}`);
  const warning = index => row(index).getByRole('alert').filter({ hasText: /(?:Display|Open) needs/ });
  await page.goto(root + 'menus/capabilities');
  try {
    await expect.poll(() => reads.includes('files/retired')).toBe(true);
    await expect(warning(0)).toHaveCount(0);
    await row(0).locator('.col-input .content-display').click();
    const editor = row(0).getByRole('textbox', { name: 'Search content...' });
    await editor.fill('canvas:current');
    await editor.press('Enter');
    await expect.poll(() => writes).toEqual([[0, 'canvas:current']]);
    await expect.poll(() => reads.includes('canvas/current')).toBe(true);

    const oldInfo = page.waitForResponse(response => decodeURIComponent(new URL(response.url()).pathname) === infoPath + 'files/retired');
    releaseRetired.resolve();
    await (await oldInfo).finished();
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  } finally {
    releaseRetired.resolve();
  }

  await expect(warning(0)).toHaveCount(0);
  await expect(warning(3)).toHaveCount(0);
  await expect(warning(4)).toBeVisible();
  await expect(warning(4).getByRole('button', { name: /^Use / })).toHaveCount(0);
  await expect(warning(1).getByRole('button', { name: 'Use canvas:shared' })).toBeVisible();
  await expect(warning(2).getByRole('button', { name: 'Use app:shared' })).toBeVisible();
  expect.soft(alternatives.filter(key => key === 'files/shared')).toHaveLength(1);
  expect.soft(alternatives).not.toContain('files/retired');
  expect(alternatives).not.toContain('files/missing');
  expect(alternatives.filter(key => key === 'files/lookup-failed')).toHaveLength(1);

  await warning(1).getByRole('button', { name: 'Use canvas:shared' }).click();
  await expect.poll(() => writes).toEqual([[0, 'canvas:current'], [1, 'canvas:shared']]);
  await expect(warning(1)).toHaveCount(0);
  await expect(warning(2).getByRole('button', { name: 'Use app:shared' })).toBeVisible();
});
