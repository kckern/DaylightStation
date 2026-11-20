import { expect, test } from '@playwright/test';

test.use({ serviceWorkers: 'block', viewport: { width: 1440, height: 850 } });
test.beforeEach(async ({ page }) => {
  await page.routeWebSocket('**/*', () => {});
  await page.route('**/api/**', route => route.fulfill({ json: {} }));
  await page.route('**/supervision/bootstrap', route => route.fulfill({ json: { enabled: false } }));
});

const authContext = '**/api/v1/auth/context';
const configured = { needsSetup: false };
const unconfigured = { needsSetup: true };
const adminMenus = '/admin/content/lists/menus';
const adminWatchlists = '/admin/content/lists/watchlists';

test('Admin Back retires a pending setup check without replacing the ready page', async ({ page }) => {
  const watchlistsStarted = Promise.withResolvers();
  const release = Promise.withResolvers();
  const replied = Promise.withResolvers();
  let calls = 0;
  let watchlistsRequest;
  let retired = false;
  page.on('requestfailed', request => {
    if (request === watchlistsRequest) retired = true;
  });
  await page.route(authContext, async route => {
    if (++calls !== 2) return route.fulfill({ json: configured });
    watchlistsRequest = route.request();
    watchlistsStarted.resolve();
    await release.promise;
    try { await route.fulfill({ json: unconfigured }); }
    catch { /* The request can already have been canceled. */ }
    finally { replied.resolve(); }
  });

  try {
    await page.goto(adminMenus);
    const main = page.getByRole('main');
    const newMenu = main.getByRole('button', { name: 'New Menu', exact: true });
    await expect(newMenu).toBeVisible();

    await page.getByRole('link', { name: 'Watchlists', exact: true }).click();
    await page.waitForURL('**' + adminWatchlists);
    await watchlistsStarted.promise;
    await expect(main.getByRole('button', { name: 'New Watchlist', exact: true })).toBeVisible();

    await page.goBack();
    await page.waitForURL('**' + adminMenus);
    await expect(newMenu).toBeVisible();
    await expect.poll(() => calls).toBe(3);

    release.resolve();
    await replied.promise;
    await expect.poll(() => ({ retired, path: new URL(page.url()).pathname })).toEqual({ retired: true, path: adminMenus });
    await expect(newMenu).toBeVisible();
  } finally {
    release.resolve();
  }
});

test('a hung first setup check releases the requested app at its deadline', async ({ page }) => {
  const started = Promise.withResolvers();
  const release = Promise.withResolvers();
  await page.route(authContext, async route => {
    started.resolve();
    await release.promise;
    await route.fulfill({ json: configured }).catch(() => {});
  });
  try {
    const timedOut = page.waitForEvent('requestfailed', request => request.url().endsWith('/api/v1/auth/context'));
    await page.goto(adminMenus);
    await started.promise;
    await expect(page.getByRole('main')).toHaveCount(0);
    await timedOut;
    await expect(page.getByRole('button', { name: 'New Menu', exact: true })).toBeVisible();
    await expect(page).toHaveURL(adminMenus);
  } finally {
    release.resolve();
  }
});

