import { expect, test } from '@playwright/test';

test.use({ serviceWorkers: 'block' });

test('Media Browse keeps focus within the results during a first-page retry', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 850 });
  await page.routeWebSocket('**/*', () => {});
  const reads = [];
  const release = Promise.withResolvers();
  await page.route('**/api/**', async route => {
    const { pathname, searchParams } = new URL(route.request().url());
    if (pathname.endsWith('/supervision/bootstrap')) return route.fulfill({ json: { enabled: false } });
    if (pathname !== '/api/v1/list/plex/fixture/expand') return route.fulfill({ json: {} });
    reads.push(searchParams.get('skip'));
    if (reads.length === 1) return route.fulfill({ status: 503, json: { error: 'Unavailable' } });
    await release.promise;
    return route.fulfill({ json: {
      items: [{ id: 'plex:accepted', title: 'Accepted title', itemType: 'item' }], total: 1,
    } });
  });

  await page.goto('/media?view=browse&path=plex%2Ffixture');
  const browse = page.getByTestId('browse-view');
  const home = browse.getByTestId('browse-crumb-home');
  try {
    await browse.getByRole('button', { name: 'Try again', exact: true }).press('Enter');
    await expect.poll(() => reads).toEqual([null, null]);
    await expect(browse).toBeFocused();
    await expect(browse).toHaveAttribute('aria-busy', 'true');
    await page.keyboard.press('Tab');
    await expect(home).toBeFocused();
  } finally {
    release.resolve();
  }
  await expect(browse.getByText('Accepted title', { exact: true })).toBeVisible();
  await expect(home).toBeFocused();
  expect(reads).toEqual([null, null]);
});

test('Media Browse keeps loaded titles and retries the failed offset once', async ({ page }) => {
  await page.setViewportSize({ width: 440, height: 720 });
  await page.routeWebSocket('**/*', () => {});
  const reads = [];
  const retry = Promise.withResolvers();
  const items = Array.from({ length: 24 }, (_, index) => ({
    id: 'plex:title-' + index,
    title: 'Fixture title ' + index,
    itemType: 'item',
  }));
  await page.route('**/api/**', async route => {
    const { pathname, searchParams } = new URL(route.request().url());
    if (pathname.endsWith('/supervision/bootstrap')) return route.fulfill({ json: { enabled: false } });
    if (pathname !== '/api/v1/list/plex/fixture/expand') return route.fulfill({ json: {} });
    const skip = searchParams.get('skip');
    reads.push(skip);
    if (!skip) return route.fulfill({ json: { items, total: 25 } });
    if (reads.length === 2) return route.fulfill({ status: 503, json: { error: 'Temporarily unavailable' } });
    await retry.promise;
    return route.fulfill({ json: { items: [{ id: 'plex:final', title: 'Final title', itemType: 'item' }], total: 25 } });
  });

  await page.goto('/media?view=browse&path=plex%2Ffixture');
  const browse = page.getByTestId('browse-view');
  const previous = browse.getByTestId('result-play-now-plex:title-23');
  await expect(previous).toBeVisible({ timeout: 8_000 });
  await previous.focus();
  await expect(browse.getByRole('alert')).toBeVisible({ timeout: 8_000 });
  await expect(previous).toBeFocused({ timeout: 4_000 });
  await expect(browse.getByTestId('result-play-now-plex:title-0')).toBeAttached();
  const retryPage = browse.getByRole('button', { name: 'Retry', exact: true });
  try {
    await retryPage.press('Enter');
    await expect.poll(() => reads).toEqual([null, '24', '24']);
    const waiting = browse.getByRole('button', { name: 'Retrying…', exact: true });
    await expect(waiting).toBeFocused();
    await expect(waiting).toBeDisabled();
    await page.keyboard.press('Enter');
  } finally {
    retry.resolve();
  }
  const finalTitle = browse.getByTestId('result-play-now-plex:final');
  await expect(finalTitle).toBeFocused();
  await expect(browse.getByRole('alert')).toHaveCount(0);
  expect(reads).toEqual([null, '24', '24']);
});
