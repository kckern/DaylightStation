import { expect, test } from '@playwright/test';

test.use({ serviceWorkers: 'block' });

const vehicles = { vehicles: [{ id: 'sample', label: 'Sample car' }] };
const overview = { odometer: { km: 160 }, fuel: { needsMoreData: true, fillCount: 0 }, reminders: [] };
const cases = [
  { label: 'Garage', path: '/vehicles', width: 390, response: vehicles, result: 'Odometer' },
  { label: 'Vehicle', path: '/vehicles/sample', tab: 'Car', width: 1440, response: overview, result: 'Odometer' },
  { label: 'Drives', path: '/vehicles/sample/journeys', tab: 'Drives', width: 390,
    response: { journeys: [{ id: 'river', title: 'Drive to the river', stops: [] }] }, result: 'Drive to the river' },
  { label: 'Service history', path: '/vehicles/sample/service', tab: 'Service', width: 1440,
    response: { records: [{ id: 'repair', date: '2026-11-01', type: 'other', vendor: 'Fixture garage' }] }, result: 'Fixture garage' },
  { label: 'Documents', path: '/vehicles/sample/documents', tab: 'Docs', width: 390,
    response: { documents: [{ id: 'insurance', kind: 'Insurance', label: 'Proof of insurance', file: 'proof.pdf' }] },
    result: 'Proof of insurance' },
];

for (const { label, path, tab, width, response, result } of cases) {
  test(`Auto ${label} keeps keyboard focus through read recovery`, async ({ page }) => {
    await page.setViewportSize({ width, height: 850 });
    await page.routeWebSocket('**/*', () => {});
    const reads = [];
    const pending = Promise.withResolvers();
    await page.route('**/api/**', async route => {
      const request = route.request();
      const { pathname } = new URL(request.url());
      if (pathname === '/api/v1/automotive' + path) {
        if (reads.push(request.method()) === 1) {
          return route.fulfill({ status: 409, json: { error: 'Temporarily unavailable' } });
        }
        await pending.promise;
        return route.fulfill({ json: response });
      }
      const json = pathname.endsWith('/supervision/bootstrap') ? { enabled: false }
        : pathname.endsWith('/vehicles') ? vehicles
        : pathname.endsWith('/vehicles/sample') ? overview : {};
      return route.fulfill({ json });
    });

    await page.goto('/auto');
    const tabButton = tab ? page.getByRole('button', { name: tab, exact: true }) : null;
    if (tabButton) await tabButton.press('Enter');
    const main = page.getByRole('main');
    const garageMain = label === 'Garage' ? await main.elementHandle() : null;
    const region = main.getByRole('region', { name: label, exact: true });
    try {
      await main.getByRole('button', { name: 'Retry', exact: true }).press('Enter');
      await expect.poll(() => reads).toEqual(['GET', 'GET']);
      await expect(region).toBeFocused();
      await expect(region).toHaveAttribute('aria-busy', 'true');
      if (tab === 'Docs') await tabButton.focus();
    } finally {
      pending.resolve();
    }

    await expect(main.getByText(result, { exact: true })).toBeVisible();
    const recovered = main.getByRole('region', { name: label === 'Garage' ? 'Vehicle' : label, exact: true });
    await expect(recovered).not.toHaveAttribute('aria-busy', 'true');
    await expect(tab === 'Docs' ? tabButton : recovered).toBeFocused();
    await expect(main).toHaveCount(1);
    if (garageMain) {
      expect(await main.evaluate((current, original) => current === original, garageMain)).toBe(true);
    }
    expect(reads).toEqual(['GET', 'GET']);
  });
}

async function openCar(page, { responses = {}, held = [] } = {}) {
  const requests = [];
  await page.routeWebSocket('**/*', () => {});
  await page.route('**/api/**', route => {
    const request = route.request();
    const { pathname, search } = new URL(request.url());
    const root = '/api/v1/automotive';
    if (!pathname.startsWith(root + '/')) {
      return route.fulfill({ json: pathname.endsWith('/supervision/bootstrap') ? { enabled: false } : {} });
    }
    const path = pathname.slice(root.length) + search;
    requests.push({ path, request, route });
    if (held.includes(path)) return;
    const json = path === '/vehicles' ? vehicles : path === '/vehicles/sample' ? overview : responses[path] ?? {};
    return route.fulfill({ json });
  });
  await page.goto('/auto');
  await expect(page.getByRole('button', { name: 'Car', exact: true })).toHaveAttribute('aria-current', 'page');
  await expect(page.getByText('Odometer', { exact: true })).toBeVisible();
  return requests;
}

