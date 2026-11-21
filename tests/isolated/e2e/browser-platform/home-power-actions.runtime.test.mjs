import { expect, test } from '@playwright/test';

test.use({ viewport: { width: 390, height: 850 } });

const start = '/app/fixture-start';
const successor = '/app/fixture-successor';
const actions = [
  { app: 'office_off', endpoint: '/api/v1/home/office_tv/off', target: 'the office TV' },
  { app: 'wrapup', endpoint: '/api/v1/home/tv/off', target: 'the living room TV' },
];

async function openRoute(page, path) {
  await page.evaluate(next => {
    history.pushState(null, '', next);
    dispatchEvent(new PopStateEvent('popstate'));
  }, path);
}

const committed = page => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));

async function interceptPower(page, endpoint, respond) {
  const calls = [];
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.routeWebSocket('**/*', () => {});
  await page.route('**/api/**', route => {
    const path = new URL(route.request().url()).pathname;
    if (path === endpoint) {
      calls.push(route.request().method());
      return respond(route, calls.length);
    }
    return route.fulfill({ json: path.endsWith('/supervision/bootstrap') ? { enabled: false } : {} });
  });
  await page.goto(start);
  await expect(page.getByRole('heading', { name: 'App Container' })).toBeVisible();
  return { calls, errors };
}

for (const { app, endpoint, target } of actions) {
  test(`${app} ignores late power completion and admits one request across a route suffix change`, async ({ page }) => {
    const pending = Promise.withResolvers();
    const { calls, errors } = await interceptPower(page, endpoint, async route => {
      await pending.promise;
      return route.fulfill({ json: { ok: true } });
    });
    try {
      await openRoute(page, `/app/${app}`);
      await expect.poll(() => calls.length).toBe(1);
      await openRoute(page, `/app/${app}/same-action`);
      await committed(page);
      const callsOnSameAction = [...calls];

      await openRoute(page, successor);
      await expect(page.getByText('fixture-successor', { exact: false })).toBeVisible();
      const response = page.waitForResponse(res => new URL(res.url()).pathname === endpoint);
      pending.resolve();
      await (await response).finished();
      await committed(page);

      await expect(page).toHaveURL(successor);
      expect(callsOnSameAction).toEqual(['GET']);
      expect(calls).toEqual(['GET']);
      expect(errors).toEqual([]);
    } finally {
      pending.resolve();
    }
  });

  test(`${app} shows a refused power command and retries once on keyboard activation`, async ({ page }) => {
    const { calls, errors } = await interceptPower(page, endpoint, (route, attempt) => {
      if (attempt === 2) return route.fulfill({ json: { ok: true } });
      const status = app === 'office_off' ? 503 : 200;
      return route.fulfill({ status, json: { ok: false, error: 'Fixture power command refused' } });
    });
    await openRoute(page, `/app/${app}`);
    const alert = page.getByRole('alert');
    await expect(alert).toContainText(`Couldn’t turn off ${target}`);
    await expect(alert).toContainText('Fixture power command refused');
    await expect(alert).toHaveCSS('background-color', 'rgb(28, 34, 41)');
    const retry = alert.getByRole('button', { name: 'Retry' });
    await expect.poll(() => calls.length).toBe(1);
    await retry.press('Enter');
    await expect(page).toHaveURL(start);
    expect(calls).toEqual(['GET', 'GET']);
    expect(errors).toEqual([]);
  });
}