test('a fresh install opens the setup wizard from the requested app', async ({ page }) => {
  await page.route(authContext, route => route.fulfill({ json: unconfigured }));
  await page.goto(adminMenus);
  await expect(page).toHaveURL('/setup');
  await page.getByRole('button', { name: 'Get Started', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Create Admin Account', exact: true })).toBeVisible();
});

test('a claimable Admin profile leaves the requested app in place', async ({ page }) => {
  await page.route(authContext, route => route.fulfill({ json: { ...unconfigured, setupAdmin: 'admin' } }));
  await page.goto(adminMenus);
  await expect(page.getByRole('button', { name: 'New Menu', exact: true })).toBeVisible();
  await expect(page).toHaveURL(adminMenus);
});

test('an offline setup check releases the requested app', async ({ page }) => {
  await page.route(authContext, route => route.abort('internetdisconnected'));
  await page.goto(adminMenus);
  await expect(page.getByRole('button', { name: 'New Menu', exact: true })).toBeVisible();
  await expect(page).toHaveURL(adminMenus);
});

test('direct setup and invite URLs open without a public auth context request', async ({ page }) => {
  let calls = 0;
  await page.route(authContext, route => {
    calls++;
    return route.fulfill({ json: unconfigured });
  });
  await page.route('**/api/v1/auth/invite/fixture', route => route.fulfill({ json: { username: 'Fixture' } }));

  await page.goto('/setup');
  await expect(page.getByRole('button', { name: 'Get Started', exact: true })).toBeVisible();
  await page.goto('/invite/fixture');
  await expect(page.getByRole('heading', { name: 'Welcome, Fixture', exact: true })).toBeVisible();
  expect(calls).toBe(0);
});

for (const firstTime of [true, false]) {
  test(`Admin recovers an accepted ${firstTime ? 'claim' : 'sign-in'} when the browser cannot save the session`, async ({ page, baseURL }) => {
    // Exercise the deployed hostname path. AuthGate skips login on localhost.
    const origin = 'http://household.test';
    await page.route(origin + '/**', async route => {
      const { pathname, search } = new URL(route.request().url());
      if (pathname.startsWith('/api/')) return route.fallback();
      const response = await route.fetch({ url: new URL(pathname + search, baseURL).href });
      return route.fulfill({ response });
    });
    await page.addInitScript(() => {
      const original = Storage.prototype.setItem;
      Storage.prototype.setItem = function (key, value) {
        if (this === localStorage && key === 'ds_token' && !sessionStorage.getItem('allowTokenWrite')) {
          throw new DOMException('Storage quota exceeded', 'QuotaExceededError');
        }
        return original.call(this, key, value);
      };
    });
    const username = 'fixture-admin';
    const token = 'fixture.' + Buffer.from(JSON.stringify({ sub: username })).toString('base64url') + '.fixture';
    const commands = [];
    await page.route(authContext, route => route.fulfill({ json: { needsSetup: firstTime, setupAdmin: firstTime ? username : null } }));
    await page.route('**/api/v1/auth/{claim,token}', route => {
      commands.push([route.request().method(), new URL(route.request().url()).pathname]);
      return route.fulfill({ json: { token } });
    });
    await page.goto(origin + adminMenus);
    if (!firstTime) await page.getByLabel('Username', { exact: true }).fill(username);
    await page.getByLabel(firstTime ? 'Choose a Password' : 'Password', { exact: true }).fill('fixture-password');
    await page.getByRole('button', { name: firstTime ? 'Set Password & Sign In' : 'Sign In', exact: true }).click();
    const firstCommand = ['POST', firstTime ? '/api/v1/auth/claim' : '/api/v1/auth/token'];
    const alert = page.getByRole('alert');
    await expect(alert).toContainText(firstTime ? 'Your password was set.' : 'Your sign-in was accepted.');
    await expect(alert).toContainText(/browser.*storage/i);
    expect(commands).toEqual([firstCommand]);
    await expect(page.getByLabel('Username', { exact: true })).toHaveValue(username);
    await expect(page.getByLabel('Password', { exact: true })).toHaveValue('');
    await expect(page.getByRole('button', { name: 'New Menu' })).toHaveCount(0);
    await page.evaluate(() => sessionStorage.setItem('allowTokenWrite', '1'));
    await page.getByLabel('Password', { exact: true }).fill('fixture-password');
    await page.getByRole('button', { name: 'Sign In', exact: true }).click();
    await expect(page.getByRole('button', { name: 'New Menu', exact: true })).toBeVisible();
    await expect(page).toHaveURL(origin + adminMenus);
    expect(commands).toEqual([firstCommand, ['POST', '/api/v1/auth/token']]);
    expect(await page.evaluate(() => localStorage.getItem('ds_token'))).toBe(token);
  });
}