test('Auto reads the active views and shares the pending fuel read between Drives and Fuel', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 850 });
  const car = '/vehicles/sample';
  const fuel = car + '/fuel';
  const journeys = car + '/journeys';
  const service = car + '/service';
  const requests = await openCar(page, {
    held: [fuel],
    responses: {
      [journeys]: { journeys: [{ id: 'river', title: 'Drive to the river', stops: [] }] },
      [service]: { records: [{ id: 'repair', date: '2026-11-01', type: 'fixture', vendor: 'Fixture garage' }] },
      '/service-types': { types: [{ value: 'fixture', label: 'Custom inspection' }] },
    },
  });
  const reads = () => requests.map(({ path }) => path).sort();
  const tab = name => page.getByRole('button', { name, exact: true });
  const overviewReads = ['/vehicles', car];
  expect(reads()).toEqual(overviewReads);

  await tab('Drives').press('Enter');
  await expect(page.getByText('Drive to the river', { exact: true })).toBeVisible();
  const driveReads = [...overviewReads, fuel, journeys].sort();
  await expect.poll(reads).toEqual(driveReads);
  const fuelRead = requests.find(entry => entry.path === fuel);
  await tab('Fuel').press('Enter');
  await expect(page.getByRole('region', { name: 'Fill-ups', exact: true })).toHaveAttribute('aria-busy', 'true');
  expect(reads()).toEqual(driveReads);
  expect(fuelRead.request.failure()).toBeNull();
  await fuelRead.route.fulfill({ json: { logs: [{ id: 'fill', date: '2026-11-02', price_total: 24 }] } });
  await expect(page.getByText('$24.00', { exact: true })).toBeVisible();

  await tab('Service').press('Enter');
  await expect(page.getByText('Fixture garage', { exact: true })).toBeVisible();
  await expect(page.getByText('Custom inspection', { exact: true })).toBeVisible();
  expect(reads()).toEqual([...driveReads, '/service-types', service].sort());
  expect(requests.map(({ request }) => request.method())).toEqual(Array(6).fill('GET'));
});

test('Auto retires a departed Docs read and keeps accepted documents through the next refresh', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 850 });
  const car = '/vehicles/sample';
  const documents = car + '/documents';
  const requests = await openCar(page, { held: [documents] });
  const documentReads = () => requests.filter(({ path }) => path === documents);
  const carTab = page.getByRole('button', { name: 'Car', exact: true });
  const docs = page.getByRole('button', { name: 'Docs', exact: true });
  const region = page.getByRole('region', { name: 'Documents', exact: true });
  const doc = (label, file) => ({ documents: [{ id: 'insurance', kind: 'Insurance', label, file }] });
  await docs.press('Enter');
  await expect(page.getByLabel('Loading documents')).toBeVisible();
  await expect.poll(() => documentReads().length).toBe(1);
  const [departed] = documentReads();
  await carTab.press('Enter');
  await expect(carTab).toHaveAttribute('aria-current', 'page');
  await expect.poll(() => departed.request.failure(), { timeout: 2_000 }).not.toBeNull();

  await docs.press('Enter');
  await expect.poll(() => documentReads().length).toBe(2);
  await documentReads()[1].route.fulfill({ json: doc('Current proof', 'current.pdf') });
  const current = region.getByRole('link', { name: /Current proof/ });
  await expect(current).toHaveAttribute('href', '/api/v1/automotive/files/current.pdf');
  await departed.route.fulfill({ json: doc('Superseded proof', 'old.pdf') }).catch(error => {
    if (!departed.request.failure()) throw error;
  });
  await expect(current).toBeVisible();
  await expect(region.getByRole('link', { name: /Superseded proof/ })).toHaveCount(0);

  await carTab.press('Enter');
  await docs.press('Enter');
  await expect.poll(() => documentReads().length).toBe(3);
  await expect(region).toHaveAttribute('aria-busy', 'true');
  await expect(current).toBeVisible();
  await expect(docs).toBeFocused();
  await documentReads()[2].route.fulfill({ json: doc('Renewed proof', 'renewed.pdf') });
  await expect(region.getByRole('link', { name: /Renewed proof/ })).toBeVisible();
  await expect(region).not.toHaveAttribute('aria-busy', 'true');
  await expect(docs).toBeFocused();
  expect(requests.map(({ path, request }) => [request.method(), path])).toEqual([
    ['GET', '/vehicles'], ['GET', car], ['GET', documents], ['GET', documents], ['GET', documents],
  ]);
});

