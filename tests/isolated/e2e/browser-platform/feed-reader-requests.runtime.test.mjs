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
