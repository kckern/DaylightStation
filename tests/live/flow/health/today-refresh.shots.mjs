// Visual check for the Today refresh (summary bar, quiet add rows, drag to
// meal, preview card). Browser-only: every /api call is answered by
// installHealthFixtures, so nothing touches the household.
//   node tests/live/flow/health/today-refresh.shots.mjs <outDir> [baseUrl]
import { chromium } from '@playwright/test';
import { installHealthFixtures } from './healthFixtures.mjs';

const out = process.argv[2] || '.';
const base = process.argv[3] || 'http://localhost:3111';
const d = new Date(); d.setDate(d.getDate() - 1);
const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

let n = 0;
const row = (mealTime, name, calories, grams, protein, carbs, fat, extra = {}) => ({
  uuid: `r${++n}`, id: `r${n}`, version: 1, date, mealTime, name, item: name, calories, grams, amount: grams, unit: 'g',
  protein, carbs, fat, settled: true, icon: 'default', ...extra,
});
const items = [
  row('morning', 'Pancakes', 310, 140, 7, 53, 7),
  row('morning', 'Applesauce', 15, 20, 0, 4, 0),
  row('afternoon', 'Peanut Butter Spread', 210, 32, 7, 4, 18),
  row('afternoon', 'Strawberry Milkshake', 140, null, 30, 5, 1, { amount: 325, unit: 'ml' }),
  row('afternoon', "Dave's killer bread", 120, 42, 5, 21, 3),
  row('afternoon', 'Roasted Pine Nut Hummus', 80, 30, 2, 5, 6),
  { ...row('night', 'Croissant Sandwich', 0, 215, 0, 0, 0), uuid: 'g1', id: 'g1', kind: 'group' },
  row('night', 'Croissant', 420, 110, 7, 37, 28, { parentId: 'g1' }),
  row('night', 'Tuna', 100, 85, 20, 0, 2, { parentId: 'g1' }),
  row('night', 'Pickles', 3, 20, 0, 1, 0, { parentId: 'g1' }),
  row('night', 'Mexican Style 4 Cheese Blend', 121, 31, 8, 1, 10),
  { ...row('night', 'Spinach Salad', 0, 90, 0, 0, 0), uuid: 'g2', id: 'g2', kind: 'group' },
  row('night', 'Vinaigrette', 68, 20, 0, 2, 7, { parentId: 'g2' }),
  row('night', 'Spinach', 16, 70, 2, 2, 0, { parentId: 'g2' }),
];

const browser = await chromium.launch();
try {
  for (const [label, viewport] of [['desktop', { width: 1440, height: 1100 }], ['phone', { width: 390, height: 1400 }]]) {
    const page = await browser.newPage({ viewport });
    const state = await installHealthFixtures(page, { items, budgetBase: 1791, exercise: 231 });
    await page.goto(`${base}/health?date=${date}`);
    await page.getByText('Pancakes', { exact: true }).waitFor();
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${out}/${label}-today.png`, fullPage: true });
    if (label === 'desktop') {
      // Hover a row: full-row wash + the preview card above the artwork.
      await page.getByText('Peanut Butter Spread', { exact: true }).hover();
      await page.waitForTimeout(150);
      await page.screenshot({ path: `${out}/desktop-hover.png`, clip: { x: 0, y: 0, width: 1440, height: 700 } });
      // Mid-drag: Mexican cheese from Snacks toward Dinner.
      const cheese = page.getByText('Mexican Style 4 Cheese Blend', { exact: true });
      const from = await cheese.boundingBox();
      const dinner = await page.getByRole('heading', { name: 'Dinner' }).boundingBox();
      await page.mouse.move(from.x + 20, from.y + 8);
      await page.mouse.down();
      await page.mouse.move(from.x + 30, from.y + 20, { steps: 3 });
      await page.mouse.move(dinner.x + 120, dinner.y + 30, { steps: 12 });
      await page.waitForTimeout(150);
      await page.screenshot({ path: `${out}/desktop-dragging.png`, fullPage: true });
      await page.mouse.up();
      await page.waitForTimeout(500);
      await page.screenshot({ path: `${out}/desktop-dropped.png`, fullPage: true });
      const puts = state.requests.filter(r => r.method === 'PUT');
      console.log('PUTs after drop:', JSON.stringify(puts.map(r => [r.endpoint, r.body?.mealTime])));
      // Whole meal: drag the Snacks header onto Dinner.
      const snacks = await page.getByRole('heading', { name: 'Snacks' }).boundingBox();
      const dinnerNow = await page.getByRole('heading', { name: 'Dinner' }).boundingBox();
      await page.mouse.move(snacks.x + 5, snacks.y + 5);
      await page.mouse.down();
      await page.mouse.move(snacks.x + 20, snacks.y + 20, { steps: 3 });
      await page.mouse.move(dinnerNow.x + 120, dinnerNow.y + 30, { steps: 12 });
      await page.waitForTimeout(150);
      await page.screenshot({ path: `${out}/desktop-meal-dragging.png`, clip: { x: 320, y: 140, width: 1120, height: 560 } });
      await page.mouse.up();
      await page.waitForTimeout(600);
      await page.screenshot({ path: `${out}/desktop-meal-dropped.png`, fullPage: true });
      const mealPuts = state.requests.filter(r => r.method === 'PUT').slice(puts.length);
      console.log('meal PUTs:', JSON.stringify(mealPuts.map(r => [r.endpoint, r.body?.mealTime])));
    }
    await page.close();
  }
} finally { await browser.close(); }
