import { expect, test } from '@playwright/test';

test.use({ serviceWorkers: 'block', viewport: { width: 390, height: 850 } });

test('Feed retains a reading preference chosen during workspace startup', async ({ page }) => {
  test.setTimeout(20_000);
  let startup;
  let reads = 0;
  const patches = [];
  let preferences = { theme: 'dark', density: 'compact' };
  await page.routeWebSocket('**/*', () => {});
  await page.route('**/api/**', route => {
    const request = route.request();
    const { pathname } = new URL(request.url());
    if (pathname.endsWith('/supervision/bootstrap')) return route.fulfill({ json: { enabled: false } });
    if (pathname === '/api/v1/feed/workspace') {
      if (++reads === 1) {
        startup = route;
        return;
      }
      return route.fulfill({ json: { preferencesStored: true, preferences } });
    }
    if (pathname === '/api/v1/feed/workspace/preferences' && request.method() === 'PATCH') {
      const patch = request.postDataJSON();
      patches.push(patch);
      preferences = { ...preferences, ...patch };
      return route.fulfill({ json: { preferences } });
    }
    return route.fulfill({ json: {} });
  });

  await page.goto('/feed/search');
  await expect.poll(() => Boolean(startup)).toBe(true);
  await page.getByLabel('Reading appearance').click();
  const theme = page.getByRole('combobox', { name: 'Theme', exact: true });
  const frame = page.locator('.feed-app');
  await theme.selectOption('sepia');
  await expect(theme).toHaveValue('sepia');
  expect(patches).toEqual([]);
  await startup.fulfill({ json: { preferencesStored: true, preferences: { theme: 'dark', density: 'compact' } } });
  await expect.poll(() => patches).toEqual([{ theme: 'sepia' }]);
  await expect(theme).toHaveValue('sepia');
  await expect(frame).toHaveAttribute('data-density', 'compact');
  await expect.poll(() => page.evaluate(() => ({
    theme: JSON.parse(localStorage.getItem('feed:reading-preferences')).theme,
    density: localStorage.getItem('feed:density'),
  }))).toEqual({ theme: 'sepia', density: 'compact' });

  await page.reload();
  await expect.poll(() => reads).toBe(2);
  await page.getByLabel('Reading appearance').click();
  await expect(theme).toHaveValue('sepia');
  await expect(frame).toHaveAttribute('data-density', 'compact');
  expect(patches).toEqual([{ theme: 'sepia' }]);
});

test('Feed keeps the end of Reading appearance reachable in a short landscape viewport', async ({ page }) => {
  await page.setViewportSize({ width: 740, height: 360 });
  await page.routeWebSocket('**/*', () => {});
  await page.route('**/api/**', route => route.fulfill({ json: new URL(route.request().url()).pathname.endsWith('/supervision/bootstrap')
    ? { enabled: false }
    : {} }));
  await page.goto('/feed/search');

  await page.getByLabel('Reading appearance').click();
  const panel = page.locator('.feed-reading-settings__panel');
  await expect.poll(() => panel.evaluate(element => element.getBoundingClientRect().bottom <= window.innerHeight)).toBe(true);
  const session = page.getByRole('combobox', { name: 'Scroll session' });
  const exportButton = page.getByRole('button', { name: 'Export', exact: true });
  const importButton = page.getByRole('button', { name: 'Import', exact: true });
  await session.focus();
  await session.press('Tab');
  await expect(exportButton).toBeFocused();
  await exportButton.press('Tab');
  await expect(importButton).toBeFocused();
  await expect(importButton).toBeInViewport({ ratio: 1 });
  await importButton.click({ trial: true });
  expect(await panel.evaluate(element => element.scrollTop)).toBeGreaterThan(0);
  expect(await page.locator('main').evaluate(element => element.scrollTop)).toBe(0);
});

test('Feed resets two source preferences independently when the first save fails', async ({ page }) => {
  const entered = Promise.withResolvers();
  const release = Promise.withResolvers();
  const puts = [];
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const sources = { alpha: 'more', beta: 'less' };
  await page.routeWebSocket('**/*', () => {});
  await page.route('**/api/**', async route => {
    const { pathname } = new URL(route.request().url());
    if (pathname.endsWith('/supervision/bootstrap')) return route.fulfill({ json: { enabled: false } });
    if (pathname.endsWith('/feed/workspace')) return route.fulfill({ json: { preferencesStored: true, sourcePreferences: sources } });
    if (pathname.includes('/workspace/sources/')) {
      const key = pathname.split('/').at(-1);
      puts.push([key, route.request().postDataJSON().level]);
      if (key === 'alpha') {
        entered.resolve();
        await release.promise;
        return route.fulfill({ status: 400, json: { error: 'Source preference refused' } });
      }
      delete sources[key];
      return route.fulfill({ json: { sourcePreferences: sources } });
    }
    return route.fulfill({ json: {} });
  });
  await page.goto('/feed/search');
  await page.getByLabel('Reading appearance').click();
  const row = text => page.locator('.feed-source-preferences > div').filter({ hasText: text });
  await row('alpha · more').getByRole('button', { name: 'Reset' }).click();
  await entered.promise;
  await row('beta · less').getByRole('button', { name: 'Reset' }).click();
  await expect(row('beta · less')).toHaveCount(0);
  release.resolve();
  await expect(row('alpha · more')).toBeVisible();
  await expect.poll(() => puts).toEqual([['alpha', 'normal'], ['beta', 'normal']]);
  await expect(row('beta · less')).toHaveCount(0);
  expect(errors).toEqual([]);
  await page.reload();
  await page.getByLabel('Reading appearance').click();
  await expect(row('alpha · more')).toBeVisible();
  await expect(row('beta · less')).toHaveCount(0);
});
