import { expect, test } from '@playwright/test';

test.use({ serviceWorkers: 'block' });

const vehicles = { vehicles: [{ id: 'sample', label: 'Sample car' }] };
const overview = { odometer: { km: 160 }, fuel: { needsMoreData: true, fillCount: 0 } };
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
