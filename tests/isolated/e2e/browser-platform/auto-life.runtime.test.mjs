import { expect, test } from '@playwright/test';

test.use({ serviceWorkers: 'block', viewport: { width: 390, height: 850 } });

test.beforeEach(async ({ page }) => {
  await page.route('**/api/**', route => route.fulfill({ json: {} }));
  await page.route('**/supervision/bootstrap', route => route.fulfill({ json: { enabled: false } }));
});

test('Auto saves one fuel entry at phone height and reopens on Car', async ({ page }) => {
  await page.routeWebSocket('**/*', () => {});
  const writes = [];
  await page.route('**/automotive/**', route => {
    const request = route.request();
    if (request.method() === 'POST') {
      writes.push(request.postDataJSON());
      return route.fulfill({ json: { ok: true } });
    }
    if (request.url().endsWith('/vehicles')) {
      return route.fulfill({ json: { vehicles: [{ id: 'sample', label: 'Sample' }] } });
    }
    if (request.url().endsWith('/vehicles/sample')) {
      return route.fulfill({ json: { odometer: { km: 123 }, fuel: { needsMoreData: true, fillCount: 0 }, trip_count: 0 } });
    }
    return route.fulfill({ json: {} });
  });
  await page.goto('/auto');
  const fuel = page.getByRole('button', { name: 'Fuel', exact: true });
  await fuel.click();
  await expect(fuel).toHaveAttribute('aria-current', 'page');
  await page.getByRole('button', { name: 'Log a fill-up' }).press('Enter');
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await page.setViewportSize({ width: 390, height: 420 });
  await dialog.getByLabel('Gallons').fill('5.5');
  await dialog.getByLabel('Total ($)', { exact: true }).fill('19.50');
  const save = dialog.getByRole('button', { name: 'Save', exact: true });
  await expect(save).toBeEnabled();
  await save.scrollIntoViewIfNeeded();
  await expect(save).toBeInViewport({ ratio: 1 });
  await save.press('Enter');
  await expect(dialog).toBeHidden();
  expect(writes).toEqual([expect.objectContaining({ volumeGal: 5.5, priceTotal: 19.5 })]);
  await page.reload();
  await expect(page.getByRole('button', { name: 'Car', exact: true })).toHaveAttribute('aria-current', 'page');
});

test('Life discards a previous member’s late plan and deduplicates recipient notifications', async ({ page }) => {
  const users = ['amy', 'bob'].map(username => ({ username, displayName: username.toUpperCase() }));
  let socket;
  let pendingPlan;
  await page.routeWebSocket('**/*', connection => { socket = connection; });
  await page.route('**/life/**', route => {
    const url = new URL(route.request().url());
    if (!url.pathname.startsWith('/api/')) return route.continue();
    const username = url.searchParams.get('username');
    if (url.pathname.endsWith('/users')) return route.fulfill({ json: { users } });
    if (url.pathname.endsWith('/user')) return route.fulfill({ json: users.find(user => user.username === username) || users[0] });
    if (url.pathname.replace(/\/$/, '').endsWith('/plan') && username === 'amy') {
      pendingPlan = route;
      return;
    }
    if (url.pathname.replace(/\/$/, '').endsWith('/plan')) return route.fulfill({ json: { purpose: { statement: username + ' marker' } } });
    return route.fulfill({ json: {} });
  });
  await page.goto('/life/plan');
  const switcher = page.getByRole('textbox', { name: 'Switch household member' });
  await expect.poll(() => Boolean(pendingPlan)).toBe(true);
  await switcher.click();
  await page.getByRole('option', { name: 'BOB' }).click();
  const plan = page.getByText('bob marker', { exact: true });
  await expect(plan).toBeVisible();
  await expect.poll(() => Boolean(socket)).toBe(true);
  for (const username of ['amy', 'bob', 'bob']) {
    socket.send(JSON.stringify({
      topic: 'notification', title: username + ' recipient', urgency: 'critical',
      metadata: { id: username + '-id', username },
    }));
  }
  await expect(page.getByText('bob recipient', { exact: true })).toHaveCount(1);
  await expect(page.getByText('amy recipient', { exact: true })).toHaveCount(0);
  await pendingPlan.fulfill({ json: { purpose: { statement: 'amy marker' } } });
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await expect(plan).toBeVisible();
  await expect(page.getByText('amy marker', { exact: true })).toHaveCount(0);
  await page.reload();
  await expect(plan).toBeVisible();
  await expect(switcher).toHaveValue('BOB');
});

test('Life distinguishes unavailable goals from a successful empty list and retries the read', async ({ page }) => {
  await page.routeWebSocket('**/*', () => {});
  const member = { username: 'amy', displayName: 'Amy' };
  await page.route('**/api/**/life/users', route => route.fulfill({ json: { users: [member] } }));
  await page.route('**/api/**/life/user*', route => {
    if (new URL(route.request().url()).pathname.endsWith('/users')) return route.fallback();
    return route.fulfill({ json: member });
  });
  let recovered = false;
  await page.route('**/api/**/life/plan/goals*', route => recovered
    ? route.fulfill({ json: { goals: [] } })
    : route.fulfill({ status: 503, json: { message: 'Goals temporarily unavailable' } }));
  await page.goto('/life/plan/goals');
  await expect(page.getByRole('alert')).toContainText('Goals');
  await expect(page.getByText(/No goals yet/)).toHaveCount(0);
  recovered = true;
  await page.getByRole('button', { name: 'Retry' }).click();
  await expect(page.getByText(/No goals yet/)).toBeVisible();
});
