import { expect, test } from '@playwright/test';
import { installHealthFixtures } from '../../../live/flow/health/healthFixtures.mjs';

const date = '2026-11-22';
const templatePath = '/api/v1/health/nutrition/templates';
const templates = [
  { id: 'breakfast', name: 'Breakfast oats', components: [{ name: 'Oats', role: 'core', calories: 100 }] },
  { id: 'lunch', name: 'Lunch salad', components: [
    { name: 'Greens', role: 'core', calories: 100 },
    { name: 'Walnuts', role: 'variant', calories: 50 },
  ] },
];

test.use({ serviceWorkers: 'block', viewport: { width: 390, height: 850 }, timezoneId: 'UTC' });

async function startHealth(page, baseURL) {
  const origin = new URL(baseURL).origin;
  await page.clock.setFixedTime(new Date(date + 'T18:00:00Z'));
  await page.context().route('**/*', route => new URL(route.request().url()).origin === origin ? route.fallback() : route.abort());
  await page.routeWebSocket('**/*', () => {});
  const state = await installHealthFixtures(page);
  await page.route('**/supervision/bootstrap', route => route.fulfill({ json: { enabled: false } }));
  return state;
}

for (const originalStatus of [201, 422]) {
  test(`Health keeps a replacement Lunch template draft after a late Breakfast ${originalStatus}`, async ({ page, baseURL }) => {
    const releaseBreakfast = Promise.withResolvers();
    const writes = [];
    const breakfastWrite = {
      templateId: 'breakfast', mealTime: 'morning', date, variantNames: [], operationId: expect.any(String),
    };
    const lunchWrite = {
      templateId: 'lunch', mealTime: 'afternoon', date, variantNames: ['Walnuts'], operationId: expect.any(String),
    };
    const state = await startHealth(page, baseURL);
    await page.route(`**${templatePath}?*`, route => route.fulfill({ json: { templates } }));
    await page.route(`**${templatePath}/*/instantiate`, async route => {
      const body = route.request().postDataJSON();
      const id = new URL(route.request().url()).pathname.split('/').at(-2);
      writes.push(body);
      if (id === 'breakfast') {
        await releaseBreakfast.promise;
        if (originalStatus === 422) {
          return route.fulfill({ status: 422, json: { error: 'Breakfast fixture refused' } });
        }
      }
      const item = {
        uuid: id + '-logged', name: id === 'breakfast' ? 'Oats from Breakfast' : 'Salad from Lunch',
        calories: 100, grams: 100, date, mealTime: body.mealTime,
      };
      state.items.push(item);
      return route.fulfill({ status: 201, json: { committed: true, item, date, mealTime: body.mealTime } });
    });

    const dialog = page.getByRole('dialog');
    const meals = page.getByRole('dialog', { name: 'Meals & templates', exact: true });
    const lunchDraft = page.getByRole('dialog', { name: 'Lunch salad', exact: true });
    const walnuts = lunchDraft.getByRole('switch', { name: /^Walnuts/ });
    const logLunch = lunchDraft.getByRole('button', { name: 'Log 150 kcal', exact: true });
    const openMeals = async meal => {
      await page.getByRole('button', { name: 'Saved meals for ' + meal, exact: true }).press('Enter');
      await expect(meals).toBeVisible();
    };

    try {
      await page.goto('/health?date=' + date);
      await openMeals('Breakfast');
      await meals.getByRole('button', { name: /^Breakfast oats/ }).press('Enter');
      await expect.poll(() => writes).toEqual([breakfastWrite]);
      await page.keyboard.press('Escape');
      await expect(meals).toBeHidden();

      await openMeals('Lunch');
      const chooseLunch = meals.getByRole('button', { name: /^Lunch salad/ });
      await expect(chooseLunch, 'an earlier Breakfast save must not disable the new Lunch sheet').toBeEnabled();
      await chooseLunch.press('Enter');
      await walnuts.press('Space');
      await expect(walnuts).toBeChecked();
      await expect(logLunch).toBeEnabled();

      const breakfastResponse = page.waitForResponse(response =>
        new URL(response.url()).pathname === templatePath + '/breakfast/instantiate');
      releaseBreakfast.resolve();
      const response = await breakfastResponse;
      expect(response.status()).toBe(originalStatus);
      await response.finished();
      if (originalStatus === 201) {
        await expect(page.getByText('Oats from Breakfast', { exact: true }).first()).toBeVisible();
      } else {
        await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
        await expect(page.getByText('Oats from Breakfast', { exact: true })).toHaveCount(0);
      }

      await expect(lunchDraft).toBeVisible();
      await expect(walnuts).toBeChecked();
      await expect(lunchDraft.getByText(/Breakfast fixture refused/)).toHaveCount(0);
      expect(writes).toEqual([breakfastWrite]);

      await logLunch.press('Enter');
      await expect(dialog).toBeHidden();
      await expect(page.getByText('Salad from Lunch', { exact: true }).first()).toBeVisible();
      expect(writes).toEqual([breakfastWrite, lunchWrite]);
      expect(writes[0].operationId).not.toBe(writes[1].operationId);
    } finally {
      releaseBreakfast.resolve();
    }
  });
}

test('Health refreshes a replacement saved-meal list after the original edit commits', async ({ page, baseURL }) => {
  const release = Promise.withResolvers();
  const writes = [];
  let template = { id: 'oats', name: 'Initial oats', components: [{ name: 'Oats', role: 'core', grams: 100, calories: 100 }] };
  await startHealth(page, baseURL);
  await page.route(`**${templatePath}?*`, route => route.fulfill({ json: { templates: [template] } }));
  await page.route(`**${templatePath}/oats`, async route => {
    const request = route.request();
    if (request.method() !== 'PUT') return route.fallback();
    const changes = request.postDataJSON();
    writes.push(changes.name);
    await release.promise;
    template = { ...template, ...changes };
    return route.fulfill({ json: { template } });
  });

  const meals = page.getByRole('dialog', { name: 'Meals & templates', exact: true });
  const button = name => page.getByRole('button', { name, exact: true });
  try {
    await page.goto('/health?date=' + date);
    await button('Saved meals for Breakfast').press('Enter');
    await button('Edit Initial oats').press('Enter');
    await meals.getByLabel('Meal name').fill('Revised oats');
    await button('Save meal').press('Enter');
    await expect.poll(() => writes).toEqual(['Revised oats']);
    await page.keyboard.press('Escape');
    await expect(meals).toBeHidden();

    await button('Saved meals for Lunch').press('Enter');
    await expect(button('Edit Initial oats')).toBeVisible();
    release.resolve();
    await expect(meals.getByRole('button', { name: 'Edit Revised oats', exact: true })).toBeVisible();
    expect(writes).toEqual(['Revised oats']);
  } finally {
    release.resolve();
  }
});