test('Auto treats a completed no-content Docs read as empty', async ({ page }) => {
  const documents = '/vehicles/sample/documents';
  const requests = await openCar(page, { held: [documents] });
  await page.getByRole('button', { name: 'Docs', exact: true }).press('Enter');
  const region = page.getByRole('region', { name: 'Documents', exact: true });
  await expect(region.getByLabel('Loading documents')).toBeVisible();
  await expect.poll(() => requests.filter(({ path }) => path === documents).length).toBe(1);
  await requests.find(({ path }) => path === documents).route.fulfill({ status: 204 });
  await expect(region.getByText('Glove box is empty', { exact: true })).toBeVisible();
  await expect(region).not.toHaveAttribute('aria-busy', 'true');
});

for (const view of [
  { tab: 'Docs', primaryPath: '/vehicles/sample/documents', primary: { documents: [
    { id: 'insurance', kind: 'Insurance', label: 'Proof of insurance', file: 'proof.pdf', expires: '2026-11-17' },
  ] } },
  { tab: 'Service', primaryPath: '/vehicles/sample/service', primary: {
    records: [{ id: 'repair', date: '2026-11-01', type: 'other', vendor: 'Fixture garage' }],
  } },
]) {
  test(`Auto ${view.tab} keeps primary records available and retries only vehicle reminders`, async ({ page }) => {
    const root = '/api/v1/automotive';
    const overviewPath = `${root}/vehicles/sample`;
    const primaryReads = [];
    const overviewReads = [];
    const writes = [];
    const retryResponse = Promise.withResolvers();
    let overviewPhase = 'holding';
    const overdueReminders = [
      { id: 'insurance-expiry', kind: 'document', sourceId: 'insurance', status: 'overdue', daysUntilDue: -3 },
      { id: 'oil-change', kind: 'service', status: 'overdue', daysUntilDue: -4, label: 'Oil change' },
    ];
    await page.routeWebSocket('**/*', () => {});
    await page.route('**/api/**', async route => {
      const request = route.request();
      const { pathname } = new URL(request.url());
      if (request.method() !== 'GET') writes.push(request.method());
      if (pathname.endsWith('/supervision/bootstrap')) return route.fulfill({ json: { enabled: false } });
      if (pathname === `${root}/vehicles`) return route.fulfill({ json: vehicles });
      if (pathname === overviewPath) {
        overviewReads.push(route);
        if (overviewPhase !== 'retrying') return;
        await retryResponse.promise;
        return route.fulfill({ json: { ...overview, reminders: overdueReminders } });
      }
      if (pathname === `${root}${view.primaryPath}`) {
        primaryReads.push(request.method());
        return route.fulfill({ json: view.primary });
      }
      if (pathname === `${root}/service-types`) return route.fulfill({ json: { types: [] } });
      return route.fulfill({ json: {} });
    });

    await page.goto('/auto');
    await page.getByRole('button', { name: view.tab, exact: true }).press('Enter');
    const main = page.getByRole('main');
    if (view.tab === 'Docs') {
      const doc = main.getByRole('link', { name: /Proof of insurance/ });
      await expect(doc).toBeVisible();
      await expect(doc).toContainText(/Expiry date/);
    } else {
      await expect(main.getByText('Fixture garage', { exact: true })).toBeVisible();
      await expect(main.getByText('Coming up', { exact: true })).toHaveCount(0);
    }

    overviewPhase = 'rejected';
    await Promise.all(overviewReads.map(route => route.fulfill({ status: 409, json: { error: 'Vehicle reminders unavailable' } })));
    const status = main.getByRole('region', { name: 'Vehicle reminder status', exact: true });
    const retry = status.getByRole('button', { name: 'Retry', exact: true });
    await expect(status.getByRole('alert')).toContainText('Vehicle reminders unavailable');
    if (view.tab === 'Docs') {
      const doc = main.getByRole('link', { name: /Proof of insurance/ });
      await expect(doc).toBeVisible();
      await expect(doc).toContainText(/Expiry date/);
    } else {
      await expect(main.getByText('Fixture garage', { exact: true })).toBeVisible();
    }

    const overviewReadsBeforeRetry = overviewReads.length;
    overviewPhase = 'retrying';
    await retry.press('Enter');
    await expect.poll(() => overviewReads.length).toBe(overviewReadsBeforeRetry + 1);
    await expect(status).toBeFocused();
    await expect(status).toHaveAttribute('aria-busy', 'true');
    retryResponse.resolve();
    await expect(status).not.toHaveAttribute('aria-busy', 'true');
    await expect(status).toBeFocused();
    if (view.tab === 'Docs') {
      const doc = main.getByRole('link', { name: /Proof of insurance/ });
      await expect(doc).toContainText(/Expired/);
      await expect(doc).toHaveAttribute('href', '/api/v1/automotive/files/proof.pdf');
    } else {
      await expect(main.getByText('Fixture garage', { exact: true })).toBeVisible();
      await expect(main.getByText('Coming up', { exact: true })).toBeVisible();
      await expect(main.getByText('4d overdue', { exact: true })).toBeVisible();
    }
    expect(overviewReads.every(item => item.request().method() === 'GET')).toBe(true);
    expect(primaryReads).toEqual(['GET']);
    expect(writes).toEqual([]);
  });
}

