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
const deployed = 'http://household.test';

// Exercise the deployed hostname path. AuthGate skips login on localhost.
async function serveDeployedApp(page, baseURL) {
  await page.route(deployed + '/**', async route => {
    const { pathname, search } = new URL(route.request().url());
    if (pathname.startsWith('/api/')) return route.fallback();
    const response = await route.fetch({ url: new URL(pathname + search, baseURL).href });
    return route.fulfill({ response });
  });
}

async function navigateWithinApp(page, path) {
  await page.evaluate(destination => {
    history.pushState({}, '', destination);
    window.dispatchEvent(new PopStateEvent('popstate'));
  }, path);
}

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

test('an invite reached from the setup wizard bypasses the previous setup redirect', async ({ page }) => {
  let calls = 0;
  await page.route(authContext, route => {
    calls++;
    return route.fulfill({ json: unconfigured });
  });
  await page.route('**/api/v1/auth/invite/fixture', route => route.fulfill({ json: { username: 'Fixture' } }));
  await page.goto(adminMenus);
  await expect(page).toHaveURL('/setup');
  await navigateWithinApp(page, '/invite/fixture');
  await expect(page.getByRole('heading', { name: 'Welcome, Fixture', exact: true })).toBeVisible();
  await expect(page).toHaveURL('/invite/fixture');
  expect(calls).toBe(1);
});

test('Admin login uses the accepted claimable context without a second read', async ({ page, baseURL }) => {
  await serveDeployedApp(page, baseURL);
  const reads = [];
  await page.route(authContext, route => {
    reads.push(route.request().method());
    return reads.length === 1
      ? route.fulfill({ json: { ...unconfigured, setupAdmin: 'fixture-admin' } })
      : route.fulfill({ status: 409, json: { message: 'Context unavailable' } });
  });
  await page.goto(deployed + adminMenus);
  await expect(page.getByLabel('Choose a Password', { exact: true })).toBeEnabled();
  await expect(page.getByText('fixture-admin', { exact: true })).toBeVisible();
  expect(reads).toEqual(['GET']);
});

test('Admin login retries a failed context before choosing a credential action', async ({ page, baseURL }) => {
  await serveDeployedApp(page, baseURL);
  const release = Promise.withResolvers();
  const reads = [];
  const writes = [];
  await page.route(authContext, async route => {
    reads.push(route.request().method());
    if (reads.length === 1) return route.fulfill({ status: 409, json: { message: 'Context unavailable' } });
    await release.promise;
    return route.fulfill({ json: { ...unconfigured, setupAdmin: 'fixture-admin' } }).catch(() => {});
  });
  await page.route('**/api/v1/auth/{claim,token}', route => {
    writes.push(route.request().method());
    return route.fulfill({ status: 401, json: { message: 'No submission expected' } });
  });
  try {
    await page.goto(deployed + adminMenus);
    const region = page.getByRole('region', { name: 'Sign-in setup', exact: true });
    const retry = page.getByRole('button', { name: 'Retry', exact: true });
    await expect(retry).toBeEnabled();
    expect(reads).toEqual(['GET']);
    await retry.press('Enter');
    await expect.poll(() => reads).toEqual(['GET', 'GET']);
    await expect(region).toBeFocused();
    await expect(region).toHaveAttribute('aria-busy', 'true');
    await expect(page.getByRole('button', { name: 'Sign In', exact: true })).toHaveCount(0);
    release.resolve();
    const password = region.getByLabel('Choose a Password', { exact: true });
    await expect(password).toBeEnabled();
    await expect(region).not.toHaveAttribute('aria-busy', 'true');
    await expect(region).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(password).toBeFocused();
    expect(writes).toEqual([]);
  } finally {
    release.resolve();
  }
});

test('Admin keeps malformed claim context out of the credential form', async ({ page, baseURL }) => {
  await serveDeployedApp(page, baseURL);
  let reads = 0;
  await page.route(authContext, route => route.fulfill({ json: ++reads === 1
    ? { ...unconfigured, setupAdmin: { name: 'fixture-admin' } }
    : { ...configured, householdName: { name: 'Fixture household' } },
  }));
  await page.goto(deployed + adminMenus);
  const signIn = page.getByRole('button', { name: 'Sign In', exact: true });
  const claim = page.getByRole('button', { name: 'Set Password & Sign In', exact: true });
  const retry = page.getByRole('button', { name: 'Retry', exact: true });
  await expect(retry).toBeEnabled();
  await expect(signIn).toHaveCount(0);
  await expect(claim).toHaveCount(0);
  await retry.press('Enter');
  await expect(page.getByRole('heading', { name: 'DaylightStation', exact: true })).toBeVisible();
  await expect(signIn).toBeVisible();
  expect(reads).toBe(2);
});

