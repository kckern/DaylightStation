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
