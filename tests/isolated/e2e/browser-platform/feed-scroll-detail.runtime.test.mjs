import { test, expect } from '@playwright/test';

test.use({ serviceWorkers: 'block', viewport: { width: 390, height: 850 } });

const article = {
  id: 'reddit:fixture-detail',
  title: 'Feed detail ownership fixture',
  source: 'reddit',
  tier: 'wire',
  contentType: 'article',
  link: '/fixture-publisher',
  meta: { sourceName: 'Fixture' },
  state: { isRead: false },
};
const articleBody = 'The held request supplied this readable article.';
const sections = [{ type: 'article', data: { html: `<p>${articleBody}</p>` } }];
const detailPath = id => `/api/v1/feed/detail/${encodeURIComponent(id)}`;
const historyPath = id => `/api/v1/feed/items/${Buffer.from(id).toString('base64url')}`;
const scrollPath = id => `/feed/scroll/${Buffer.from(id).toString('base64url')}`;

test.beforeEach(async ({ page }) => {
  await page.routeWebSocket('**/ws', () => {});
  await page.route('**/api/**', route => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/supervision/bootstrap')) return route.fulfill({ json: { enabled: false } });
    if (path.endsWith('/headlines/pages')) return route.fulfill({ json: [] });
    if (path.endsWith('/feed/workspace')) return route.fulfill({ json: { preferencesStored: true } });
    if (path.endsWith('/scroll/sessions')) return route.fulfill({
      json: { items: [article], sessionId: 'detail-fixture', hasMore: false },
    });
    return route.fulfill({ json: {} });
  });
  await page.route('**/fixture-publisher', route => route.fulfill({ body: 'Original publisher fallback' }));
});

for (const cold of [false, true]) {
  test(`Feed keeps the ${cold ? 'cold history' : 'in-batch'} detail GET across a layout switch`, async ({ page }) => {
    const id = cold ? 'reddit:outside-batch' : article.id;
    const path = cold ? historyPath(id) : detailPath(id);
    const requests = [];
    const failures = [];
    const readWrites = [];
    let release;
    const held = new Promise(resolve => { release = resolve; });
    page.on('requestfailed', request => {
      if (new URL(request.url()).pathname === path) failures.push(request.failure().errorText);
    });
    page.on('request', request => {
      if (request.method() === 'PATCH' && new URL(request.url()).pathname === '/api/v1/feed/items/state') {
        readWrites.push(request.postDataJSON());
      }
    });
    await page.route(url => url.pathname === path, async route => {
      requests.push(route.request().method());
      await held;
      await route.fulfill({ json: cold ? { item: { ...article, id }, sections } : { sections } });
    });
    try {
      if (cold) {
        await page.setViewportSize({ width: 1440, height: 850 });
        await page.goto(scrollPath(id));
      } else {
        await page.goto('/feed/scroll');
        await page.getByRole('button', { name: `Open: ${article.title}` }).click();
      }
      await expect.poll(() => requests).toEqual(['GET']);
      await page.setViewportSize({ width: cold ? 390 : 1440, height: 850 });
      if (cold) await expect(page.locator('.scroll-view')).toHaveCSS('display', 'none');
      else await expect(page.getByRole('dialog')).toBeVisible();
      release();

      await expect(page.getByText(articleBody, { exact: true })).toBeVisible();
      await expect(page.getByRole('link', { name: 'Open in browser' })).toHaveAttribute('href', article.link);
      expect(new URL(page.url()).pathname).toBe(scrollPath(id));
      expect(requests).toEqual(['GET']);
      expect(failures).toEqual([]);
      const expectedReadWrites = cold ? [] : [{ itemIds: [id], action: 'read' }];
      expect(readWrites).toEqual(expectedReadWrites);
    } finally {
      release();
    }
  });
}

