import { expect, test } from '@playwright/test';
import { installHealthFixtures } from '../../../live/flow/health/healthFixtures.mjs';

test.use({ serviceWorkers: 'block', viewport: { width: 390, height: 850 } });

for (const replaceQuery of [false, true]) {
  test(`Health Saved foods keeps Retry focus while the request ${replaceQuery ? 'is replaced by a search' : 'settles'}`, async ({ page }) => {
    if (replaceQuery) await page.setViewportSize({ width: 1440, height: 850 });
    const pending = Promise.withResolvers();
    const reads = [];
    let heldRequest;
    const date = '2026-11-22';
    await page.clock.setFixedTime(new Date(`${date}T16:00:00Z`));
    await page.routeWebSocket('**/*', () => {});
    const fixture = await installHealthFixtures(page);
    await page.route('**/supervision/bootstrap', route => route.fulfill({ json: { enabled: false } }));
    await page.route('**/api/v1/health/nutrition/catalog/suggest?*', async route => {
      const request = route.request();
      const params = new URL(request.url()).searchParams;
      if (params.get('limit') !== '40') return route.fallback();
      const query = params.get('q');
      if (reads.push([request.method(), query]) === 1) {
        return route.fulfill({ status: 409, json: { error: 'Fixture refused saved foods' } });
      }
      if (query === 'walnuts') {
        return route.fulfill({ json: { items: [{ id: 'walnuts', name: 'Fixture walnuts', grams: 10 }] } });
      }
      heldRequest = request;
      await pending.promise;
      await route.fulfill({ json: { items: [{ id: 'oats', name: 'Fixture oats', grams: 80 }] } }).catch(error => {
        if (!request.failure()) throw error;
      });
    });

    const sheet = page.getByRole('dialog', { name: 'Saved foods', exact: true });
    const search = sheet.getByRole('textbox', { name: 'Find a saved food', exact: true });
    const results = sheet.getByRole('region', { name: 'Saved food results', exact: true });
    const retry = sheet.getByRole('button', { name: 'Retry', exact: true });
    const walnuts = sheet.getByRole('button', { name: /Fixture walnuts/ });
    const oats = sheet.getByRole('button', { name: /Fixture oats/ });

    try {
      await page.goto(`/health?date=${date}`);
      await page.getByRole('combobox', { name: 'Add to Lunch', exact: true }).click();
      await page.getByRole('button', { name: /Manage saved foods/ }).press('Enter');
      await retry.press('Enter');
      await expect.poll(() => reads).toEqual([['GET', ''], ['GET', '']]);
      await expect(retry).toHaveCount(0);
      expect(await page.evaluate(() => document.activeElement === document.body)).toBe(false);
      await expect(results).toBeFocused();
      await expect(results).toHaveAttribute('aria-busy', 'true');
      await expect(search).toBeEditable();
      await page.keyboard.press('Shift+Tab');
      await expect(search).toBeFocused();
      if (replaceQuery) {
        await search.fill('walnuts');
        await expect.poll(() => heldRequest?.failure()).not.toBeNull();
        await expect(walnuts).toBeVisible();
      }
    } finally {
      pending.resolve();
    }

    await expect(replaceQuery ? walnuts : oats).toBeVisible();
    await expect(results).not.toHaveAttribute('aria-busy', 'true');
    await expect(search).toBeFocused();
    if (replaceQuery) {
      await expect(oats).toHaveCount(0);
      await expect(search).toHaveValue('walnuts');
    }
    expect(reads).toEqual(replaceQuery ? [['GET', ''], ['GET', ''], ['GET', 'walnuts']] : [['GET', ''], ['GET', '']]);
    expect(fixture.requests.filter(({ method }) => method !== 'GET')).toEqual([]);
  });
}

