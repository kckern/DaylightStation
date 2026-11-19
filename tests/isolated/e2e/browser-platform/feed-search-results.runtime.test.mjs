import { expect, test } from '@playwright/test';

test.use({ serviceWorkers: 'block', viewport: { width: 390, height: 850 } });

test('Feed Search retires the old query and cursor during a failed replacement', async ({ page }) => {
  const replacement = Promise.withResolvers();
  const queries = [];
  const item = (id, title) => ({ id, stateKey: id, title });
  await page.routeWebSocket('**/*', () => {});
  await page.route('**/api/**', async route => {
    const { pathname, searchParams } = new URL(route.request().url());
    if (pathname.endsWith('/supervision/bootstrap')) return route.fulfill({ json: { enabled: false } });
    if (pathname !== '/api/v1/feed/search') return route.fulfill({ json: {} });
    const query = searchParams.get('q');
    const cursor = searchParams.get('cursor');
    queries.push([query, cursor]);
    if (query === 'birds') return route.fulfill({ json: { items: [item('bird', 'Bird match')], total: 2, nextCursor: 'bird-next' } });
    if (queries.length === 2) {
      await replacement.promise;
      return route.fulfill({ status: 500, json: { error: 'Unavailable' } });
    }
    return route.fulfill({ json: { items: [item('fish', 'Fish match')], total: 1 } });
  });

  await page.goto('/feed/search?q=birds');
  await expect(page.getByRole('heading', { name: 'Bird match' })).toBeVisible();
  const more = page.getByRole('button', { name: /Load more/ });
  await expect(more).toBeEnabled();
  const search = page.getByRole('textbox', { name: 'Search feed history' });
  await search.fill('fish');
  await search.press('Enter');

  try {
    await expect(page.getByRole('status').filter({ hasText: 'Searching…' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Bird match' })).toHaveCount(0);
    await expect(more).toHaveCount(0);
  } finally {
    replacement.resolve();
  }
  const error = page.getByRole('alert').filter({ hasText: 'Search could not be completed.' });
  await expect(error).toBeVisible();
  await expect(more).toHaveCount(0);
  await error.getByRole('button', { name: 'Retry' }).click();
  await expect(page.getByRole('heading', { name: 'Fish match' })).toBeVisible();
  expect(queries).toEqual([['birds', null], ['fish', null], ['fish', null]]);
});
