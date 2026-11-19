import { expect, test } from '@playwright/test';
import { installHealthFixtures } from '../../../live/flow/health/healthFixtures.mjs';

test.use({ serviceWorkers: 'block', viewport: { width: 390, height: 850 } });

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