test('Health keeps keyboard focus in saved foods while editing, going back, and saving', async ({ page }) => {
  await page.routeWebSocket('**/*', () => {});
  const fixture = await installHealthFixtures(page, {
    foods: [{ id: 'oats', name: 'Rolled oats', grams: 80, calories: 300 }],
  });
  await page.route('**/supervision/bootstrap', route => route.fulfill({ json: { enabled: false } }));
  const writes = [];
  await page.route('**/api/v1/health/nutrition/catalog/oats', route => {
    if (route.request().method() !== 'PUT') return route.fallback();
    const update = route.request().postDataJSON();
    writes.push(update);
    Object.assign(fixture.foods[0], update);
    return route.fulfill({ json: { entry: fixture.foods[0] } });
  });

  await page.goto('/health');
  const mealInput = page.getByRole('combobox', { name: 'Add to Lunch', exact: true });
  await mealInput.click();
  const manage = page.getByRole('button', { name: /Manage saved foods/ });
  await manage.press('Enter');

  const sheet = page.getByRole('dialog', { name: 'Saved foods', exact: true });
  const search = sheet.getByRole('textbox', { name: 'Find a saved food' });
  const row = sheet.getByRole('button', { name: /Rolled oats/ });
  await expect(search).toBeFocused();
  await search.fill('rolled');
  await expect(row).toBeVisible();
  await page.keyboard.press('Tab');
  await expect(row).toBeFocused();
  await page.keyboard.press('Enter');

  const name = sheet.getByRole('textbox', { name: 'Food name' });
  await expect(name).toBeFocused();
  await name.fill('Unsaved oats');
  await sheet.getByRole('button', { name: 'Back', exact: true }).press('Enter');
  await expect(search).toBeFocused();
  await expect(search).toHaveValue('rolled');
  await page.keyboard.press('Tab');
  await expect(row).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(name).toBeFocused();
  await expect(name).toHaveValue('Rolled oats');
  expect(writes).toEqual([]);

  await name.fill('Rolled oats batch');
  await sheet.getByRole('button', { name: 'Save definition', exact: true }).press('Enter');
  await expect(search).toBeFocused();
  await expect(search).toHaveValue('rolled');
  await expect(sheet.getByRole('button', { name: /Rolled oats batch/ })).toBeVisible();
  expect(writes).toEqual([expect.objectContaining({ name: 'Rolled oats batch', grams: 80 })]);
  expect(fixture.unexpected).toEqual([]);
});

test('Health removes a saved food only after confirmation', async ({ page }) => {
  await page.routeWebSocket('**/*', () => {});
  const fixture = await installHealthFixtures(page, {
    foods: [{ id: 'oats', name: 'Rolled oats', grams: 80, calories: 300 }],
  });
  await page.route('**/supervision/bootstrap', route => route.fulfill({ json: { enabled: false } }));
  const writes = [];
  await page.route('**/api/v1/health/nutrition/catalog/oats', route => {
    const request = route.request();
    if (request.method() === 'GET') return route.fallback();
    writes.push([request.method(), request.postDataJSON()]);
    fixture.foods.splice(0, 1);
    return route.fulfill({ json: { ok: true } });
  });

  await page.goto('/health');
  await page.getByRole('combobox', { name: 'Add to Lunch', exact: true }).click();
  await page.getByRole('button', { name: /Manage saved foods/ }).press('Enter');
  const sheet = page.getByRole('dialog', { name: 'Saved foods', exact: true });
  const oats = sheet.getByRole('button', { name: /Rolled oats/ });
  await oats.click();
  const remove = sheet.getByRole('button', { name: 'Remove food', exact: true });
  page.once('dialog', dialog => dialog.dismiss());
  await remove.click();
  await expect(sheet.getByRole('textbox', { name: 'Food name' })).toHaveValue('Rolled oats');
  expect(writes).toEqual([]);

  page.once('dialog', dialog => dialog.accept());
  await remove.click();
  await expect(sheet.getByRole('textbox', { name: 'Find a saved food' })).toBeFocused();
  await expect(oats).toHaveCount(0);
  expect(writes).toEqual([['DELETE', {}]]);
  expect(fixture.requests.filter(request => request.method !== 'GET')).toEqual([]);
  expect(fixture.unexpected).toEqual([]);
});
