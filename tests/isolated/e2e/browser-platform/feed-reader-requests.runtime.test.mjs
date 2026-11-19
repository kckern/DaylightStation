import { expect, test } from '@playwright/test';

test.use({ serviceWorkers: 'block' });

test.beforeEach(async ({ page }) => {
  await page.routeWebSocket('**/*', () => {});
  await page.route('**/api/**', route => {
    const path = new URL(route.request().url()).pathname;
    const json = path.endsWith('/reader/feeds') ? []
      : path.endsWith('/supervision/bootstrap') ? { enabled: false } : {};
    return route.fulfill({ json });
  });
});

function article(id, title) {
  return { id, stateKey: id, title, published: '2026-07-01T12:00:00Z', state: { isSaved: true } };
}

test('Reader aborts a previous filter page and paginates the current stream', async ({ page }) => {
  let oldPage;
  const streamReads = [];
  await page.route('**/api/v1/feed/search?**', route => {
    const params = new URL(route.request().url()).searchParams;
    if (params.get('cursor') === 'saved-next') {
      oldPage = route;
      return;
    }
    return route.fulfill({ json: { items: [article('saved', 'Saved filter article')], nextCursor: 'saved-next' } });
  });
  await page.route('**/api/v1/feed/reader/stream?**', route => {
    const cursor = new URL(route.request().url()).searchParams.get('continuation');
    streamReads.push(cursor);
    return route.fulfill({ json: cursor === 'recent-next'
      ? { items: [article('more', 'More recent articles')], exhausted: true }
      : { items: [article('recent', 'Recent filter article')], continuation: 'recent-next' } });
  });

  await page.goto('/feed/reader?view=saved');
  await expect(page.getByText('Saved filter article', { exact: true })).toBeVisible();
  await expect.poll(() => Boolean(oldPage)).toBe(true);
  const canceled = page.waitForEvent('requestfailed', request => request === oldPage.request());
  await page.getByRole('group', { name: 'Article state' }).getByRole('button', { name: 'all', exact: true }).click();
  await canceled;
  await expect(page.getByText('Recent filter article', { exact: true })).toBeVisible();
  await expect(page.getByText('More recent articles', { exact: true })).toBeVisible();
  await expect(page.getByText('Saved filter article', { exact: true })).toHaveCount(0);
  expect(streamReads).toEqual([null, 'recent-next']);
});

test('Reader retains the first page and retries a failed cursor only when asked', async ({ page }) => {
  const reads = [];
  await page.route('**/api/v1/feed/reader/stream?**', route => {
    const cursor = new URL(route.request().url()).searchParams.get('continuation');
    reads.push(cursor);
    if (reads.length === 1) return route.fulfill({
      json: { items: [article('first', 'First page article')], continuation: 'next' },
    });
    if (reads.length === 2) return route.fulfill({ status: 500, json: { error: 'Unavailable' } });
    return route.fulfill({ json: { items: [article('second', 'Second page article')], exhausted: true } });
  });

  await page.goto('/feed/reader');
  const existing = page.getByText('First page article', { exact: true });
  await expect(existing).toBeVisible();
  const failure = page.getByRole('alert').filter({ hasText: 'More articles could not be loaded.' });
  await expect(failure).toBeVisible();
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  expect(reads).toEqual([null, 'next']);
  await failure.getByRole('button', { name: 'Retry' }).click();
  await expect(existing).toBeVisible();
  await expect(page.getByText('Second page article', { exact: true })).toBeVisible();
  expect(reads).toEqual([null, 'next', 'next']);
});

test('Reader restores a saved position after its first page supplies the scrollable rows', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  const offset = 2200;
  await page.route('**/api/v1/feed/workspace', route => route.fulfill({ json: {
    preferencesStored: true, checkpoints: { reader: { scrollOffset: offset, itemId: 'retired-story' } },
  } }));
  const entered = Promise.withResolvers();
  const release = Promise.withResolvers();
  const items = Array.from({ length: 98 }, (_, i) => article(String(i), 'Reader article ' + i));
  await page.route('**/api/v1/feed/reader/stream?**', async route => {
    entered.resolve();
    await release.promise;
    return route.fulfill({ json: { items, exhausted: true } });
  });
  await page.goto('/feed/reader');
  await entered.promise;
  const inbox = page.locator('.reader-inbox');
  await expect(inbox.getByText('Loading...', { exact: true })).toBeVisible();
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  release.resolve();
  await expect.poll(() => inbox.evaluate(el => el.scrollHeight - el.clientHeight)).toBeGreaterThan(offset);
  await expect.poll(() => inbox.evaluate(el => el.scrollTop)).toBe(offset);
  expect(await page.getByRole('main', { name: 'Feed' }).evaluate(el => el.scrollTop)).toBe(0);
});

