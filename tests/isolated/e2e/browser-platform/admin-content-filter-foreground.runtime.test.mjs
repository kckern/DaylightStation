import { expect, test } from '@playwright/test';

test.use({ serviceWorkers: 'block' });

test('Admin Content Filter keeps its recovery region through a failed first read', async ({ page, baseURL }) => {
  const origin = new URL(baseURL).origin;
  const library = '/api/v1/content-filter/library';
  let reads = 0;
  let heldRetry;
  await page.context().route('**/*', route => (
    new URL(route.request().url()).origin === origin ? route.fallback() : route.abort()
  ));
  await page.routeWebSocket('**/*', () => {});
  await page.route('**/api/**', route => {
    const { pathname } = new URL(route.request().url());
    if (pathname === library) {
      reads += 1;
      if (reads === 1) return route.fulfill({ status: 403, json: { error: 'Library unavailable' } });
      if (reads === 2) { heldRetry = route; return; }
      return route.fulfill({ json: { films: [{ ratingKey: '77', title: 'Recovered film', stage: 'parent', job: null }] } });
    }
    return route.fulfill({ json: pathname.endsWith('/supervision/bootstrap') ? { enabled: false } : {} });
  });

  await page.setViewportSize({ width: 390, height: 850 });
  await page.goto('/admin/content/filter');
  const region = page.getByRole('region', { name: 'Content filter library', exact: true });
  const search = page.getByRole('textbox', { name: 'Search titles' });
  await expect(region).toBeVisible();
  await expect(search).toBeVisible();
  await expect(page.getByText(/\d+ of \d+ films/)).toHaveCount(0);
  const retry = page.getByRole('alert').getByRole('button', { name: 'Retry', exact: true });
  await retry.focus();
  await page.keyboard.press('Enter');
  await expect.poll(() => Boolean(heldRetry)).toBe(true);

  await expect(region).toBeFocused();
  await expect(region.getByTestId('content-filter-library-loading')).toBeVisible();
  await expect(region.getByRole('button', { name: 'Retry', exact: true })).toHaveCount(0);
  await expect(search).toBeVisible();
  await expect(page.getByText(/\d+ of \d+ films/)).toHaveCount(0);
  await heldRetry.fulfill({ json: { films: [{ ratingKey: '77', title: 'Recovered film', stage: 'parent', job: null }] } });

  await expect(region.getByRole('link', { name: /Recovered film/ })).toBeVisible();
  await expect(region).toBeFocused();
  await expect(page.getByText('1 of 1 films')).toBeVisible();
  expect(reads).toBe(2);
});

