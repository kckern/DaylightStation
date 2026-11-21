import { expect, test } from '@playwright/test';

const integrationsPath = '/admin/system/integrations';
const integrationsEndpoint = '/api/v1/admin/integrations';
const cases = [
  {
    name: 'Media Item Detail', region: 'Item details',
    path: '/media?view=detail&contentId=plex%3A123', endpoint: '/api/v1/info/plex/123',
    payload: { contentId: 'plex:123', title: 'Fixture Film', type: 'movie' },
    result: 'Fixture Film', retry: 'Try again', back: page => page.getByTestId('detail-back'),
    exit: page => page.getByTestId('home-view'), destination: '/media',
  },
  {
    name: 'Admin Sessions', region: 'Sessions',
    path: '/admin/household/sessions', endpoint: '/api/v1/auth/sessions',
    payload: { revocable: true, sessions: [{ id: 'desktop', username: 'Fixture member', current: true }] },
    result: 'Fixture member this device',
  },
  {
    name: 'Admin Integrations', region: 'Integrations',
    path: integrationsPath, endpoint: integrationsEndpoint,
    payload: { integrations: [] }, result: 'No integrations found.',
  },
  {
    name: 'Admin Integration Detail', region: 'Integration details',
    path: integrationsPath + '/plex', endpoint: integrationsEndpoint + '/plex',
    payload: { integration: { provider: 'plex', category: 'media' } },
    result: 'Service Info', back: page => page.getByText('Back to Integrations', { exact: true }),
    exit: page => page.getByRole('heading', { name: 'Integrations', exact: true }), destination: integrationsPath,
  },
];

test.use({ serviceWorkers: 'block' });

async function openFailedRead(page, fixture) {
  const calls = [];
  let pending;
  await page.addInitScript(() => localStorage.setItem('media-app.first-use-done', 'done'));
  await page.routeWebSocket('**/*', () => {});
  await page.route('**/api/**', route => {
    const request = route.request();
    const { pathname, search } = new URL(request.url());
    if (pathname !== fixture.endpoint) return route.fulfill({
      json: pathname === integrationsEndpoint ? { integrations: [] } : { enabled: false },
    });
    calls.push([request.method(), pathname + search]);
    if (calls.length === 1) return route.fulfill({ status: 409, json: { error: 'Fixture unavailable' } });
    pending = route;
  });
  await page.goto(fixture.path);
  const retry = page.getByRole('button', { name: fixture.retry ?? 'Retry', exact: true });
  await expect(retry).toBeVisible();
  return {
    calls, retry,
    region: page.getByRole('region', { name: fixture.region, exact: true }),
    back: fixture.back?.(page),
    async startRetry() {
      await retry.press('Enter');
      await expect.poll(() => Boolean(pending)).toBe(true);
      await expect(retry).toHaveCount(0);
      expect(await page.evaluate(() => document.activeElement.tagName)).not.toBe('BODY');
      return pending;
    },
  };
}

for (const width of [390, 1440]) {
  test.describe(`read recovery at ${width}px`, () => {
    test.use({ viewport: { width, height: 850 } });

    for (const fixture of cases) {
      test(`${fixture.name} keeps Retry focus through its own GET`, async ({ page }) => {
        const { calls, retry, region, back, startRetry } = await openFailedRead(page, fixture);
        if (back) await back.evaluate(node => { node.dataset.fixtureBack = 'original'; });
        const pending = await startRetry();
        await expect(region).toBeFocused();
        await expect(region).toHaveAttribute('aria-busy', 'true');
        await expect(region).toBeVisible();
        if (back) {
          await expect(back).toHaveAttribute('data-fixture-back', 'original');
          await expect(back).toBeVisible();
        }

        const emptyItem = fixture.name === 'Media Item Detail' && width === 390;
        const moveToBack = Boolean(back) && width === 1440;
        if (moveToBack) {
          await page.keyboard.press('Tab');
          await expect(back).toBeFocused();
        }
        await pending.fulfill({ json: emptyItem ? null : fixture.payload });
        if (emptyItem) await expect(region).toHaveAttribute('data-testid', 'detail-empty');
        else await expect(region.getByText(fixture.result, { exact: true })).toBeVisible();
        await expect(region).not.toHaveAttribute('aria-busy', 'true');
        await expect(retry).toHaveCount(0);
        await expect(moveToBack ? back : region).toBeFocused();
        if (back) await expect(back).toHaveAttribute('data-fixture-back', 'original');
        expect(calls).toEqual([['GET', fixture.endpoint], ['GET', fixture.endpoint]]);
      });

      if (fixture.back) {
        test(`${fixture.name} Back cancels a held Retry`, async ({ page }) => {
          const { calls, region, back, startRetry } = await openFailedRead(page, fixture);
          const pending = await startRetry();
          await expect(region).toBeFocused();
          const read = pending.request();
          const canceled = page.waitForEvent('requestfailed', request => request === read);
          await page.keyboard.press('Tab');
          await expect(back).toBeFocused();
          if (fixture.destination === integrationsPath) await expect(back).toHaveAttribute('href', integrationsPath);
          await page.keyboard.press('Enter');
          await expect(fixture.exit(page)).toBeVisible();
          expect(new URL(page.url()).pathname).toBe(fixture.destination);
          await canceled;
          expect(calls).toEqual([['GET', fixture.endpoint], ['GET', fixture.endpoint]]);
        });
      }
    }
  });
}

test('Admin Integration Detail keeps a focused Back destination when no record is returned', async ({ page }) => {
  const fixture = cases.find(({ name }) => name === 'Admin Integration Detail');
  await page.setViewportSize({ width: 390, height: 850 });
  const { calls, region, back, startRetry } = await openFailedRead(page, fixture);
  await back.evaluate(node => { node.dataset.fixtureBack = 'original'; });
  const pending = await startRetry();
  await expect(region).toBeFocused();
  await pending.fulfill({ json: { integration: null } });
  await expect(region).not.toHaveAttribute('aria-busy', 'true');
  await expect(region).toBeFocused();
  await expect(back).toHaveAttribute('data-fixture-back', 'original');
  await expect(back).toHaveAttribute('href', integrationsPath);
  await expect(region.getByText('Service Info', { exact: true })).toHaveCount(0);
  await page.keyboard.press('Tab');
  await expect(back).toBeFocused();
  expect(calls).toEqual([['GET', fixture.endpoint], ['GET', fixture.endpoint]]);
});