for (const query of ['view=saved', 'feeds=news']) {
  test('Reader keeps the default checkpoint independent of ' + query, async ({ page }) => {
    const checkpoint = { itemId: 'retired', scrollOffset: 2200 };
    const writes = [];
    await page.route('**/api/v1/feed/workspace', route => route.fulfill({ json: {
      preferencesStored: true, checkpoints: { reader: checkpoint },
    } }));
    await page.route('**/api/v1/feed/workspace/checkpoints/reader', route => {
      writes.push(route.request().postDataJSON());
      return route.fulfill({ json: {} });
    });
    const items = Array.from({ length: 98 }, (_, i) => article(String(i), 'Story ' + i));
    await page.route(/\/api\/v1\/feed\/(reader\/stream|search)\?/, route => route.fulfill({ json: { items, exhausted: true } }));
    await page.goto('/feed/reader?' + query);
    const inbox = page.locator('.reader-inbox');
    await expect.poll(() => inbox.evaluate(el => el.scrollHeight - el.clientHeight)).toBeGreaterThan(2200);
    expect(await inbox.evaluate(el => el.scrollTop)).toBe(0);
    await inbox.evaluate(el => { el.scrollTop = 1100; });
    await page.getByRole('link', { name: 'Headlines', exact: true }).click();
    await expect.poll(() => writes.length).toBeGreaterThanOrEqual(2);
    for (const write of writes) expect(write).toMatchObject(checkpoint);
    await page.getByRole('link', { name: 'Reader', exact: true }).click();
    await expect(page).toHaveURL(/\/feed\/reader$/);
    await expect.poll(() => inbox.evaluate(el => el.scrollTop)).toBe(2200);
  });
}

test('Reader retains an unread checkpoint on early departure and warm rows during revalidation', async ({ page }) => {
  const checkpoint = { itemId: 'retired', scrollOffset: 2200 };
  const writes = [];
  await page.route('**/api/v1/feed/workspace', route => route.fulfill({ json: {
    preferencesStored: true, checkpoints: { reader: checkpoint },
  } }));
  await page.route('**/api/v1/feed/workspace/checkpoints/reader', route => {
    writes.push(route.request().postDataJSON());
    return route.fulfill({ json: {} });
  });
  const items = Array.from({ length: 98 }, (_, i) => article(String(i), 'Story ' + i));
  let reads = 0;
  let revalidate;
  const payload = { json: { items, exhausted: true } };
  await page.route('**/api/v1/feed/reader/stream?**', route => {
    reads++;
    if (reads === 1) return;
    if (reads === 2) return route.fulfill(payload);
    revalidate = route;
  });
  await page.goto('/feed/reader');
  await expect.poll(() => reads).toBe(1);
  const headlines = page.getByRole('link', { name: 'Headlines', exact: true });
  const reader = page.getByRole('link', { name: 'Reader', exact: true });
  await headlines.click();
  await expect.poll(() => writes.length).toBeGreaterThanOrEqual(2);
  for (const write of writes) expect(write).toMatchObject(checkpoint);
  await reader.click();
  const inbox = page.locator('.reader-inbox');
  await expect.poll(() => inbox.evaluate(el => el.scrollTop)).toBe(2200);
  await inbox.evaluate(el => { el.scrollTop = 1500; });
  await headlines.click();
  await reader.click();
  await expect.poll(() => Boolean(revalidate)).toBe(true);
  await expect.poll(() => inbox.evaluate(el => el.scrollTop)).toBe(1500);
  await revalidate.fulfill(payload);
  await expect(inbox.getByRole('button', { name: 'Refresh' })).toBeEnabled();
  expect(await inbox.evaluate(el => el.scrollTop)).toBe(1500);
});