test('Admin Content Filter retains search and focus through a failed foreground refresh', async ({ page, baseURL }) => {
  const origin = new URL(baseURL).origin;
  const library = '/api/v1/content-filter/library';
  const calls = [];
  let heldRetry;
  const films = { films: [{ ratingKey: '77', title: 'Quiet fixture', stage: 'rough', job: null }] };
  await page.context().route('**/*', route => (
    new URL(route.request().url()).origin === origin ? route.fallback() : route.abort()
  ));
  await page.addInitScript(() => {
    window.filterVisibility = 'visible';
    Object.defineProperty(document, 'visibilityState', { get: () => window.filterVisibility });
  });
  await page.clock.install();
  await page.routeWebSocket('**/*', () => {});
  await page.route('**/api/**', route => {
    const request = route.request();
    const { pathname, search } = new URL(request.url());
    if (pathname === library) {
      // The page opens on the active view; a search reads the whole list, which then refreshes.
      if (search === '?view=active') return route.fulfill({ json: { films: [], meta: { total: 1, deferred: { rough: 1, unmatched: 0 } } } });
      calls.push(request.method());
      if (calls.length === 1) return route.fulfill({ json: films });
      if (calls.length === 2) return route.fulfill({ status: 403, json: { error: 'Library unavailable' } });
      if (calls.length === 3) { heldRetry = route; return; }
      return route.fulfill({ json: films });
    }
    return route.fulfill({ json: pathname.endsWith('/supervision/bootstrap') ? { enabled: false } : {} });
  });
  const showDocument = visibility => page.evaluate(visibility => {
    window.filterVisibility = visibility;
    document.dispatchEvent(new Event('visibilitychange'));
  }, visibility);

  await page.setViewportSize({ width: 390, height: 850 });
  await page.goto('/admin/content/filter');
  const search = page.getByRole('textbox', { name: 'Search titles' });
  await search.fill('Quiet');
  await expect(page.getByRole('link', { name: /Quiet fixture/ }).first()).toBeVisible();

  await showDocument('hidden');
  await showDocument('visible');
  await expect.poll(() => calls.length).toBe(2);

  await expect(search).toBeVisible();
  await expect(search).toHaveValue('Quiet');
  await expect(search).toBeFocused();
  const error = page.getByRole('alert');
  await expect(error).toBeVisible();
  const retry = error.getByRole('button', { name: 'Retry', exact: true });
  await retry.focus();
  await page.keyboard.press('Enter');
  await expect.poll(() => Boolean(heldRetry)).toBe(true);

  const region = page.getByRole('region', { name: 'Content filter library', exact: true });
  await expect(region).toBeFocused();
  await expect(search).toHaveValue('Quiet');
  await heldRetry.fulfill({ json: films });
  await expect(search).toBeVisible();
  await expect(search).toHaveValue('Quiet');
  await expect(region).toBeFocused();
  await expect(page.getByRole('link', { name: /Quiet fixture/ }).first()).toBeVisible();
  expect(calls).toEqual(['GET', 'GET', 'GET']);
});

test('Admin Content Filter discovers a remotely queued job on foreground return and polls only while active', async ({ page, baseURL }) => {
  const origin = new URL(baseURL).origin;
  const library = '/api/v1/content-filter/library';
  const calls = [];
  let job = null;
  await page.context().route('**/*', route => (
    new URL(route.request().url()).origin === origin ? route.fallback() : route.abort()
  ));
  await page.addInitScript(() => {
    window.filterVisibility = 'visible';
    Object.defineProperty(document, 'visibilityState', { get: () => window.filterVisibility });
  });
  await page.clock.install();
  await page.routeWebSocket('**/*', () => {});
  await page.route('**/api/**', route => {
    const request = route.request();
    const { pathname } = new URL(request.url());
    if (pathname.startsWith('/api/v1/content-filter')) calls.push([request.method(), pathname]);
    // As the server reports it: an open run makes the film's stage `running` (filmStage.mjs).
    const open = job && (job.status === 'queued' || job.status === 'running');
    if (pathname === library) return route.fulfill({ json: { films: [{
      ratingKey: '77', title: 'Foreground fixture', stage: open ? 'running' : 'parent', job,
    }] } });
    return route.fulfill({ json: pathname.endsWith('/supervision/bootstrap') ? { enabled: false } : {} });
  });
  const showDocument = visibility => page.evaluate(visibility => {
    window.filterVisibility = visibility;
    document.dispatchEvent(new Event('visibilitychange'));
  }, visibility);

  await page.goto('/admin/content/filter');
  await expect(page.getByRole('link', { name: /Foreground fixture/ }).first()).toBeVisible();
  await page.clock.fastForward(6000);
  expect(calls).toEqual([['GET', library]]);

  await showDocument('hidden');
  job = { status: 'queued' };
  await page.clock.fastForward(6000);
  expect(calls).toEqual([['GET', library]]);
  await showDocument('visible');
  await expect(page.getByText('Queued', { exact: true })).toBeVisible();
  expect(calls).toEqual([['GET', library], ['GET', library]]);

  job = { status: 'failed', step: 'make', error: 'Fixture worker refused' };
  await page.clock.fastForward(5200);
  await expect(page.getByText('Failed at make: Fixture worker refused')).toBeVisible();
  await page.clock.fastForward(6000);
  expect(calls).toEqual(Array.from({ length: 3 }, () => ['GET', library]));
});
