import { test, expect } from '@playwright/test';
import { installHealthFixtures } from './healthFixtures.mjs';
test.use({ serviceWorkers: 'block' });
const date = '2026-09-06';
const a = { uuid: 'a', name: 'Eggs', grams: 100, calories: 200, protein: 20, carbs: 15, fat: 5, version: 1, date, mealTime: 'evening' };
const b = { ...a, uuid: 'b', name: 'Beans', grams: 200, calories: 100, protein: 10, carbs: 5, fat: 2 };
const cases = [
  ['portion', 20, { grams: 110, calories: 220 }],
  ['calories', 40, { grams: 110, calories: 220 }],
  ['density', 40, { grams: 100, calories: 220 }],
  ['protein', 10, { grams: 100, calories: 220, protein: 25 }],
  ['carbs', 10, { grams: 100, calories: 220, carbs: 20 }],
  ['fat', 10, { grams: 100, calories: 245, fat: 10 }],
];
for (const [field, dx, expected] of cases) test(`drag ${field} previews and saves once`, async ({ page }) => {
  const state = await installHealthFixtures(page, { items: [a] });
  await page.goto(`/health?date=${date}`);
  const button = page.getByRole('button', { name: new RegExp(`Adjust ${field} of Eggs`) });
  await expect(button).toBeVisible({ timeout: 20000 });
  const box = await button.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + dx, box.y + box.height / 2, { steps: 5 });
  await expect(page.locator('.health-equation')).toContainText(String(expected.calories));
  expect(state.requests.filter(request => request.method === 'PUT')).toHaveLength(0);
  await page.mouse.up();
  await expect.poll(() => state.requests.filter(request => request.method === 'PUT').length).toBe(1);
  expect(state.items[0]).toMatchObject(expected);
  await expect(button).toBeEnabled();
});

for (const [field, dx] of cases) test(`group ${field} drag updates ingredient totals and saves once`, async ({ page }) => {
  const group = { ...a, uuid: 'g', name: 'Dinner dish', kind: 'group', grams: 300, calories: 0, protein: 0, carbs: 0, fat: 0 };
  const state = await installHealthFixtures(page, { items: [group, { ...a, parentId: 'g' }, { ...b, parentId: 'g' }] });
  await page.goto(`/health?date=${date}`);
  const button = page.getByRole('button', { name: new RegExp(`Adjust ${field} of Dinner dish`) });
  await expect(button).toBeVisible({ timeout: 20000 });
  const box = await button.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + dx, box.y + box.height / 2, { steps: 5 });
  const expectedCalories = { portion: 310, calories: 320, density: 360, protein: 320, carbs: 320, fat: 345 }[field];
  await expect(page.locator('.health-equation')).toContainText(String(expectedCalories));
  expect(state.requests.filter(request => request.method === 'PUT')).toHaveLength(0);
  await page.mouse.up();
  await expect.poll(() => state.requests.filter(request => request.method === 'PUT').length).toBe(1);
  expect(state.items.filter(row => row.parentId === 'g').reduce((sum, row) => sum + row.calories, 0)).toBeCloseTo(expectedCalories);
  expect(state.items.find(row => row.uuid === 'g').calories).toBe(0);
  await expect(button).toBeEnabled();
});

test('group macro edits update children; group density accepts exact input; Escape cancels', async ({ page }) => {
  const group = { ...a, uuid: 'g', name: 'Dinner dish', kind: 'group', calories: 0, protein: 0, carbs: 0, fat: 0, grams: 300 };
  const state = await installHealthFixtures(page, { items: [group, { ...a, parentId: 'g' }, { ...b, parentId: 'g' }] });
  await page.goto(`/health?date=${date}`);
  const protein = page.getByRole('button', { name: /Adjust protein of Dinner dish/ });
  await protein.click();
  await page.getByRole('textbox', { name: 'protein (g)' }).fill('45');
  await expect(page.getByRole('button', { name: /Adjust protein of Eggs/ })).toContainText('30');
  await expect(page.getByRole('button', { name: /Adjust protein of Beans/ })).toContainText('15');
  await page.getByRole('button', { name: 'Apply', exact: true }).click();
  await expect.poll(() => state.items.find(row => row.uuid === 'a').protein).toBe(30);
  expect(state.items.find(row => row.uuid === 'g').calories).toBe(0);
  const density = page.getByRole('button', { name: /Adjust density of Dinner dish/ });
  await expect(density).toBeEnabled();
  await density.click();
  await page.getByRole('textbox', { name: 'density (kcal/g)' }).fill('2');
  await expect(page.locator('.health-equation')).toContainText('600');
  await page.keyboard.press('Escape');
  await expect(page.locator('.health-equation')).toContainText('360');
  expect(state.requests.filter(request => request.method === 'PUT')).toHaveLength(1);
});

test('failed numeric save preserves the preview and retries the same operation', async ({ page }) => {
  const state = await installHealthFixtures(page, { items: [a] });
  let failedBody;
  await page.route('**/api/v1/health/nutrilist/a', route => {
    if (!failedBody && route.request().method() === 'PUT') {
      failedBody = route.request().postDataJSON();
      return route.fulfill({ status: 503, json: { error: 'Temporary outage' } });
    }
    return route.fallback();
  });
  await page.goto(`/health?date=${date}`);
  const protein = page.getByRole('button', { name: /Adjust protein of Eggs/ });
  await protein.focus();
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('alert')).toContainText('Could not save');
  await expect(page.locator('.health-equation')).toContainText('204');
  expect(state.items[0].calories).toBe(200);
  await page.getByRole('button', { name: 'Retry same change' }).click();
  await expect.poll(() => state.items[0].calories).toBe(204);
  expect(state.requests.find(request => request.method === 'PUT').body).toEqual(failedBody);
});

test.describe('touch nutrition control', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  test('horizontal touch drag adjusts fat and touch cancellation sends nothing', async ({ page }) => {
    const state = await installHealthFixtures(page, { items: [a] });
    await page.goto(`/health?date=${date}`);
    const fat = page.getByRole('button', { name: /Adjust fat of Eggs/ });
    await expect(fat).toBeVisible({ timeout: 20000 });
    await fat.scrollIntoViewIfNeeded();
    const box = await fat.boundingBox();
    const client = await page.context().newCDPSession(page);
    const point = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [point] });
    await client.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ ...point, x: point.x + 10 }] });
    await expect(fat).toContainText('10');
    expect(state.requests.filter(request => request.method === 'PUT')).toHaveLength(0);
    await client.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] });
    await expect(fat).toContainText('5');
    expect(state.requests.filter(request => request.method === 'PUT')).toHaveLength(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
  });
});
