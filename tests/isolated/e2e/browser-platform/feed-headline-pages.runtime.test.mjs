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

test('Feed entry redirects replace their history entries and share the main region across destinations', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 850 });
  await page.addInitScript(() => { window.fixtureHistoryLength = history.length; });
  await page.routeWebSocket('**/*', () => {});
  await page.route('**/api/**', route => {
    const { pathname } = new URL(route.request().url());
    if (pathname.endsWith('/supervision/bootstrap')) return route.fulfill({ json: { enabled: false } });
    if (pathname.endsWith('/headlines/pages')) return route.fulfill({ json: [{ id: 'mainstream', label: 'Mainstream' }] });
    if (pathname.endsWith('/scroll/sessions')) return route.fulfill({ json: { items: [], hasMore: false } });
    return route.fulfill({ json: {} });
  });

  const modes = page.getByRole('navigation', { name: 'Feed modes' });
  const scroll = modes.getByRole('link', { name: 'Scroll', exact: true });
  const headlines = modes.getByRole('link', { name: 'Headlines', exact: true });
  const main = page.getByRole('main', { name: 'Feed' });

  await page.goto('/feed');
  await expect(page).toHaveURL(/\/feed\/scroll$/);
  await expect(scroll).toHaveAttribute('aria-current', 'page');
  expect(await page.evaluate(() => history.length - window.fixtureHistoryLength)).toBe(0);

  const originalMain = await main.elementHandle();
  await headlines.click();
  await expect(page).toHaveURL(/\/feed\/headlines\/mainstream$/);
  await expect(headlines).toHaveAttribute('aria-current', 'page');
  await expect(page.getByRole('button', { name: 'Refresh all', exact: true })).toBeVisible();
  await page.setViewportSize({ width: 1440, height: 850 });
  expect(await main.evaluate((node, original) => node === original, originalMain)).toBe(true);
  await expect(page.getByRole('main')).toHaveCount(1);

  await page.goBack({ waitUntil: 'commit' });
  await expect(page).toHaveURL(/\/feed\/scroll$/);
  await expect(scroll).toHaveAttribute('aria-current', 'page');
  expect(await main.evaluate((node, original) => node === original, originalMain)).toBe(true);
  await originalMain.dispose();

  await page.goto('/feed/headlines', { waitUntil: 'domcontentloaded' });
  await expect(page).toHaveURL(/\/feed\/headlines\/mainstream$/);
  await expect(headlines).toHaveAttribute('aria-current', 'page');
  expect(await page.evaluate(() => history.length - window.fixtureHistoryLength)).toBe(0);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(headlines).toHaveAttribute('aria-current', 'page');
  await expect(main).toBeVisible();
});

for (const refresh of [
  { button: 'Refresh all', endpoint: '/headlines/harvest' },
  { button: 'Refresh Local source', endpoint: '/headlines/harvest/daily' },
  { button: 'Refresh all', endpoint: '/headlines/harvest', rejected: true },
]) {
  const title = refresh.rejected
    ? 'Feed reports a failed harvest after returning to the submitted edition'
    : `Feed ${refresh.button} completion stays with the submitted headline edition`;
  test(title, async ({ page }) => {
    const harvestStarted = Promise.withResolvers();
    const releaseHarvest = Promise.withResolvers();
    const reads = [];
    let harvests = 0;
    let harvested = false;
    await page.routeWebSocket('**/*', () => {});
    await page.route('**/api/**', async route => {
      const { pathname, searchParams } = new URL(route.request().url());
      if (pathname.endsWith('/headlines/pages')) {
        return route.fulfill({ json: [{ id: 'local', label: 'Local news' }, { id: 'world', label: 'World' }] });
      }
      if (pathname.endsWith(refresh.endpoint)) {
        harvests += 1;
        harvestStarted.resolve();
        await releaseHarvest.promise;
        if (refresh.rejected) return route.fulfill({ status: 500, json: { message: 'Harvest unavailable' } });
        harvested = true;
        return route.fulfill({ json: {} });
      }
      if (pathname.endsWith('/headlines') && searchParams.has('page')) {
        const edition = searchParams.get('page');
        reads.push(edition);
        const local = edition === 'local';
        const title = local ? (harvested ? 'Updated local headline' : 'Local headline') : 'World headline';
        return route.fulfill({ json: {
          grid: { rows: ['main'], cols: ['main'] },
          sources: { daily: {
            label: local ? 'Local source' : 'World source',
            row: 0,
            col: 0,
            url: 'https://example.test/feed',
            items: [{ id: edition, title, link: `https://example.test/${edition}` }],
          } },
        } });
      }
      return route.fulfill({ json: pathname.endsWith('/supervision/bootstrap') ? { enabled: false } : {} });
    });

    await page.goto('/feed/headlines/local');
    await expect(page.getByRole('link', { name: 'Local headline', exact: true })).toBeVisible();
    await page.getByRole('button', { name: refresh.button, exact: true }).click();
    await harvestStarted.promise;
    const edition = page.getByLabel('Headline edition');
    await edition.selectOption('world');
    await expect(page.getByRole('link', { name: 'World headline' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Refresh all', exact: true })).toBeEnabled();

    if (refresh.rejected) {
      await edition.selectOption('local');
      await expect(page.getByRole('button', { name: 'Refreshing…' })).toBeDisabled();
      await expect.poll(() => reads.slice()).toEqual(['local', 'world', 'local']);
      releaseHarvest.resolve();
      const alert = page.getByRole('alert').filter({ hasText: 'Sources could not be refreshed' });
      await expect(alert).toBeVisible();
      expect(reads).toEqual(['local', 'world', 'local']);
      await alert.getByRole('button', { name: 'Retry' }).click();
      await expect(alert).toBeHidden();
      await expect(page.getByRole('button', { name: 'Refresh all', exact: true })).toBeEnabled();
      expect(reads).toEqual(['local', 'world', 'local', 'local']);
      expect(harvests).toBe(1);
      return;
    }

    const result = page.waitForResponse(response => new URL(response.url()).pathname.endsWith(refresh.endpoint));
    releaseHarvest.resolve();
    await (await result).finished();
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    expect(reads).toEqual(['local', 'world']);
    await expect(page.getByRole('link', { name: 'World headline' })).toBeVisible();

    await edition.selectOption('local');
    await expect(page.getByRole('link', { name: 'Updated local headline' })).toBeVisible();
    expect(reads).toEqual(['local', 'world', 'local']);
  });
}
