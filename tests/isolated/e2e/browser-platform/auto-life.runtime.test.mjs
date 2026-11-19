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

for (const width of [390, 1440]) {
  test(`Auto restores each record tab’s scroll for the selected car at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 850 });
    await page.routeWebSocket('**/*', () => {});
    const fuelLogs = Array.from({ length: 35 }, (_, i) => ({
      id: `fuel-${i}`, date: '2026-10-08', price_total: 12 + i, volume_l: 30,
    }));
    let saveAccepted = false;
    let pendingFuelRefresh;
    await page.route('**/automotive/**', route => {
      const request = route.request();
      const { pathname } = new URL(request.url());
      if (pathname.endsWith('/vehicles')) {
        return route.fulfill({ json: { vehicles: [
          { id: 'wagon', label: 'Family wagon' },
          { id: 'hatchback', label: 'City hatchback' },
        ] } });
      }
      if (/\/vehicles\/(wagon|hatchback)$/.test(pathname)) {
        return route.fulfill({ json: { odometer: { km: 160 }, fuel: { needsMoreData: true, fillCount: 0 } } });
      }
      if (pathname.endsWith('/fuel')) {
        if (request.method() === 'POST') {
          saveAccepted = true;
          return route.fulfill({ json: { ok: true } });
        }
        if (saveAccepted && pathname.endsWith('/wagon/fuel')) {
          pendingFuelRefresh = route;
          return;
        }
        return route.fulfill({ json: { logs: fuelLogs } });
      }
      if (pathname.endsWith('/service')) {
        const vehicle = pathname.split('/').at(-2);
        return route.fulfill({ json: { records: Array.from({ length: 35 }, (_, i) => ({
          id: `service-${i}`, type: 'inspection', date: '2026-10-08', vendor: `${vehicle} shop ${i}`,
        })) } });
      }
      return route.fulfill({ json: {} });
    });

    const main = page.getByRole('main');
    const tab = name => page.getByRole('button', { name, exact: true });
    const scrollPosition = () => main.evaluate(node => node.scrollTop);
    const scrollTo = async top => {
      await main.evaluate((node, position) => { node.scrollTop = position; }, top);
      await expect.poll(scrollPosition).toBe(top);
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    };

    await page.goto('/auto');
    await tab('Family wagon').click();
    await tab('Service').click();
    await expect(main.getByText('wagon shop 0', { exact: true })).toBeVisible();
    await tab('Fuel').click();
    await expect(main.getByText('$12.00', { exact: true })).toBeVisible();
    await scrollTo(610);

    await tab('Service').click();
    await expect.poll(scrollPosition).toBe(0);
    await scrollTo(320);
    await tab('Fuel').click();
    await expect.poll(scrollPosition).toBe(610);
    await tab('Log a fill-up').click();
    const dialog = page.getByRole('dialog', { name: 'Log a fill-up' });
    await dialog.getByLabel('Gallons').fill('5');
    await dialog.getByLabel('Total ($)', { exact: true }).fill('99.25');
    await dialog.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(dialog).toBeHidden();
    await expect.poll(() => Boolean(pendingFuelRefresh)).toBe(true);
    await scrollTo(495);
    await pendingFuelRefresh.fulfill({ json: { logs: [
      ...fuelLogs, { id: 'saved', date: '2026-10-08', price_total: 99.25, volume_l: 18.9 },
    ] } });
    await expect(main.getByText('$99.25', { exact: true })).toBeVisible();
    await expect.poll(scrollPosition).toBe(495);
    await tab('Service').click();
    await expect.poll(scrollPosition).toBe(320);

    await tab('Back to garage').click();
    await tab('City hatchback').click();
    await expect(main.getByText('hatchback shop 0', { exact: true })).toBeVisible();
    await expect.poll(scrollPosition).toBe(0);
  });
}

test('Auto saves one fuel entry at phone height and reopens on Car', async ({ page }) => {
  await page.routeWebSocket('**/*', () => {});
  const writes = [];
  const readsAfterSave = [];
  const car = '/api/v1/automotive/vehicles/sample';
  await page.route('**/automotive/**', route => {
    const request = route.request();
    if (request.method() === 'POST') {
      writes.push(request.postDataJSON());
      return route.fulfill({ json: { ok: true } });
    }
    if (writes.length) {
      const path = new URL(request.url()).pathname;
      readsAfterSave.push(path);
      if (path === car + '/fuel') {
        if (readsAfterSave.filter(read => read === path).length === 1) {
          return route.fulfill({ status: 400, json: { error: 'Fuel log unavailable' } });
        }
        return route.fulfill({ json: { logs: [
          { id: 'saved', date: '2026-10-08', volume_l: 20.82, price_total: 19.50 },
        ] } });
      }
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
  await expect(page.getByRole('alert')).toBeVisible();
  await page.getByRole('button', { name: 'Retry' }).click();
  await expect(page.getByText('$19.50', { exact: true })).toBeVisible();
  expect([...readsAfterSave].sort()).toEqual([car, car + '/fuel', car + '/fuel']);
  expect(writes).toEqual([expect.objectContaining({ volumeGal: 5.5, priceTotal: 19.5 })]);
  await page.reload();
  await expect(page.getByRole('button', { name: 'Car', exact: true })).toHaveAttribute('aria-current', 'page');
});

test('Auto announces a rejected fuel save and lets the keyboard user retry the draft', async ({ page }) => {
  await page.routeWebSocket('**/*', () => {});
  const writes = [];
  const car = '/api/v1/automotive/vehicles/sample';
  const fuelPath = car + '/fuel';
  await page.route('**/automotive/**', route => {
    const request = route.request();
    const { pathname } = new URL(request.url());
    if (pathname.endsWith('/vehicles')) {
      return route.fulfill({ json: { vehicles: [{ id: 'sample', label: 'Sample' }] } });
    }
    if (pathname === car) {
      return route.fulfill({ json: { odometer: { km: 123 }, fuel: { needsMoreData: true, fillCount: 0 }, trip_count: 0 } });
    }
    if (pathname === fuelPath && request.method() === 'POST') {
      writes.push(request.postDataJSON());
      if (writes.length === 1) return route.fulfill({ status: 422, json: { error: 'Volume exceeds tank capacity' } });
    }
    return route.fulfill({ json: {} });
  });

  await page.goto('/auto');
  await page.getByRole('button', { name: 'Fuel', exact: true }).press('Enter');
  const opener = page.getByRole('button', { name: 'Log a fill-up' });
  await opener.press('Enter');
  const dialog = page.getByRole('dialog', { name: 'Log a fill-up' });
  const volume = dialog.getByLabel('Gallons');
  const save = dialog.getByRole('button', { name: 'Save', exact: true });
  await volume.fill('15');
  await save.press('Enter');

  await expect(dialog.getByRole('alert')).toContainText('Volume exceeds tank capacity');
  await expect(volume).toHaveValue('15');
  await volume.fill('5');
  await save.press('Enter');
  await expect(dialog).toBeHidden();
  await expect(opener).toBeFocused();
  expect(writes.map(write => write.volumeGal)).toEqual([15, 5]);
});

test('Auto preserves a reopened fuel draft when the earlier save is acknowledged', async ({ page }) => {
  await page.routeWebSocket('**/*', () => {});
  const car = '/api/v1/automotive/vehicles/sample';
  let pendingSave;
  let saved = false;
  await page.route('**/automotive/**', route => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path === car + '/fuel' && request.method() === 'POST') {
      pendingSave = route;
      return;
    }
    if (path.endsWith('/vehicles')) {
      return route.fulfill({ json: { vehicles: [{ id: 'sample', label: 'Sample' }] } });
    }
    if (path === car) {
      return route.fulfill({ json: { odometer: { km: 123 }, fuel: { needsMoreData: true }, trip_count: 0 } });
    }
    if (path === car + '/fuel') {
      const logs = saved ? [{ id: 'saved', date: '2026-10-08', volume_l: 20.82, price_total: 19.50 }] : [];
      return route.fulfill({ json: { logs } });
    }
    return route.fulfill({ json: {} });
  });

  await page.goto('/auto');
  await page.getByRole('button', { name: 'Fuel', exact: true }).click();
  const opener = page.getByRole('button', { name: 'Log a fill-up' });
  const dialog = page.getByRole('dialog', { name: 'Log a fill-up' });
  await opener.press('Enter');
  await dialog.getByLabel('Gallons').fill('5.5');
  await dialog.getByRole('button', { name: 'Save', exact: true }).click();
  await expect.poll(() => Boolean(pendingSave)).toBe(true);

  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(opener).toBeFocused();
  await opener.press('Enter');
  await dialog.getByLabel('Gallons').fill('7');

  saved = true;
  await pendingSave.fulfill({ json: { ok: true } });
  await expect(page.getByText('$19.50', { exact: true })).toBeVisible();
  await expect(dialog.getByLabel('Gallons')).toHaveValue('7');
  await page.keyboard.press('Escape');
  await expect(opener).toBeFocused();
});

test('Auto place naming focuses the name and returns focus to the journey action', async ({ page }) => {
  await page.routeWebSocket('**/*', () => {});
  const root = '/api/v1/automotive/vehicles';
  const car = `${root}/sample`;
  const fixtures = {
    [root]: { vehicles: [{ id: 'sample', label: 'Sample' }] },
    [car]: { odometer: { km: 123 }, fuel: { needsMoreData: true }, trip_count: 1 },
    [`${car}/journeys`]: { journeys: [{ id: 'drive', title: 'Morning drive', origin: { fix: { lat: 1, lon: 2 } }, stops: [] }] },
    [`${car}/fuel`]: { logs: [] },
  };
  await page.route('**/automotive/**', route => route.fulfill({ json: fixtures[new URL(route.request().url()).pathname] ?? {} }));

  await page.goto('/auto');
  await page.getByRole('button', { name: 'Drives', exact: true }).click();
  const opener = page.getByRole('button', { name: 'Name this place', exact: true });
  const dialog = page.getByRole('dialog', { name: 'Name this place' });
  const name = dialog.getByRole('textbox', { name: 'What is it?' });
  await opener.press('Enter');
  await expect(name).toBeFocused();
  await name.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(opener).toBeFocused();
});

test('Auto keeps fuel Save reachable when only the visual viewport shrinks', async ({ page }) => {
  await page.routeWebSocket('**/*', () => {});
  await page.route('https://fonts.googleapis.com/**', route => route.abort());
  await page.route('**/automotive/vehicles', route => route.fulfill({
    json: { vehicles: [{ id: 'sample', label: 'Sample' }] },
  }));
  await page.route('**/automotive/vehicles/sample', route => route.fulfill({
    json: { odometer: { km: 123 }, fuel: { needsMoreData: true, fillCount: 0 }, trip_count: 0 },
  }));
  await page.goto('/auto');
  await page.getByRole('button', { name: 'Fuel', exact: true }).click();
  const openFuel = page.getByRole('button', { name: 'Log a fill-up' });
  await openFuel.click();
  const dialog = page.getByRole('dialog', { name: 'Log a fill-up' });
  const total = dialog.getByLabel('Total ($)', { exact: true });
  await dialog.getByLabel('Gallons').fill('5.5');
  await total.focus();

  // Desktop browser automation has no soft keyboard. Keep the actual layout
  // viewport fixed and drive the VisualViewport readings a keyboard changes.
  const setVisualViewport = (values, event = 'resize') => page.evaluate(({ values, event }) => {
    const viewport = window.visualViewport;
    for (const [key, value] of Object.entries(values)) {
      Object.defineProperty(viewport, key, { configurable: true, value });
    }
    viewport.dispatchEvent(new Event(event));
  }, { values, event });
  const dialogBounds = () => dialog.evaluate(element => {
    const { top, bottom } = element.getBoundingClientRect();
    return [top, bottom, window.innerHeight];
  });
  await setVisualViewport({ scale: 1, width: 390, height: 400, offsetTop: 0 });
  await expect.poll(dialogBounds).toEqual([0, 400, 850]);
  await setVisualViewport({ offsetTop: 100 }, 'scroll');
  await expect.poll(dialogBounds).toEqual([100, 500, 850]);

  const save = dialog.getByRole('button', { name: 'Save', exact: true });
  await expect(save).toBeEnabled();
  await save.scrollIntoViewIfNeeded();
  await expect.poll(() => save.evaluate(button => {
    const { left, right, top, bottom } = button.getBoundingClientRect();
    const viewport = window.visualViewport;
    return top >= viewport.offsetTop && bottom <= viewport.offsetTop + viewport.height
      && button.contains(document.elementFromPoint((left + right) / 2, (top + bottom) / 2));
  })).toBe(true);

  await setVisualViewport({ scale: 1.25 });
  await expect.poll(dialogBounds).toEqual([0, 850, 850]);
  await setVisualViewport({ scale: 1 });
  await expect.poll(dialogBounds).toEqual([100, 500, 850]);
  await setVisualViewport({ height: 850, offsetTop: 0 });
  await expect.poll(dialogBounds).toEqual([0, 850, 850]);
  await setVisualViewport({ height: 400, offsetTop: 100 });
  await expect.poll(dialogBounds).toEqual([100, 500, 850]);

  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(openFuel).toBeFocused();
  await openFuel.click();
  await expect.poll(dialogBounds).toEqual([0, 850, 850]);
});

test('Life retires previous-member plans and notifications on household switches', async ({ page }) => {
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
    if (url.pathname.replace(/\/$/, '').endsWith('/plan') && username === 'amy' && !pendingPlan) {
      pendingPlan = route;
      return;
    }
    if (url.pathname.replace(/\/$/, '').endsWith('/plan')) return route.fulfill({ json: { purpose: { statement: username + ' marker' } } });
    return route.fulfill({ json: {} });
  });
  await page.goto('/life/plan');
  const switcher = page.getByRole('textbox', { name: 'Switch household member' });
  const switchMember = async (member) => {
    await switcher.press('ArrowDown');
    const option = page.getByRole('option', { name: member, exact: true });
    await expect(option).toBeVisible();
    const optionId = await option.getAttribute('id');
    for (let step = 0; step < 2 && await switcher.getAttribute('aria-activedescendant') !== optionId; step += 1) {
      await switcher.press('ArrowDown');
    }
    await expect(switcher).toHaveAttribute('aria-activedescendant', optionId);
    await switcher.press('Enter');
    await expect(switcher).toHaveValue(member);
  };
  await expect.poll(() => Boolean(pendingPlan)).toBe(true);
  await expect.poll(() => Boolean(socket)).toBe(true);
  const amyAction = { label: 'Open Amy’s plan', data: { url: '/life/plan/goals' } };
  const amyNotification = {
    topic: 'notification', title: 'Amy’s reminder', body: 'Amy’s plan is due', urgency: 'critical',
    metadata: { id: 'amy-reminder', username: 'amy' }, actions: [amyAction],
  };
  socket.send(JSON.stringify(amyNotification));
  socket.send(JSON.stringify({
    topic: 'notification', title: 'Household reminder', urgency: 'critical',
    metadata: { id: 'household-reminder' },
  }));
  const reminder = page.getByText('Amy’s plan is due', { exact: true });
  const action = page.getByRole('button', { name: amyAction.label, exact: true });
  const household = page.getByText('Household reminder', { exact: true });
  await expect(reminder).toBeVisible();
  await expect(action).toBeVisible();
  await expect(household).toBeVisible();
  await switchMember('BOB');
  const plan = page.getByText('bob marker', { exact: true });
  await expect(plan).toBeVisible();
  await expect(reminder).toHaveCount(0);
  await expect(action).toHaveCount(0);
  await expect(household).toBeVisible();
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

  await switchMember('AMY');
  await expect(page.getByText('amy marker', { exact: true })).toBeVisible();
  socket.send(JSON.stringify(amyNotification));
  socket.send(JSON.stringify({
    ...amyNotification, title: 'New Amy reminder', body: 'Amy has a new task',
    metadata: { id: 'amy-new-reminder', username: 'amy' },
  }));
  await expect(page.getByText('Amy has a new task', { exact: true })).toBeVisible();
  await expect(reminder).toHaveCount(0);
  await expect(page.getByText('bob recipient', { exact: true })).toHaveCount(0);
  await expect(household).toBeVisible();
  await page.reload();
  await expect(page.getByText('amy marker', { exact: true })).toBeVisible();
  await expect(switcher).toHaveValue('AMY');
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
  await expect(page.getByRole('alert')).toContainText('Goals', { timeout: 10_000 });
  await expect(page.getByText(/No goals yet/)).toHaveCount(0);
  recovered = true;
  await page.getByRole('button', { name: 'Retry' }).click();
  await expect(page.getByText(/No goals yet/)).toBeVisible();
});

test('Life keeps frame controls reachable beside an in-flow notice stack', async ({ page }) => {
  const members = ['amy', 'bob'].map(username => ({ username, displayName: username.toUpperCase() }));
  let socket;
  await page.routeWebSocket('**/*', connection => { socket = connection; });
  await page.route('**/api/v1/life/**', route => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith('/users')) return route.fulfill({ json: { users: members } });
    if (url.pathname.endsWith('/user')) return route.fulfill({ json: members.find(user => user.username === url.searchParams.get('username')) || members[0] });
    if (url.pathname.endsWith('/goals')) return route.fulfill({ json: { goals: [] } });
    return route.fulfill({ json: { purpose: { statement: 'Household plan' } } });
  });
  await page.goto('/life/plan');
  const header = page.getByRole('banner');
  const main = page.getByRole('main');
  const switcher = page.getByRole('textbox', { name: 'Switch household member' });
  await expect(switcher).toHaveValue('AMY');
  await expect.poll(() => Boolean(socket)).toBe(true);
  const emptyGap = async () => {
    const [mainBox, headerBox] = await Promise.all([main.boundingBox(), header.boundingBox()]);
    return Math.round(mainBox.y - headerBox.y - headerBox.height);
  };
  expect(await emptyGap()).toBe(0);

  socket.send(JSON.stringify({
    topic: 'notification', title: 'Household planning reminder', urgency: 'critical',
    body: 'Review the household goals before the next planning meeting.',
    metadata: { id: 'notice-slot-first' },
    actions: [{ label: 'Open Goals', data: { url: '/life/plan/goals' } }],
  }));
  const notice = page.locator('.mantine-Notification-root').filter({ hasText: 'Household planning reminder' });
  await expect(notice).toBeVisible();
  expect(await switcher.evaluate(input => {
    const box = input.getBoundingClientRect();
    return document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2) === input;
  })).toBe(true);
  await switcher.click();
  await page.getByRole('option', { name: 'BOB', exact: true }).click();
  await expect(switcher).toHaveValue('BOB');
  await notice.getByRole('button', { name: 'Open Goals', exact: true }).click();
  await expect(page).toHaveURL(/\/life\/plan\/goals$/);
  await expect(page.getByRole('link', { name: 'Goals', exact: true })).toHaveAttribute('aria-current', 'page');

  for (const width of [767, 768, 1280]) {
    await page.setViewportSize({ width, height: 550 });
    const alertBox = await notice.boundingBox();
    const headerBox = await header.boundingBox();
    const mainBox = await main.boundingBox();
    expect(alertBox.y).toBeGreaterThanOrEqual(Math.floor(headerBox.y + headerBox.height));
    expect(alertBox.y + alertBox.height).toBeLessThanOrEqual(mainBox.y + 1);
  }

  await page.setViewportSize({ width: 390, height: 340 });
  for (const id of ['second', 'third', 'fourth', 'fifth']) {
    socket.send(JSON.stringify({
      topic: 'notification', title: `Additional notice ${id}`, urgency: 'critical',
      body: 'An update that wraps across more than one line on a compact screen.',
      metadata: { id: `notice-slot-${id}` },
    }));
  }
  await expect(page.getByText('Additional notice fifth', { exact: true })).toBeAttached();
  const notices = notice.locator('xpath=ancestor::div[contains(@class,"ds-chrome__notices")]');
  await expect.poll(() => notices.evaluate(el => el.scrollHeight > el.clientHeight)).toBe(true);
  const mainTop = (await main.boundingBox()).y;
  await notices.evaluate(el => { el.scrollTop = el.scrollHeight; });
  await expect.poll(() => notices.evaluate(el => el.scrollTop)).toBeGreaterThan(0);
  expect((await main.boundingBox()).y).toBe(mainTop);
  await expect(page.getByRole('navigation', { name: 'Primary' }).getByRole('link', { name: 'Now', exact: true })).toBeInViewport();
  await expect(main).toBeInViewport();
  const stack = page.locator('.mantine-Notification-root');
  for (let remaining = 5; remaining > 0; remaining -= 1) {
    await stack.first().locator('button.mantine-Notification-closeButton').click();
    await expect(stack).toHaveCount(remaining - 1);
  }
  await expect.poll(emptyGap).toBe(0);
});

test.describe('Life Plan on a narrow touch screen', () => {
  test.use({ hasTouch: true, viewport: { width: 320, height: 600 } });

  test('keeps each section link reachable and reports the selected page', async ({ page }) => {
    const member = { username: 'amy', displayName: 'Amy' };
    await page.routeWebSocket('**/ws', () => {});
    await page.route('**/api/v1/life/**', route => {
      const path = new URL(route.request().url()).pathname;
      if (path.endsWith('/users')) return route.fulfill({ json: { users: [member] } });
      if (path.endsWith('/user')) return route.fulfill({ json: member });
      return route.fulfill({ json: {} });
    });

    await page.goto('/life/plan');
    const plan = page.getByRole('navigation', { name: 'Plan sections' });
    await expect(plan.getByRole('link', { name: 'Purpose' })).toHaveAttribute('aria-current', 'page');
    expect(await page.evaluate(() => matchMedia('(pointer: coarse)').matches)).toBe(true);
    const sectionTargets = await plan.getByRole('link').evaluateAll(links => links.map(link => {
      const { left, right, width, height } = link.getBoundingClientRect();
      return { name: link.textContent, withinViewport: left >= 0 && right <= innerWidth, largeEnough: width >= 44 && height >= 44 };
    }));
    expect(sectionTargets).toEqual(['Purpose', 'Goals', 'Beliefs', 'Values', 'Qualities', 'Ceremonies'].map(name => ({
      name, withinViewport: true, largeEnough: true,
    })));

    const ceremonies = plan.getByRole('link', { name: 'Ceremonies' });
    await ceremonies.tap({ position: { x: 30, y: 39 }, timeout: 5_000 });
    await expect(page).toHaveURL(/\/life\/plan\/ceremonies$/);
    await expect(ceremonies).toHaveAttribute('aria-current', 'page');
    await expect(plan.locator('[aria-current="page"]')).toHaveCount(1);
  });
});

for (const width of [390, 1440]) {
  test.describe(`Life Purpose at ${width}px`, () => {
    test.use({ hasTouch: width === 390, viewport: { width, height: 850 } });

    test('hands keyboard focus between the inline editor and its trigger', async ({ page }) => {
      await page.routeWebSocket('**/*', () => {});
      const member = { username: 'amy', displayName: 'Amy' };
      const statement = 'Make time to learn something new.';
      const writes = [];
      await page.route('**/api/v1/life/**', route => {
        const request = route.request();
        const { pathname } = new URL(request.url());
        if (pathname === '/api/v1/life/users') return route.fulfill({ json: { users: [member] } });
        if (pathname === '/api/v1/life/user') return route.fulfill({ json: member });
        if (pathname === '/api/v1/life/plan/') return route.fulfill({ json: { purpose: { statement } } });
        if (pathname === '/api/v1/life/plan/purpose' && request.method() === 'POST') {
          writes.push(request.postDataJSON());
          return route.fulfill({ status: 500, json: { error: 'Purpose was not saved' } });
        }
        return route.fallback();
      });
      await page.goto('/life/plan');

      const edit = page.getByRole('button', { name: 'Edit purpose', exact: true });
      const draft = page.getByRole('textbox', { name: 'Purpose statement' });
      const save = page.getByRole('button', { name: 'Save', exact: true });
      const cancel = page.getByRole('button', { name: 'Cancel', exact: true });
      const checkTouchTarget = async control => {
        await expect(control).toBeVisible();
        const box = await control.boundingBox();
        expect.soft(box.width).toBeGreaterThanOrEqual(44);
        expect.soft(box.height).toBeGreaterThanOrEqual(44);
      };

      if (width === 390) {
        expect(await page.evaluate(() => matchMedia('(pointer: coarse)').matches)).toBe(true);
        await checkTouchTarget(edit);
      }
      await edit.press('Enter');
      await expect.soft(draft).toBeFocused({ timeout: 1_000 });
      if (width === 390) {
        await checkTouchTarget(save);
        await checkTouchTarget(cancel);
      }
      await draft.fill('A draft to discard');
      await cancel.press('Enter');
      await expect.soft(edit).toBeFocused({ timeout: 1_000 });
      await expect(page.getByText(statement, { exact: true })).toBeVisible();
      expect(writes).toEqual([]);

      await edit.press('Enter');
      await expect(draft).toHaveValue(statement);
      await draft.fill('Keep this draft after a refused save');
      await save.press('Enter');
      await expect(page.getByRole('alert').filter({ hasText: 'Purpose was not saved' })).toBeVisible();
      await expect(draft).toHaveValue('Keep this draft after a refused save');
      await expect(save).toBeFocused({ timeout: 1_000 });
      expect(writes).toEqual([{ statement: 'Keep this draft after a refused save' }]);
    });
  });
}

for (const focusDestination of ['the opener', 'navigation', 'another member’s editor']) {
  test(`Life Purpose leaves focus on ${focusDestination} after a pending save`, async ({ page }) => {
    await page.routeWebSocket('**/*', () => {});
    const members = [{ username: 'amy', displayName: 'Amy' }, { username: 'bob', displayName: 'Bob' }];
    const saved = 'Make time to learn something new.';
    const submitted = Promise.withResolvers();
    const release = Promise.withResolvers();
    const writes = [];
    let committed = false;

    await page.route('**/api/v1/life/**', async route => {
      const request = route.request();
      const { pathname, searchParams } = new URL(request.url());
      if (pathname === '/api/v1/life/users') return route.fulfill({ json: { users: members } });
      if (pathname === '/api/v1/life/user') {
        return route.fulfill({ json: members.find(member => member.username === searchParams.get('username')) ?? members[0] });
      }
      if (pathname === '/api/v1/life/plan/') {
        const statement = searchParams.get('username') === 'bob' ? 'Bob’s purpose' : committed ? saved : 'Earlier purpose';
        return route.fulfill({ json: { purpose: { statement } } });
      }
      if (pathname === '/api/v1/life/plan/purpose' && request.method() === 'POST') {
        writes.push({ username: searchParams.get('username'), ...request.postDataJSON() });
        submitted.resolve();
        await release.promise;
        committed = true;
        return route.fulfill({ json: { statement: saved } });
      }
      return route.fallback();
    });

    await page.goto('/life/plan');
    const edit = page.getByRole('button', { name: 'Edit purpose', exact: true });
    const purposeLink = page.getByRole('navigation', { name: 'Plan sections' }).getByRole('link', { name: 'Purpose' });
    const draft = page.getByRole('textbox', { name: 'Purpose statement' });
    await edit.press('Enter');
    await draft.fill(saved);
    const save = page.getByRole('button', { name: 'Save', exact: true });
    const response = page.waitForResponse(res => new URL(res.url()).pathname.endsWith('/plan/purpose'));
    try {
      await save.press('Enter');
      await submitted.promise;
      await save.press('Enter');
      if (focusDestination === 'navigation') {
        await purposeLink.focus();
      } else if (focusDestination === 'another member’s editor') {
        const switcher = page.getByRole('textbox', { name: 'Switch household member' });
        await switcher.click();
        await page.getByRole('option', { name: 'Bob', exact: true }).click();
        await expect(page.getByText('Bob’s purpose', { exact: true })).toBeVisible();
        await edit.press('Enter');
        await draft.fill('Bob’s unsaved draft');
      }
    } finally {
      release.resolve();
    }
    await (await response).finished();
    if (focusDestination === 'another member’s editor') {
      await expect(draft).toHaveValue('Bob’s unsaved draft');
      await expect(draft).toBeFocused();
    } else {
      await expect(page.getByText(saved, { exact: true })).toBeVisible();
      await expect(focusDestination === 'the opener' ? edit : purposeLink).toBeFocused();
    }
    expect(writes).toEqual([{ username: 'amy', statement: saved }]);
  });
}

for (const moveFocus of [false, true]) {
  test(`Life Purpose ${moveFocus ? 'keeps navigation focus' : 'restores the opener'} after cancelling during readback`, async ({ page }) => {
    await page.routeWebSocket('**/*', () => {});
    const member = { username: 'amy', displayName: 'Amy' };
    const saved = 'Make time to learn something new.';
    const reading = Promise.withResolvers();
    const release = Promise.withResolvers();
    const writes = [];

    await page.route('**/api/v1/life/**', async route => {
      const request = route.request();
      const { pathname } = new URL(request.url());
      if (pathname === '/api/v1/life/users') return route.fulfill({ json: { users: [member] } });
      if (pathname === '/api/v1/life/user') return route.fulfill({ json: member });
      if (pathname === '/api/v1/life/plan/purpose' && request.method() === 'POST') {
        writes.push(request.postDataJSON());
        return route.fulfill({ json: { statement: saved } });
      }
      if (pathname === '/api/v1/life/plan/') {
        if (writes.length === 0) {
          return route.fulfill({ json: { purpose: { statement: 'Earlier purpose' } } });
        }
        reading.resolve();
        await release.promise;
        return route.fulfill({ json: { purpose: { statement: saved } } });
      }
      return route.fallback();
    });

    await page.goto('/life/plan');
    const edit = page.getByRole('button', { name: 'Edit purpose', exact: true });
    const draft = page.getByRole('textbox', { name: 'Purpose statement' });
    const purposeLink = page.getByRole('navigation', { name: 'Plan sections' }).getByRole('link', { name: 'Purpose' });
    await edit.press('Enter');
    await draft.fill(saved);
    try {
      await page.getByRole('button', { name: 'Save', exact: true }).press('Enter');
      await reading.promise;
      await page.getByRole('button', { name: 'Cancel', exact: true }).press('Enter');
      await expect(draft).toHaveCount(0);
      await expect(edit).toHaveCount(0);
      if (moveFocus) {
        await purposeLink.focus();
        await expect(purposeLink).toBeFocused();
      }
    } finally {
      release.resolve();
    }
    await expect(page.getByText(saved, { exact: true })).toBeVisible();
    await expect(moveFocus ? purposeLink : edit).toBeFocused();
    expect(writes).toEqual([{ statement: saved }]);
  });
}

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

test('Life goal detail reads its selected goal and keeps a refused transition retryable', async ({ page }) => {
  const member = { username: 'amy', displayName: 'Amy' };
  const requests = [];
  const release = Promise.withResolvers();
  const entered = Promise.withResolvers();
  let state = 'ready';
  let writes = 0;
  let failDetail = false;
  await page.routeWebSocket('**/*', () => {});
  await page.route('**/api/v1/life/**', async route => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.pathname.endsWith('/users')) return route.fulfill({ json: { users: [member] } });
    if (url.pathname.endsWith('/user')) return route.fulfill({ json: member });
    if (!url.pathname.includes('/life/plan/')) return route.fulfill({ json: {} });
    requests.push([request.method(), url.pathname, url.searchParams.get('username')]);
    if (url.pathname.endsWith('/transition')) {
      writes++;
      if (writes === 1) {
        entered.resolve();
        await release.promise;
        return route.fulfill({ status: 400, json: { error: 'Transition refused' } });
      }
      state = request.postDataJSON().state;
      failDetail = true;
      return route.fulfill({ json: { id: 'practice', name: 'Practice goal', state } });
    }
    if (url.pathname.endsWith('/practice')) {
      if (failDetail) {
        failDetail = false;
        return route.fulfill({ status: 400, json: { error: 'Goal temporarily unavailable' } });
      }
      return route.fulfill({ json: { id: 'practice', name: 'Practice goal', state } });
    }
    return route.fulfill({ json: { goals: [] } });
  });
  await page.goto('/life/plan/goals/practice');
  await expect(page.getByRole('heading', { name: 'Practice goal' })).toBeVisible();
  const select = page.getByPlaceholder('New state');
  const transition = page.getByRole('button', { name: 'Transition', exact: true });
  await select.click();
  await page.getByRole('option', { name: 'committed' }).click();
  await transition.click();
  await entered.promise;
  await expect(transition).toBeDisabled();
  await expect(select).toBeDisabled();
  release.resolve();
  await expect(page.getByRole('alert')).toContainText(/refused|400/i);
  await expect(select).toHaveValue('committed');
  await transition.click();
  await expect(page.getByRole('alert')).toContainText('Goal');
  await page.getByRole('button', { name: 'Retry' }).click();
  await expect(page.getByText('committed', { exact: true })).toBeVisible();
  expect(writes).toBe(2);
  expect(requests.every(([, path, user]) => path.includes('/goals/practice') && user === 'amy')).toBe(true);
});

for (const { owner, draft } of [
  { owner: 'bob', draft: 'considered' },
  { owner: 'amy', draft: 'considered' },
  { owner: 'amy', draft: 'committed' },
]) {
  test(`Life keeps the transition draft with ${owner} when a late write settles against ${draft}`, async ({ page }) => {
    const users = ['amy', 'bob'].map(username => ({ username, displayName: username.toUpperCase() }));
    const reads = [];
    const writes = [];
    const entered = Promise.withResolvers();
    const release = Promise.withResolvers();
    let committed = false;
    let socket;
    await page.routeWebSocket('**/*', connection => { socket = connection; });
    await page.route('**/api/v1/life/**', async route => {
      const request = route.request();
      const url = new URL(request.url());
      const user = url.searchParams.get('username');
      if (url.pathname.endsWith('/users')) return route.fulfill({ json: { users } });
      if (url.pathname.endsWith('/user')) return route.fulfill({ json: users.find(member => member.username === user) || users[0] });
      if (url.pathname.endsWith('/transition')) {
        writes.push([user, url.pathname, request.postDataJSON().state]);
        entered.resolve();
        await release.promise;
        committed = true;
        return route.fulfill({ json: { state: 'committed' } });
      }
      const goal = url.pathname.split('/').at(-1);
      reads.push([user, goal]);
      return route.fulfill({ json: { id: goal, name: user + ' ' + goal, state: user === 'amy' && goal === 'second' && committed ? 'committed' : 'ready' } });
    });
    await page.goto('/life/plan/goals/first');
    await expect(page.getByRole('heading', { name: 'amy first' })).toBeVisible();
    const select = page.getByPlaceholder('New state');
    const choose = async state => {
      await select.click();
      await page.getByRole('option', { name: state, exact: true }).click();
    };
    await choose('achieved');
    await expect.poll(() => Boolean(socket)).toBe(true);
    socket.send(JSON.stringify({ topic: 'notification', title: 'Second goal', urgency: 'critical',
      metadata: { id: 'next-goal', username: 'amy' },
      actions: [{ label: 'View second goal', data: { url: '/life/plan/goals/second' } }],
    }));
    await page.getByRole('button', { name: 'View second goal' }).click();
    await expect(page.getByRole('heading', { name: 'amy second' })).toBeVisible();
    await expect(select).toHaveValue('');
    await choose('committed');
    await page.getByRole('button', { name: 'Transition', exact: true }).click();
    await entered.promise;
    const switcher = page.getByRole('textbox', { name: 'Switch household member' });
    await switcher.click();
    await page.getByRole('option', { name: 'BOB' }).click();
    await expect(page.getByRole('heading', { name: 'bob second' })).toBeVisible();
    if (owner === 'amy') {
      await switcher.click();
      await page.getByRole('option', { name: 'AMY' }).click();
      await expect(page.getByRole('heading', { name: 'amy second' })).toBeVisible();
    }
    await choose(draft);
    const response = page.waitForResponse(res => new URL(res.url()).pathname.endsWith('/transition'));
    release.resolve();
    await (await response).finished();
    const transition = page.getByRole('button', { name: 'Transition', exact: true });
    const expectedReads = [['amy', 'first'], ['amy', 'second'], ['bob', 'second']];
    if (owner === 'amy') {
      await expect(page.getByText('committed', { exact: true })).toBeVisible();
      expectedReads.push(['amy', 'second'], ['amy', 'second']);
    }
    if (draft === 'committed') {
      await expect(select).toHaveValue('');
      await expect(transition).toBeDisabled();
      await choose('considered');
      await expect(transition).toBeEnabled();
    } else {
      await expect(select).toHaveValue(draft);
      await expect(transition).toBeEnabled();
    }
    expect(reads).toEqual(expectedReads);
    expect(writes).toEqual([['amy', '/api/v1/life/plan/goals/second/transition', 'committed']]);
  });
}
