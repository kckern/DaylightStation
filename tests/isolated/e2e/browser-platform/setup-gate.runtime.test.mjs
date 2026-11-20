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