test('Feed retries the current detail after changing items and keeps its original link', async ({ page }) => {
  const second = {
    ...article,
    id: 'reddit:current-detail',
    title: 'Current Feed item',
    link: '/other-publisher',
    meta: { paywall: true, paywallProxy: '/fixture-archive?url=' },
  };
  await page.route('**/scroll/sessions', route => route.fulfill({
    json: { items: [article, second], sessionId: 'two-articles', hasMore: false },
  }));
  await page.route('**/fixture-archive?**', route => route.fulfill({ body: 'Archived publisher article' }));
  let release;
  const departed = new Promise(resolve => { release = resolve; });
  let started = false;
  await page.route(url => url.pathname === detailPath(article.id), async route => {
    started = true;
    await departed;
    await route.fulfill({ json: { sections } });
  });
  let reads = 0;
  const secondBody = 'The reader view for the second article recovered.';
  await page.route(url => url.pathname === detailPath(second.id), route => {
    if (++reads === 1) return route.fulfill({ status: 404, json: { error: 'Unavailable' } });
    return route.fulfill({ json: { sections: [{ type: 'article', data: { html: `<p>${secondBody}</p>` } }] } });
  });
  try {
    await page.goto('/feed/scroll');
    await page.getByRole('button', { name: `Open: ${article.title}` }).click();
    await expect.poll(() => started).toBe(true);
    const retired = page.waitForEvent('requestfailed', request =>
      new URL(request.url()).pathname === detailPath(article.id));
    await page.getByRole('button', { name: 'Next', exact: true }).first().click();
    await retired;
    await expect(page).toHaveURL(scrollPath(second.id));
    const original = page.getByRole('link', { name: 'Open via archive' });
    await expect(original).toHaveAttribute('href', second.meta.paywallProxy + second.link);
    await page.getByRole('button', { name: 'Try reader view again' }).click();
    release();
    await expect(page.getByText(secondBody, { exact: true })).toBeVisible();
    await expect(page.getByText(articleBody, { exact: true })).toHaveCount(0);
    await expect(original).toHaveAttribute('href', second.meta.paywallProxy + second.link);
    expect(reads).toBe(2);
  } finally {
    release();
  }
});

test('Feed keeps an invalid link error after the previous item’s offline lookup rejects', async ({ page }) => {
  const id = 'reddit:offline-missing';
  await page.addInitScript(() => {
    const open = indexedDB.open.bind(indexedDB);
    IDBFactory.prototype.open = (name, ...args) => {
      if (name !== 'daylight-feed-offline-v1') return open(name, ...args);
      const request = { error: new Error('Storage denied by fixture') };
      window.rejectDepartedEdition = () => request.onerror();
      return request;
    };
  });
  await page.route(url => url.pathname === historyPath(id), route => route.fulfill({ status: 404, json: { error: 'Unavailable' } }));
  await page.goto(scrollPath(id));
  await page.waitForFunction(() => typeof window.rejectDepartedEdition === 'function');
  await page.evaluate(() => {
    history.replaceState(history.state, '', '/feed/scroll/!');
    dispatchEvent(new PopStateEvent('popstate', { state: history.state }));
  });
  const alert = page.locator('.scroll-detail-error');
  const invalidLink = 'This Feed link is invalid. Return to Scroll and choose an item again.';
  await expect(alert).toContainText(invalidLink);
  await page.evaluate(async () => {
    window.rejectDepartedEdition();
    await new Promise(resolve => setTimeout(resolve, 0));
  });
  await expect(alert).toContainText(invalidLink);
});

test('Feed desktop detail contains Tab and returns focus to the opening card after navigation', async ({ page }) => {
  const first = { ...article, id: 'reddit:previous-detail', title: 'Previous Feed item' };
  const third = { ...article, id: 'reddit:next-detail', title: 'Next Feed item' };
  await page.setViewportSize({ width: 1440, height: 850 });
  await page.route('**/scroll/sessions', route => route.fulfill({
    json: { items: [first, article, third], sessionId: 'three-articles', hasMore: false },
  }));
  await page.route('**/feed/detail/*', route => route.fulfill({ json: { sections } }));
  await page.goto('/feed/scroll');

  const opener = page.getByRole('button', { name: `Open: ${article.title}` });
  await opener.focus();
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog', { name: article.title });
  await expect(dialog).toBeVisible();
  await expect.poll(() => dialog.evaluate(element => element.contains(document.activeElement))).toBe(true);

  await page.keyboard.press('Shift+Tab');
  expect(await dialog.evaluate(element => element.contains(document.activeElement))).toBe(true);
  const next = dialog.getByRole('button', { name: 'Next item' });
  await expect(next).toBeFocused();
  await page.keyboard.press('Tab');
  const back = dialog.getByRole('button', { name: 'Back to feed' }).first();
  await expect(back).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(next).toBeFocused();

  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(scrollPath(third.id));
  const lastDialog = page.getByRole('dialog', { name: third.title });
  await expect.poll(() => lastDialog.evaluate(element => element.contains(document.activeElement))).toBe(true);
  const previous = lastDialog.getByRole('button', { name: 'Previous item' });
  await previous.focus();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(scrollPath(article.id));
  await expect(dialog.getByRole('button', { name: 'Previous item' })).toBeFocused();

  await dialog.getByRole('button', { name: 'Download', exact: true }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'Available offline' })).toBeVisible();

  await page.keyboard.press('Escape');
  await expect(page).toHaveURL('/feed/scroll');
  await expect(dialog).toHaveCount(0);
  await expect(opener).toBeFocused();

  await page.keyboard.press('Enter');
  await expect(dialog).toBeVisible();
  await page.mouse.click(10, 10);
  await expect(page).toHaveURL('/feed/scroll');
  await expect(opener).toBeFocused();
});
