import { expect, test } from '@playwright/test';

test.use({ hasTouch: true, viewport: { width: 390, height: 850 }, serviceWorkers: 'block' });

const types = [
  { value: 'cross-rotate', label: 'Cross-pattern tire rotation', defaultIntervalMonths: 12, defaultIntervalKm: 12000 },
  { value: 'condition', label: 'Condition inspection', defaultIntervalMonths: null, defaultIntervalKm: null },
];

async function openService(page, baseURL, { failFirst = false } = {}) {
  const origin = new URL(baseURL).origin;
  const pending = Promise.withResolvers();
  const posts = [];
  const reads = [];
  const historyReads = [];
  await page.context().route('**/*', route => (
    new URL(route.request().url()).origin === origin ? route.fallback() : route.abort()
  ));
  await page.routeWebSocket('**/*', () => {});
  await page.route('**/api/**', async route => {
    const request = route.request();
    const { pathname } = new URL(request.url());
    let json = {};
    if (pathname.endsWith('/supervision/bootstrap')) json = { enabled: false };
    if (pathname.endsWith('/automotive/vehicles')) json = { vehicles: [{ id: 'sample', label: 'Sample' }] };
    if (pathname.endsWith('/vehicles/sample')) {
      json = { odometer: { km: 123 }, fuel: { needsMoreData: true, fillCount: 0 }, trip_count: 0 };
    }
    if (pathname.endsWith('/service-types')) {
      reads.push(request.method());
      if (failFirst && reads.length === 1) {
        return route.fulfill({ status: 409, json: { error: 'Service types temporarily unavailable' } });
      }
      await pending.promise;
      json = { types };
    }
    if (pathname.endsWith('/sample/service')) {
      if (request.method() === 'POST') posts.push(request.postDataJSON());
      if (request.method() === 'GET') historyReads.push(request.method());
      json = { records: [{ id: 'prior', type: 'inspection', date: '2026-11-22', vendor: 'Fixture shop' }] };
    }
    return route.fulfill({ json });
  });

  await page.goto('/auto');
  await page.getByRole('button', { name: 'Service', exact: true }).press('Enter');
  await expect(page.getByText('Fixture shop')).toBeVisible();
  await expect.poll(() => reads).toEqual(['GET']);
  const opener = page.getByRole('button', { name: 'Log service', exact: true });
  await opener.press('Enter');
  return {
    pending, posts, reads, historyReads, opener, dialog: page.getByRole('dialog', { name: 'Log service', exact: true }),
  };
}

test('Auto waits for custom service types before starting a draft and saves its visible defaults', async ({ page, baseURL }) => {
  const { pending, posts, reads, opener, dialog } = await openService(page, baseURL);
  const what = dialog.getByRole('combobox', { name: 'What was done', exact: true });
  const repeat = dialog.getByLabel('Repeat (months)', { exact: true });
  const save = dialog.getByRole('button', { name: 'Save', exact: true });
  try {
    await expect(dialog.getByLabel('Loading service types')).toBeVisible();
    await expect(what).toHaveCount(0);
    await expect(save).toHaveCount(0);
  } finally {
    pending.resolve();
  }

  await expect(what).toHaveValue('cross-rotate');
  await expect(repeat).toHaveValue('12');
  await save.press('Enter');
  await expect.poll(() => posts).toEqual([expect.objectContaining({
    type: 'cross-rotate', intervalMonths: 12, intervalKm: 12000,
  })]);
  await expect(dialog).toBeHidden();
  await expect(opener).toBeFocused();
  expect(reads).toEqual(['GET']);
});

test('Auto retries only missing service types and uses no repeat interval for a condition-based type', async ({ page, baseURL }) => {
  const { pending, posts, reads, historyReads, dialog } = await openService(page, baseURL, { failFirst: true });
  const what = dialog.getByRole('combobox', { name: 'What was done', exact: true });
  const save = dialog.getByRole('button', { name: 'Save', exact: true });
  try {
    const alert = dialog.getByRole('alert');
    await expect(alert).toContainText('Service types temporarily unavailable');
    await expect(what).toHaveCount(0);
    await expect(save).toHaveCount(0);
    await alert.getByRole('button', { name: 'Retry', exact: true }).press('Enter');
    await expect.poll(() => reads).toEqual(['GET', 'GET']);
    await expect(dialog.getByLabel('Loading service types')).toBeVisible();
  } finally {
    pending.resolve();
  }
  await expect(what).toBeFocused();
  await what.selectOption('condition');
  await expect(dialog.getByLabel('Repeat (months)', { exact: true })).toHaveValue('');
  expect(historyReads).toEqual(['GET']);
  await expect(posts).toEqual([]);
  await save.press('Enter');
  await expect.poll(() => posts).toEqual([expect.objectContaining({
    type: 'condition', intervalMonths: null, intervalKm: null,
  })]);
  await expect(dialog).toBeHidden();
});
