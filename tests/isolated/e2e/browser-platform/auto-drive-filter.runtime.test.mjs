import { expect, test } from '@playwright/test';

test.use({ serviceWorkers: 'block' });

for (const width of [390, 1440]) {
  test(`Auto Drives keeps the short-recording control focused through query changes at ${width}px`, async ({ page, baseURL }) => {
    await page.setViewportSize({ width, height: 850 });
    const origin = new URL(baseURL).origin;
    const vehicles = '/api/v1/automotive/vehicles';
    const wagon = vehicles + '/wagon';
    const journeys = wagon + '/journeys';
    const recorded = [
      { id: 'main', title: 'Morning drive', stops: [] },
      ...Array.from({ length: 24 }, (_, index) => ({ id: 'drive-' + index, title: 'Other drive ' + index, stops: [] })),
    ];
    const short = { id: 'short', title: 'Garage shuffle', stops: [], classification: 'shuffle' };
    const paths = [];
    let held;
    let returnRead;
    let revisitRead;
    await page.context().route('**/*', route => (
      new URL(route.request().url()).origin === origin ? route.fallback() : route.abort()
    ));
    await page.routeWebSocket('**/*', () => {});
    await page.route('**/api/**', route => {
      const { pathname, search } = new URL(route.request().url());
      if (pathname === vehicles) return route.fulfill({ json: { vehicles: [{ id: 'wagon', label: 'Family wagon' }] } });
      if (pathname === wagon) return route.fulfill({ json: { odometer: { km: 100 }, fuel: { needsMoreData: true, fillCount: 0 }, trip_count: 0 } });
      if (pathname === journeys) {
        paths.push(search);
        if (search === '?shuffles=1' && !held) { held = route; return; }
        if (!search && paths.length > 1 && !returnRead) { returnRead = route; return; }
        if (!search && returnRead && !revisitRead) { revisitRead = route; return; }
        return route.fulfill({ json: { journeys: search ? [...recorded, short] : recorded, hidden: search ? 0 : 1 } });
      }
      return route.fulfill({ json: pathname.endsWith('/supervision/bootstrap') ? { enabled: false } : {} });
    });

    await page.goto('/auto');
    const main = page.getByRole('main');
    await page.getByRole('button', { name: 'Drives', exact: true }).click();
    await expect(main.getByText('Morning drive')).toBeVisible();
    const show = main.getByRole('button', { name: 'Show 1 very short recording', exact: true });
    const hide = main.getByRole('button', { name: 'Hide very short recordings', exact: true });
    const original = await show.elementHandle();
    await show.press('Enter');
    await expect.poll(() => paths).toEqual(['', '?shuffles=1']);
    const loading = main.getByLabel('Loading drives');
    await expect(loading).toBeVisible();
    expect(await loading.evaluate(node => node.offsetWidth === node.parentElement.clientWidth)).toBe(true);
    expect(await original.evaluate(node => node.isConnected && document.activeElement === node)).toBe(true);
    await expect(hide).toBeFocused();
    await expect(main.getByText('Morning drive')).toHaveCount(0);

    await held.fulfill({ status: 404, json: { error: 'Drives fixture unavailable' } });
    const error = main.getByRole('alert');
    await expect(error).toContainText('Drives fixture unavailable');
    expect(await error.evaluate(node => node.offsetWidth === node.parentElement.clientWidth)).toBe(true);
    await expect(hide).toBeFocused();
    await main.getByRole('button', { name: 'Retry', exact: true }).click();
    await expect(main.getByText('Garage shuffle')).toBeVisible();
    await expect(main.getByRole('alert')).toHaveCount(0);
    await hide.press('Enter');
    await expect.poll(() => Boolean(returnRead)).toBe(true);
    const showWithoutCount = main.getByRole('button', { name: 'Show very short recordings', exact: true });
    await expect(showWithoutCount).toBeFocused();
    expect(await original.evaluate(node => node.isConnected && document.activeElement === node)).toBe(true);
    await returnRead.fulfill({ json: { journeys: recorded, hidden: 0 } });
    await expect(main.getByText('Garage shuffle')).toHaveCount(0);
    await expect(main.getByText('Morning drive')).toBeVisible();
    await expect(showWithoutCount).toBeFocused();
    await expect(showWithoutCount).toBeInViewport();
    await page.getByRole('button', { name: 'Car', exact: true }).click();
    const drives = page.getByRole('button', { name: 'Drives', exact: true });
    await drives.press('Enter');
    await expect.poll(() => Boolean(revisitRead)).toBe(true);
    await expect(main.getByRole('region', { name: 'Drives' })).toHaveAttribute('aria-busy', 'true');
    await expect(main.getByText('Morning drive')).toBeVisible();
    await expect(showWithoutCount).toHaveCount(0);
    await revisitRead.fulfill({ json: { journeys: [{ ...recorded[0], title: 'Updated morning drive' }, ...recorded.slice(1)], hidden: 0 } });
    await expect(main.getByText('Updated morning drive')).toBeVisible();
    await expect(drives).toBeFocused();
    expect(paths).toEqual(['', '?shuffles=1', '?shuffles=1', '', '']);
  });
}
