import { expect, test } from '@playwright/test';

test.use({ serviceWorkers: 'block', viewport: { width: 390, height: 850 } });

test.beforeEach(async ({ page }) => {
  await page.route('**/api/**', route => route.fulfill({ json: {} }));
  await page.route('**/supervision/bootstrap', route => route.fulfill({ json: { enabled: false } }));
});

test('Auto renders the selected vehicle’s records and discards a late document response from another car', async ({ page }) => {
  await page.routeWebSocket('**/*', () => {});
  const api = '/api/v1/automotive';
  const first = `${api}/vehicles/wagon`;
  const selected = `${api}/vehicles/hatchback`;
  const document = { id: 'registration', kind: 'Registration' };
  const journey = { id: 'river', title: 'Drive to the river', stops: [] };
  const overview = { fuel: { needsMoreData: true, fillCount: 0 }, trip_count: 0 };
  const responses = {
    [`${api}/vehicles`]: { vehicles: [
      { id: 'wagon', label: 'Family wagon' },
      { id: 'hatchback', label: 'City hatchback' },
    ] },
    [`${api}/service-types`]: { types: [{ value: 'cross-rotate', label: 'Cross-pattern tire rotation' }] },
    [first]: { ...overview, odometer: { km: 320 } },
    [`${first}/journeys`]: { journeys: [] },
    [`${first}/fuel`]: { logs: [] },
    [`${first}/service`]: { records: [] },
    [selected]: { ...overview, odometer: { km: 160.9344 } },
    [`${selected}/journeys`]: { journeys: [journey], hidden: 1 },
    [`${selected}/journeys?shuffles=1`]: { journeys: [journey, { id: 'shuffle', title: 'Garage shuffle', stops: [] }] },
    [`${selected}/fuel`]: { logs: [{ id: 'fuel', date: '2026-10-08', price_total: 41.25, volume_l: 30 }] },
    [`${selected}/service`]: { records: [{ id: 'rotation', type: 'cross-rotate', date: '2026-10-09', vendor: 'City Tire Shop' }] },
    [`${selected}/documents`]: { documents: [{ ...document, file: 'city-registration.pdf', label: 'City registration' }] },
  };
  let pendingWagonDocuments;
  await page.route(`**${api}/**`, route => {
    const request = route.request();
    const { pathname, search } = new URL(request.url());
    const key = pathname + search;
    if (request.method() !== 'GET') return route.fulfill({ status: 405 });
    if (key === `${first}/documents`) {
      pendingWagonDocuments = route;
      return;
    }
    const json = responses[key];
    return json ? route.fulfill({ json }) : route.fulfill({ status: 404 });
  });

  await page.goto('/auto');
  await page.getByRole('button', { name: 'Family wagon', exact: true }).click();
  const tab = name => page.getByRole('button', { name, exact: true });
  await tab('Docs').click();
  await expect(page.getByLabel('Loading documents')).toBeVisible();
  await expect.poll(() => Boolean(pendingWagonDocuments)).toBe(true);
  await page.getByRole('button', { name: 'Back to garage' }).click();
  await page.getByRole('button', { name: 'City hatchback', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'City hatchback', exact: true })).toBeVisible();
  const cityRegistration = page.getByRole('link', { name: /City registration/ });
  await expect(cityRegistration).toHaveAttribute('href', `${api}/files/city-registration.pdf`);

  const wagonResponse = page.waitForResponse(response => new URL(response.url()).pathname === `${first}/documents`);
  await pendingWagonDocuments.fulfill({ json: { documents: [
    { ...document, file: 'wagon-registration.pdf', label: 'Wagon registration' },
  ] } });
  expect(await (await wagonResponse).finished()).toBeNull();
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await expect(cityRegistration).toBeVisible();
  await expect(page.getByRole('link', { name: /Wagon registration/ })).toHaveCount(0);

  await tab('Car').click();
  await expect(page.getByText('100 mi', { exact: true })).toBeVisible();
  await tab('Drives').click();
  await expect(page.getByText(journey.title, { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Show 1 very short recording' }).click();
  await expect(page.getByText('Garage shuffle', { exact: true })).toBeVisible();
  await tab('Fuel').click();
  await expect(page.getByText('$41.25', { exact: true })).toBeVisible();
  await tab('Service').click();
  await expect(page.getByText('City Tire Shop', { exact: true })).toBeVisible();
  await expect(page.getByText('Cross-pattern tire rotation', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Log service' }).click();
  await expect(page.getByRole('combobox', { name: 'What was done' })).toHaveValue('cross-rotate');
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

test('Life Purpose retries a failed read after saving without writing the statement again', async ({ page }) => {
  await page.routeWebSocket('**/*', () => {});
  const member = { username: 'amy', displayName: 'Amy' };
  const statement = 'Make time to learn something new.';
  const planPath = '/api/v1/life/plan/?username=amy';
  const purposePath = '/api/v1/life/plan/purpose?username=amy';
  const reads = [];
  const writes = [];

  await page.route('**/api/v1/life/**', route => {
    const request = route.request();
    const { pathname, search } = new URL(request.url());
    const path = pathname + search;
    if (pathname === '/api/v1/life/users') return route.fulfill({ json: { users: [member] } });
    if (pathname === '/api/v1/life/user') return route.fulfill({ json: member });
    if (path === planPath && request.method() === 'GET') {
      reads.push(path);
      if (reads.length === 1) return route.fulfill({ json: {} });
      if (reads.length === 2) return route.fulfill({ status: 500, json: { error: 'Purpose read temporarily unavailable' } });
      return route.fulfill({ json: { purpose: { statement } } });
    }
    if (path === purposePath && request.method() === 'POST') {
      writes.push(request.postDataJSON());
      return route.fulfill({ json: { statement } });
    }
    return route.fallback();
  });

  await page.goto('/life/plan');
  const edit = page.getByRole('button', { name: 'Edit purpose', exact: true });
  await expect(page.getByRole('button', { name: 'Talk to your coach' })).toBeVisible();
  await edit.click();
  await page.getByRole('textbox', { name: 'Purpose statement' }).fill(statement);
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  const error = page.getByRole('alert').filter({ hasText: 'Purpose read temporarily unavailable' });
  await expect(error).toBeVisible();
  await expect(page.getByRole('button', { name: 'Talk to your coach' })).toHaveCount(0);
  await error.getByRole('button', { name: 'Retry', exact: true }).click();
  await expect(page.getByText(statement, { exact: true })).toBeVisible();
  expect(reads).toEqual([planPath, planPath, planPath]);
  expect(writes).toEqual([{ statement }]);
});
