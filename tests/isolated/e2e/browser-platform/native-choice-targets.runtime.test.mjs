import { expect, test } from '@playwright/test';
import { installHealthFixtures } from '../../../live/flow/health/healthFixtures.mjs';

test.use({ hasTouch: true, viewport: { width: 390, height: 850 }, serviceWorkers: 'block' });

test.beforeEach(async ({ page, baseURL }) => {
  const origin = new URL(baseURL).origin;
  await page.context().route('**/*', route => (
    new URL(route.request().url()).origin === origin ? route.fallback() : route.abort()
  ));
  await page.routeWebSocket('**/*', () => {});
  await page.route('**/api/**', route => route.fulfill({ json: {} }));
  await page.route('**/supervision/bootstrap', route => route.fulfill({ json: { enabled: false } }));
});

async function exerciseChoice(page, checkbox) {
  const label = checkbox.locator('xpath=ancestor::label[1]');
  await expect(label).toBeVisible();
  expect(await page.evaluate(() => matchMedia('(pointer: coarse)').matches)).toBe(true);
  const { width, height } = await label.boundingBox();
  expect(Math.round(width * 100) / 100).toBeGreaterThanOrEqual(44);
  expect(Math.round(height * 100) / 100).toBeGreaterThanOrEqual(44);

  await expect(checkbox).not.toBeChecked();
  await label.tap({ position: { x: 3, y: 37 } });
  await expect(checkbox).toBeChecked();
  await checkbox.press('Space');
  await expect(checkbox).toBeFocused();
  await expect(checkbox).not.toBeChecked();
}

test('Auto partial fill can be toggled by the edge of its label or Space', async ({ page }) => {
  await page.route('**/automotive/vehicles', route => route.fulfill({
    json: { vehicles: [{ id: 'sample', label: 'Sample' }] },
  }));
  await page.route('**/automotive/vehicles/sample', route => route.fulfill({
    json: { odometer: { km: 123 }, fuel: { needsMoreData: true, fillCount: 0 }, trip_count: 0 },
  }));
  const writes = [];
  await page.route('**/automotive/vehicles/sample/fuel', route => {
    if (route.request().method() !== 'GET') writes.push(route.request().method());
    return route.fulfill({ json: { logs: [] } });
  });
  await page.goto('/auto');
  await page.getByRole('button', { name: 'Fuel', exact: true }).press('Enter');
  await page.getByRole('button', { name: 'Log a fill-up', exact: true }).press('Enter');
  const dialog = page.getByRole('dialog', { name: 'Log a fill-up' });
  const partial = dialog.getByRole('checkbox', { name: /Partial fill/ });
  await exerciseChoice(page, partial);
  await expect(dialog.getByText(/economy needs a full tank at both ends/)).toHaveCount(0);
  expect(writes).toEqual([]);
});

for (const mode of ['membership', 'suggestion']) {
  test(`Health ${mode} can toggle a food through its full label or Space`, async ({ page }) => {
    const date = '2026-11-22';
    await page.clock.setFixedTime(new Date(date + 'T18:00:00Z'));
    const entry = { grams: 100, calories: 100, mealTime: 'evening', date };
    const fixture = await installHealthFixtures(page, { items: [
      { ...entry, uuid: 'dish', name: 'Fixture dish', kind: 'group' },
      { ...entry, uuid: 'rice', name: 'Rice', parentId: 'dish' },
      { ...entry, uuid: 'beans', name: 'Beans' },
    ] });
    await page.route('**/supervision/bootstrap', route => route.fulfill({ json: { enabled: false } }));
    const suggestions = [];
    await page.route('**/api/v1/health/nutrition/meal-suggestions', route => {
      const request = route.request();
      suggestions.push([request.method(), request.postDataJSON()]);
      return route.fulfill({ json: { groups: [{ name: 'Fixture suggestion', selectedIds: ['rice'] }] } });
    });

    await page.goto('/health?date=' + date);
    await page.getByRole('button', { name: mode === 'membership' ? 'Edit groups' : 'Suggest groups', exact: true }).press('Enter');
    const beans = page.getByRole('checkbox', { name: 'Beans', exact: true });
    await exerciseChoice(page, beans);
    await expect(page.getByRole('checkbox', { name: 'Rice', exact: true })).toBeChecked();
    expect(suggestions).toEqual(mode === 'suggestion' ? [['POST', { date, bucket: 'evening', selectedIds: [] }]] : []);
    expect(fixture.unexpected).toEqual([]);
    expect(fixture.requests.filter(request => request.method !== 'GET')).toEqual([]);
  });
}
