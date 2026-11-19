import { expect, test } from '@playwright/test';

test.use({ hasTouch: true, serviceWorkers: 'block', viewport: { width: 390, height: 850 } });

test.beforeEach(async ({ page }) => {
  await page.routeWebSocket('**/*', () => {});
  await page.route('**/api/**', route => route.fulfill({ json: {} }));
  await page.route('**/supervision/bootstrap', route => route.fulfill({ json: { enabled: false } }));
});

async function expectFullTouchTarget(button) {
  await expect(button).toBeVisible();
  const { width, height } = await button.boundingBox();
  // Transformed sheets can report 43.99997 for a 44px box in Firefox.
  expect(Math.round(width * 100) / 100).toBeGreaterThanOrEqual(44);
  expect(Math.round(height * 100) / 100).toBeGreaterThanOrEqual(44);
}

test('Auto fuel sheet Close has a full touch target and returns keyboard focus', async ({ page }) => {
  await page.route('**/automotive/vehicles', route => route.fulfill({
    json: { vehicles: [{ id: 'sample', label: 'Sample' }] },
  }));
  await page.route('**/automotive/vehicles/sample', route => route.fulfill({
    json: { odometer: { km: 123 }, fuel: { needsMoreData: true, fillCount: 0 }, trip_count: 0 },
  }));
  await page.goto('/auto');
  await page.getByRole('button', { name: 'Fuel', exact: true }).tap();
  const opener = page.getByRole('button', { name: 'Log a fill-up', exact: true });
  await opener.press('Enter');
  const sheet = page.getByRole('dialog', { name: 'Log a fill-up', exact: true });
  const close = sheet.getByRole('button', { name: 'Close', exact: true });
  await expectFullTouchTarget(close);
  await close.press('Enter');
  await expect(sheet).toBeHidden();
  await expect(opener).toBeFocused();
});

test('Health reading sheet Close can be tapped at the edge of its full touch target', async ({ page }) => {
  await page.route('**/health/context', route => route.fulfill({ json: { userId: 'alice' } }));
  await page.route('**/api/v1/health/medical', route => route.fulfill({ json: { metrics: [] } }));
  await page.goto('/health/medical');
  await page.getByRole('button', { name: 'Add reading', exact: true }).tap();
  const sheet = page.getByRole('dialog', { name: 'Add reading', exact: true });
  const close = sheet.getByRole('button', { name: 'Close', exact: true });
  await expectFullTouchTarget(close);
  await close.tap({ position: { x: 2, y: 22 } });
  await expect(sheet).toBeHidden();
});

test('Auto Back to garage has a full touch target and refocuses the selected vehicle', async ({ page }) => {
  await page.route('**/automotive/vehicles', route => route.fulfill({
    json: { vehicles: [{ id: 'sample', label: 'Sample' }, { id: 'other', label: 'Other' }] },
  }));
  await page.route('**/automotive/vehicles/sample', route => route.fulfill({
    json: { odometer: { km: 123 }, fuel: { needsMoreData: true, fillCount: 0 }, trip_count: 0 },
  }));
  await page.goto('/auto');
  const vehicle = page.getByRole('button', { name: 'Sample', exact: true });
  await vehicle.press('Enter');
  const back = page.getByRole('button', { name: 'Back to garage', exact: true });
  await expectFullTouchTarget(back);
  await back.tap({ position: { x: 2, y: 22 } });
  await expect(vehicle).toBeFocused();
});

test('Health settings opens from the edge of its full touch target', async ({ page }) => {
  await page.route('**/health/context', route => route.fulfill({ json: { userId: 'alice' } }));
  await page.route('**/api/v1/health/medical', route => route.fulfill({ json: { metrics: [] } }));
  await page.goto('/health/medical');
  const settings = page.getByRole('button', { name: 'Health settings', exact: true });
  await expectFullTouchTarget(settings);
  await settings.tap({ position: { x: 2, y: 22 } });
  await expect(page).toHaveURL(/\/health\/settings$/);
});

test('Home camera opens fullscreen from the edge of its full touch target', async ({ page }) => {
  await page.route('**/api/v1/camera', route => route.fulfill({ json: { cameras: [{ id: 'doorbell' }] } }));
  await page.goto('/home');
  await page.getByRole('button', { name: 'Cameras', exact: true }).tap();
  const fullscreen = page.getByRole('button', { name: 'Fullscreen doorbell', exact: true });
  await expectFullTouchTarget(fullscreen);
  await fullscreen.tap({ position: { x: 2, y: 22 } });
  await expect(page.getByRole('button', { name: 'Close camera', exact: true })).toBeVisible();
});

test('Life value rank actions have accessible names and full touch targets', async ({ page }) => {
  const member = { username: 'amy', displayName: 'Amy' };
  let values = [
    { id: 'care', name: 'Care', rank: 1 },
    { id: 'curiosity', name: 'Curiosity', rank: 2 },
  ];
  const writes = [];
  await page.route('**/api/v1/life/**', route => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.pathname.endsWith('/users')) return route.fulfill({ json: { users: [member] } });
    if (url.pathname.endsWith('/user')) return route.fulfill({ json: member });
    if (url.pathname.endsWith('/plan/')) return route.fulfill({ json: { values } });
    if (url.pathname.endsWith('/plan/values') && request.method() === 'PATCH') {
      writes.push({ username: url.searchParams.get('username'), values: request.postDataJSON() });
      values = writes.at(-1).values;
    }
    return route.fulfill({ json: {} });
  });

  await page.goto('/life/plan/values');
  await expect(page.getByText('Curiosity', { exact: true })).toBeVisible();
  const up = name => page.getByRole('button', { name: `Move ${name} up`, exact: true });
  const down = name => page.getByRole('button', { name: `Move ${name} down`, exact: true });
  await expect(up('Care')).toBeDisabled();
  await expect(down('Curiosity')).toBeDisabled();
  await expectFullTouchTarget(up('Curiosity'));
  await expectFullTouchTarget(down('Care'));

  await up('Curiosity').tap({ position: { x: 2, y: 22 } });
  await expect(up('Curiosity')).toBeDisabled();
  await expect(down('Care')).toBeDisabled();
  await down('Curiosity').press('Enter');
  await expect(up('Care')).toBeDisabled();
  await expect(down('Curiosity')).toBeDisabled();
  expect(writes).toEqual([
    { username: 'amy', values: [
      { id: 'curiosity', name: 'Curiosity', rank: 1 },
      { id: 'care', name: 'Care', rank: 2 },
    ] },
    { username: 'amy', values: [
      { id: 'care', name: 'Care', rank: 1 },
      { id: 'curiosity', name: 'Curiosity', rank: 2 },
    ] },
  ]);
});
