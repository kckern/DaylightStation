import { test, expect } from '@playwright/test';
import { installHealthFixtures } from './healthFixtures.mjs';

test.use({ serviceWorkers: 'block' });
const date = '2026-09-05';
const chia = { uuid: 'chia', name: 'Chia seeds', grams: 14, amount: 14, unit: 'g', calories: 70, protein: 3, carbs: 4.5, fat: 4, version: 1, settled: false, date, mealTime: 'afternoon' };
const items = [chia,
  { ...chia, uuid: 'yogurt', name: 'Plain yogurt', grams: null, amount: 170, unit: 'ml', calories: 160 },
  { ...chia, uuid: 'scale', name: 'Weighed food', grams: 458, calories: 641, protein: null, fat: null, carbs: null, settled: true },
  { ...chia, uuid: 'group', name: 'Burrito', kind: 'group', grams: 397, calories: 0, settled: true, mealTime: 'evening' },
  { ...chia, uuid: 'filling', name: 'Filling', parentId: 'group', grams: 397, calories: 668, settled: true, mealTime: 'evening' },
];
const start = async page => {
  const state = await installHealthFixtures(page, { items, budgetBase: 1788, exercise: 347 });
  await page.goto(`/health?date=${date}`);
  await expect(page.getByRole('button', { name: 'Adjust portion of Chia seeds, 14 g' })).toBeVisible({ timeout: 20000 });
  return state;
};
// Every meal renders, empty or not (3f503e724), so the first `.health-meal` is
// an empty Breakfast; pick meals by their heading.
const meal = (page, label) => page.locator('.health-meal', { has: page.getByRole('heading', { name: label, exact: true }) });
const writes = state => state.requests.filter(request => request.method === 'PUT');
const drag = async page => {
  const button = page.getByRole('button', { name: /Adjust portion of Chia seeds/ });
  const box = await button.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 28, box.y + box.height / 2, { steps: 6 });
};

test('pointer preview updates the whole day, release commits once, Escape cancels', async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  const state = await start(page);
  await drag(page);
  // The whole row, not the name button's parent: since b3eea0c5c that parent is
  // the identity cell (density badge + artwork + name), which holds no numbers.
  const row = page.locator('.health-row-line', { has: page.getByRole('button', { name: 'Edit Chia seeds', exact: true }) });
  await expect(row).toContainText('140');
  await expect(page.locator('.health-equation')).toContainText('1,609');
  await expect(page.locator('.health-equation')).toContainText('526');
  await expect(meal(page, 'Lunch')).toContainText('941 kcal');
  expect(writes(state)).toHaveLength(0);
  await page.keyboard.press('Escape');
  await page.mouse.up();
  await expect(row).toContainText('14 g');
  expect(writes(state)).toHaveLength(0);
  await drag(page);
  await page.mouse.up();
  await expect.poll(() => writes(state).length).toBe(1);
  expect(writes(state)[0].body).toMatchObject({ expectedVersion: 1, expectedVersions: { chia: 1 }, portion: { value: 28, unit: 'g' }, operationId: expect.any(String) });
  await expect(page.getByRole('button', { name: 'Confirm entry: Chia seeds' })).toBeEnabled();
  expect(state.items.find(row => row.uuid === 'chia').settled).toBe(false);
  expect(state.unexpected).toEqual([]);
});

test('direct volume entry and keyboard adjustments do not invent grams or auto-confirm', async ({ page }) => {
  const state = await start(page);
  await page.getByRole('button', { name: /Adjust portion of Plain yogurt/ }).click();
  const input = page.getByRole('textbox', { name: 'Portion (ml)' });
  await input.fill('340');
  expect(writes(state)).toHaveLength(0);
  await page.getByRole('button', { name: 'Apply', exact: true }).click();
  await expect.poll(() => writes(state).length).toBe(1);
  expect(state.items.find(row => row.uuid === 'yogurt')).toMatchObject({ grams: null, amount: 340, calories: 320, settled: false });
  const chiaButton = page.getByRole('button', { name: /Adjust portion of Chia seeds/ });
  await expect(chiaButton).toBeEnabled();
  await chiaButton.focus();
  await page.keyboard.press('ArrowRight');
  await expect(chiaButton).toContainText('15 g');
  expect(writes(state)).toHaveLength(1);
  await page.keyboard.press('Escape');
  await expect(chiaButton).toContainText('14 g');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Enter');
  await expect.poll(() => writes(state).length).toBe(2);
});

// Touch is emulated on the phone and tablet sizes: rows are compact (28px) for
// a fine pointer by design (b3eea0c5c) and grow to 44px targets on a coarse
// pointer or a phone-width column, which is what this pins.
for (const [width, height, touch] of [[390, 844, true], [768, 1024, true], [1024, 768, true], [1366, 768, false], [1440, 900, false], [1920, 1080, false]]) {
  test.describe(`compact log at ${width}×${height}`, () => {
    test.use({ hasTouch: touch });
    test(`compact log at ${width}×${height}${touch ? ' (touch)' : ''}`, async ({ page }, testInfo) => {
      await page.setViewportSize({ width, height });
      await start(page);
      expect(await page.evaluate(() => matchMedia('(pointer: coarse)').matches)).toBe(touch);
      // Budget bar above, then meals: the log starts high on the page. The first
      // food sits below an always-shown empty Breakfast strip and its meal's
      // toolbar (3f503e724, ab7eface9), which is why its bound is lower than the
      // f81b295ae figures of 300/350 that predate both.
      const firstMeal = await page.locator('.health-meal').first().boundingBox();
      const first = await page.locator('.health-row-line').first().boundingBox();
      if (width === 390) { expect(firstMeal.y).toBeLessThanOrEqual(280); expect(first.y).toBeLessThanOrEqual(430); }
      if (width >= 1200) {
        expect(firstMeal.y).toBeLessThanOrEqual(210);
        expect(first.y).toBeLessThanOrEqual(360);
        // Two meal columns, Breakfast→Lunch on the left and Dinner→Snacks on the
        // right (ee47bcabf), their heads level with each other.
        const breakfast = await meal(page, 'Breakfast').boundingBox();
        const lunch = await meal(page, 'Lunch').boundingBox();
        const dinner = await meal(page, 'Dinner').boundingBox();
        expect(dinner.x).toBeGreaterThan(breakfast.x);
        expect(dinner.y).toBe(breakfast.y);
        expect(lunch.x).toBe(breakfast.x);
        expect(lunch.y).toBeGreaterThan(breakfast.y);
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
      const minHeight = touch || width < 768 ? 44 : 28;
      for (const name of [/Adjust portion of Chia seeds/, /^Delete entry: Chia seeds$/, /^Confirm entry: Chia seeds$/, /^Adjust density of Chia seeds/, /^Edit Chia seeds$/]) {
        const box = await page.getByRole('button', { name }).boundingBox();
        expect(box, String(name)).not.toBeNull();
        expect(box.height, `${name} height`).toBeGreaterThanOrEqual(minHeight);
      }
      const portion = await page.getByRole('button', { name: /Adjust portion of Chia seeds/ }).boundingBox();
      expect(portion.width).toBeGreaterThanOrEqual(44);
      await page.screenshot({ path: testInfo.outputPath(`health-${width}.png`) });
    });
  });
}