test('Admin switches its credential action when a later read accepts a changed setup mode', async ({ page, baseURL }) => {
  await serveDeployedApp(page, baseURL);
  const release = Promise.withResolvers();
  const writes = [];
  let reads = 0;
  await page.route(authContext, async route => {
    if (++reads === 1) return route.fulfill({ json: { ...unconfigured, setupAdmin: 'fixture-admin' } });
    await release.promise;
    return route.fulfill({ json: configured }).catch(() => {});
  });
  await page.route('**/api/v1/auth/{claim,token}', route => {
    writes.push([route.request().method(), new URL(route.request().url()).pathname]);
    return route.fulfill({ status: 401, json: { message: 'Fixture only' } });
  });
  try {
    await page.goto(deployed + adminMenus);
    const claimPassword = page.getByLabel('Choose a Password', { exact: true });
    await claimPassword.fill('unsent-setup-password');
    await navigateWithinApp(page, adminWatchlists);
    await expect.poll(() => reads).toBe(2);
    await expect(claimPassword).toHaveValue('unsent-setup-password');
    release.resolve();
    const password = page.getByLabel('Password', { exact: true });
    await expect(password).toHaveValue('');
    await expect(claimPassword).toHaveCount(0);
    await page.getByLabel('Username', { exact: true }).fill('fixture-admin');
    await password.fill('ordinary-password');
    await page.getByRole('button', { name: 'Sign In', exact: true }).press('Enter');
    await expect.poll(() => writes).toEqual([['POST', '/api/v1/auth/token']]);
  } finally {
    release.resolve();
  }
});

test('Admin keeps the login draft while the next pathname checks public context', async ({ page, baseURL }) => {
  await serveDeployedApp(page, baseURL);
  const release = Promise.withResolvers();
  let hold = false;
  let pending = false;
  await page.route(authContext, async route => {
    if (hold) {
      pending = true;
      await release.promise;
      return route.fulfill({ status: 409, json: { message: 'Context unavailable' } }).catch(() => {});
    }
    return route.fulfill({ json: configured });
  });
  try {
    await page.goto(deployed + adminMenus);
    const username = page.getByLabel('Username', { exact: true });
    await username.fill('fixture-admin');
    hold = true;
    await navigateWithinApp(page, adminWatchlists);
    await expect.poll(() => pending).toBe(true);
    await expect(username).toHaveValue('fixture-admin');
    const password = page.getByLabel('Password', { exact: true });
    await password.fill('unsent-draft');
    const refreshed = page.waitForResponse(response => response.url().endsWith('/auth/context') && response.status() === 409);
    release.resolve();
    await refreshed;
    await expect(password).toBeFocused();
    await expect(password).toHaveValue('unsent-draft');
  } finally {
    release.resolve();
  }
});

for (const firstTime of [true, false]) {
  test(`Admin recovers an accepted ${firstTime ? 'claim' : 'sign-in'} when the browser cannot save the session`, async ({ page, baseURL }) => {
    await serveDeployedApp(page, baseURL);
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
    await page.route(authContext, route => {
      const needsSetup = firstTime && !commands.length;
      return route.fulfill({ json: {
        needsSetup, setupAdmin: needsSetup ? username : null,
        householdName: commands.length ? 'Updated fixture household' : null,
      } });
    });
    await page.route('**/api/v1/auth/{claim,token}', route => {
      commands.push([route.request().method(), new URL(route.request().url()).pathname]);
      return route.fulfill({ json: { token } });
    });
    await page.goto(deployed + adminMenus);
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
    const destination = firstTime ? adminWatchlists : adminMenus;
    if (firstTime) {
      await navigateWithinApp(page, destination);
      await expect(page.getByRole('heading', { name: 'Updated fixture household', exact: true })).toBeVisible();
      await expect(alert).toContainText('Your password was set.');
      await expect(page.getByLabel('Username', { exact: true })).toHaveValue(username);
    }
    await page.evaluate(() => sessionStorage.setItem('allowTokenWrite', '1'));
    await page.getByLabel('Password', { exact: true }).fill('fixture-password');
    await page.getByRole('button', { name: 'Sign In', exact: true }).click();
    await expect(page.getByRole('button', { name: firstTime ? 'New Watchlist' : 'New Menu', exact: true })).toBeVisible();
    await expect(page).toHaveURL(deployed + destination);
    expect(commands).toEqual([firstCommand, ['POST', '/api/v1/auth/token']]);
    expect(await page.evaluate(() => localStorage.getItem('ds_token'))).toBe(token);
  });
}
