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
