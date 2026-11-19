import { expect, test } from '@playwright/test';

test.use({ serviceWorkers: 'block' });

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
    if (pathname === library) return route.fulfill({ json: { films: [{
      ratingKey: '77', title: 'Foreground fixture', stage: 'parent', job,
    }] } });
    return route.fulfill({ json: pathname.endsWith('/supervision/bootstrap') ? { enabled: false } : {} });
  });
  const showDocument = visibility => page.evaluate(visibility => {
    window.filterVisibility = visibility;
    document.dispatchEvent(new Event('visibilitychange'));
  }, visibility);

  await page.goto('/admin/content/filter');
  await expect(page.getByRole('button', { name: 'Run again' })).toBeEnabled();
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