test('Auto Docs offers retry for an empty overview response and accepts a valid empty reminder list', async ({ page }) => {
  const root = '/api/v1/automotive';
  const overviewReads = [];
  const invalidRetry = Promise.withResolvers();
  const validRetry = Promise.withResolvers();
  await page.routeWebSocket('**/*', () => {});
  await page.route('**/api/**', async route => {
    const request = route.request();
    const { pathname } = new URL(request.url());
    if (pathname.endsWith('/supervision/bootstrap')) return route.fulfill({ json: { enabled: false } });
    if (pathname === `${root}/vehicles`) return route.fulfill({ json: vehicles });
    if (pathname === `${root}/vehicles/sample`) {
      overviewReads.push(request);
      if (overviewReads.length === 1) return route.fulfill({ status: 204 });
      if (overviewReads.length === 2) {
        await invalidRetry.promise;
        return route.fulfill({ json: { ...overview, reminders: {} } });
      }
      await validRetry.promise;
      return route.fulfill({ json: { ...overview, reminders: [] } });
    }
    if (pathname === `${root}/vehicles/sample/documents`) {
      return route.fulfill({ json: { documents: [
        { id: 'insurance', kind: 'Insurance', label: 'Proof of insurance', file: 'proof.pdf', expires: '2026-11-17' },
      ] } });
    }
    return route.fulfill({ json: {} });
  });

  await page.goto('/auto');
  await page.getByRole('button', { name: 'Docs', exact: true }).press('Enter');
  const main = page.getByRole('main');
  const doc = main.getByRole('link', { name: /Proof of insurance/ });
  const status = main.getByRole('region', { name: 'Vehicle reminder status', exact: true });
  await expect(doc).toContainText(/Expiry date/);
  await expect(status.getByRole('alert')).toBeVisible();
  const retry = status.getByRole('button', { name: 'Retry', exact: true });
  await retry.press('Enter');
  await expect.poll(() => overviewReads.length).toBe(2);
  await expect(status).toBeFocused();
  await expect(status).toHaveAttribute('aria-busy', 'true');
  invalidRetry.resolve();
  await expect(status.getByRole('alert')).toBeVisible();
  await expect(doc).toContainText(/Expiry date/);

  await status.getByRole('button', { name: 'Retry', exact: true }).press('Enter');
  await expect.poll(() => overviewReads.length).toBe(3);
  await expect(status).toBeFocused();
  await expect(status).toHaveAttribute('aria-busy', 'true');
  validRetry.resolve();
  await expect(status).not.toHaveAttribute('aria-busy', 'true');
  await expect(status.getByRole('alert')).toHaveCount(0);
  await expect(doc).toContainText(/Expiry date/);
  expect(overviewReads.map(request => request.method())).toEqual(['GET', 'GET', 'GET']);
});

