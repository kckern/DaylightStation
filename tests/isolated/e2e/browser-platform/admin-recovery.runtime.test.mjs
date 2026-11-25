import { expect, test } from '@playwright/test';

test.use({ serviceWorkers: 'block' });
test.beforeEach(async ({ page }) => {
  await page.routeWebSocket('**/*', () => {});
  await page.route('**/api/**', route => route.fulfill({ json: {} }));
  await page.route('**/supervision/bootstrap', route => route.fulfill({ json: { enabled: false } }));
});

test('Admin Virtual Console completes a dispatched scan without refreshing a departed view', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 850 });
  const scan = Promise.withResolvers();
  const calls = [];
  await page.route('**/api/v1/school/devices/*', async route => {
    const request = route.request();
    const action = new URL(request.url()).pathname.split('/').pop();
    calls.push([request.method(), action]);
    if (action === 'scan') {
      await scan.promise;
      return route.fulfill({ json: {} });
    }
    return route.fulfill({ json: action === 'status' ? { devices: { scanner: { present: true } } } : {} });
  });

  await page.goto('/admin/school/virtual-console');
  await page.getByRole('textbox', { name: 'Code' }).fill('sch:fixture');
  await page.getByRole('button', { name: 'Scan' }).click();
  try {
    await expect.poll(() => calls.filter(([, action]) => action === 'scan')).toEqual([['POST', 'scan']]);
    await page.getByRole('link', { name: 'Devices', exact: true }).click();
    await expect(page).toHaveURL(/\/admin\/household\/devices$/);
    await expect(page.getByRole('heading', { name: 'School Virtual Device Console' })).toHaveCount(0);
    const before = calls.slice();
    const response = page.waitForResponse(result => result.url().endsWith('/school/devices/scan'));
    scan.resolve();
    expect((await response).ok()).toBe(true);
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    expect(calls).toEqual(before);
  } finally {
    scan.resolve();
  }
});

test('Devices retries list errors and preserves a rejected creation for resubmission', async ({ page }) => {
  let reads = 0;
  const writes = [];
  await page.route('**/admin/household/devices', route => {
    const request = route.request();
    if (!new URL(request.url()).pathname.startsWith('/api/')) return route.continue();
    if (request.method() === 'POST') {
      writes.push(request.postDataJSON());
      return writes.length === 1
        ? route.fulfill({ status: 409, json: { message: 'Device ID is already in use' } })
        : route.fulfill({ json: { ok: true } });
    }
    if (++reads === 1) return route.fulfill({ status: 500, json: { message: 'Device list unavailable' } });
    return route.fulfill({ json: { devices: writes.length === 2 ? [writes[1]] : [] } });
  });
  await page.goto('/admin/household/devices');
  await expect(page.getByRole('alert')).toContainText('Devices failed to load');
  await page.getByRole('button', { name: 'Retry' }).click();
  await expect(page.getByText('No devices found')).toBeVisible();
  await page.getByRole('button', { name: 'Add Device' }).click();
  const dialog = page.getByRole('dialog', { name: 'Add Device' });
  const id = dialog.getByRole('textbox', { name: 'Device ID' });
  await id.fill('old-room');
  await id.press('Enter');
  await expect(dialog.getByRole('alert')).toContainText('Device ID is already in use');
  await expect(id).toHaveValue('old-room');
  await id.fill('new-room');
  await dialog.getByRole('button', { name: 'Add Device' }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByText('new-room', { exact: true })).toBeVisible();
  expect(writes).toEqual([
    { id: 'old-room', type: 'shield-tv' },
    { id: 'new-room', type: 'shield-tv' },
  ]);
});

test('Admin notification settings preserve edits made during a pending save', async ({ page }) => {
  const initial = {
    quiet_hours: { enabled: true, start: '21:00', end: '07:00' },
    cooldowns: { ceremony: 1200, default: 60 },
  };
  const writes = [];
  const releaseFirstSave = Promise.withResolvers();
  await page.route('**/api/v1/admin/notifications', async route => {
    if (route.request().method() === 'GET') return route.fulfill({ json: initial });
    const submitted = route.request().postDataJSON();
    writes.push(submitted);
    if (writes.length === 1) await releaseFirstSave.promise;
    return route.fulfill({ json: submitted });
  });

  try {
    await page.goto('/admin/system/notifications');
    const start = page.getByRole('textbox', { name: 'Start' });
    const end = page.getByRole('textbox', { name: 'End' });
    const save = page.getByRole('button', { name: 'Save', exact: true });
    await expect(start).toHaveValue('21:00');
    await start.fill('20:00');
    await save.click();
    await expect.poll(() => writes.length).toBe(1);
    await end.fill('08:30');
    releaseFirstSave.resolve();
    await expect(save).toBeEnabled();
    await expect(end).toHaveValue('08:30');
    expect(writes).toEqual([{ ...initial, quiet_hours: { enabled: true, start: '20:00', end: '07:00' } }]);

    await save.click();
    await expect.poll(() => writes[1]).toEqual({
      ...initial, quiet_hours: { enabled: true, start: '20:00', end: '08:30' },
    });
    await expect(save).toBeDisabled();
    await expect(page.getByText('Unsaved', { exact: true })).toHaveCount(0);
  } finally {
    releaseFirstSave.resolve();
  }
});

test('Review keys supports pointer and keyboard dismissal and returns focus to its opener', async ({ page }) => {
  await page.route('**/api/v1/content-filter/77/review', route => route.fulfill({ json: {
    title: 'Test film', certification: { level: 'none' }, audit: null, rows: [],
    reviewed: 0, total: 0, job: null, signOff: { ready: false, missing: [], parent: null },
  } }));
  await page.goto('/admin/content/filter/77');
  // All keys is an item of the header's More menu; the menu button is the opener to return to.
  const opener = page.getByRole('button', { name: 'More', exact: true });
  const allKeys = page.getByRole('menuitem', { name: /^All keys/ });
  const dialog = page.getByRole('dialog', { name: 'Review keys' });
  const close = dialog.getByRole('button', { name: 'Close' });
  await opener.click();
  await allKeys.click();
  await expect(close).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(close).toBeFocused();
  await close.click();
  await expect(opener).toBeFocused();

  await page.keyboard.press('?');
  await expect(close).toBeFocused();
  await page.keyboard.press('?');
  await expect(dialog).toBeHidden();
  await expect(opener).toBeFocused();

  await opener.press('Enter');
  await allKeys.press('Enter');
  await expect(close).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(opener).toBeFocused();
});
