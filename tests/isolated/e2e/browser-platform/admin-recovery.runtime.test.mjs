import { expect, test } from '@playwright/test';

test.use({ serviceWorkers: 'block' });
test.beforeEach(async ({ page }) => {
  await page.routeWebSocket('**/*', () => {});
  await page.route('**/api/**', route => route.fulfill({ json: {} }));
  await page.route('**/supervision/bootstrap', route => route.fulfill({ json: { enabled: false } }));
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

test('Review keys supports pointer and keyboard dismissal and returns focus to its opener', async ({ page }) => {
  await page.route('**/api/v1/content-filter/77/review', route => route.fulfill({ json: {
    title: 'Test film', certification: { level: 'none' }, audit: null, rows: [],
    reviewed: 0, total: 0, job: null, signOff: { ready: false, missing: [], parent: null },
  } }));
  await page.goto('/admin/content/filter/77');
  const opener = page.getByRole('button', { name: 'All keys' });
  const dialog = page.getByRole('dialog', { name: 'Review keys' });
  const close = dialog.getByRole('button', { name: 'Close' });
  await opener.click();
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
  await expect(close).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(opener).toBeFocused();
});