test('Auto Car retries a malformed reminder list without hiding the vehicle overview', async ({ page }) => {
  const root = '/api/v1/automotive';
  const overviewReads = [];
  const retryPending = Promise.withResolvers();
  await page.routeWebSocket('**/*', () => {});
  await page.route('**/api/**', async route => {
    const request = route.request();
    const { pathname } = new URL(request.url());
    if (pathname.endsWith('/supervision/bootstrap')) return route.fulfill({ json: { enabled: false } });
    if (pathname === `${root}/vehicles`) return route.fulfill({ json: vehicles });
    if (pathname === `${root}/vehicles/sample`) {
      overviewReads.push(request);
      if (overviewReads.length === 1) return route.fulfill({ json: { ...overview, reminders: {} } });
      await retryPending.promise;
      return route.fulfill({ json: { ...overview, reminders: [
        { id: 'oil-change', kind: 'service', label: 'Oil change', status: 'overdue', daysUntilDue: -4 },
      ] } });
    }
    return route.fulfill({ json: {} });
  });

  await page.goto('/auto');
  const main = page.getByRole('main');
  const status = main.getByRole('region', { name: 'Vehicle reminder status', exact: true });
  await expect(main.getByText('Odometer', { exact: true })).toBeVisible();
  await expect(status.getByRole('alert')).toBeVisible();
  await status.getByRole('button', { name: 'Retry', exact: true }).press('Enter');
  await expect.poll(() => overviewReads.length).toBe(2);
  await expect(status).toBeFocused();
  await expect(status).toHaveAttribute('aria-busy', 'true');
  await expect(main.getByText('Odometer', { exact: true })).toBeVisible();
  retryPending.resolve();
  await expect(status.getByRole('alert')).toHaveCount(0);
  await expect(main.getByText('Needs attention', { exact: true })).toBeVisible();
  await expect(main.getByText('4d overdue', { exact: true })).toBeVisible();
  await expect(status).toBeFocused();
  expect(overviewReads.map(request => request.method())).toEqual(['GET', 'GET']);
});

test('Auto Car retries an empty overview response in place', async ({ page }) => {
  const root = '/api/v1/automotive';
  const overviewReads = [];
  const retryPending = Promise.withResolvers();
  await page.routeWebSocket('**/*', () => {});
  await page.route('**/api/**', async route => {
    const request = route.request();
    const { pathname } = new URL(request.url());
    if (pathname.endsWith('/supervision/bootstrap')) return route.fulfill({ json: { enabled: false } });
    if (pathname === `${root}/vehicles`) return route.fulfill({ json: vehicles });
    if (pathname === `${root}/vehicles/sample`) {
      overviewReads.push(request);
      if (overviewReads.length === 1) return route.fulfill({ status: 204 });
      await retryPending.promise;
      return route.fulfill({ json: overview });
    }
    return route.fulfill({ json: {} });
  });

  await page.goto('/auto');
  const main = page.getByRole('main');
  const vehicle = main.getByRole('region', { name: 'Vehicle', exact: true });
  await expect(vehicle.getByRole('alert')).toBeVisible();
  const retry = vehicle.getByRole('button', { name: 'Retry', exact: true });
  await retry.press('Enter');
  await expect.poll(() => overviewReads.length).toBe(2);
  await expect(vehicle).toBeFocused();
  await expect(vehicle).toHaveAttribute('aria-busy', 'true');
  await expect(vehicle.getByRole('button', { name: 'Retry', exact: true })).toHaveCount(0);
  retryPending.resolve();
  await expect(main.getByText('Odometer', { exact: true })).toBeVisible();
  await expect(vehicle).not.toHaveAttribute('aria-busy', 'true');
  await expect(vehicle).toBeFocused();
  expect(overviewReads.map(request => request.method())).toEqual(['GET', 'GET']);
});
