// tests/live/flow/health/health-fast-log.runtime.test.mjs
// Benchmark journey #1: per-meal "+ Add food…" → suggest pick → row lands in
// the section, equation strip updates. jsdom cannot see layout/section
// grouping, this can.
import { test, expect } from '@playwright/test';

// Random-suffixed name: the catalog has no delete route, so a fixed name
// accumulates duplicate suggestion rows across repeated runs and breaks
// strict-mode single-match selectors (getByText/toBeVisible require exactly
// one match). A unique name per run keeps every match unambiguous.
const FOOD_NAME = `Playwright Chicken ${Date.now()}`;

test.afterEach(async ({ request }) => {
  // Belt-and-suspenders: if the in-test UI delete didn't run (e.g. an
  // assertion failed mid-flow), sweep today's nutrilist for anything this
  // test's distinctive name created.
  const res = await request.get('/api/v1/health/nutrilist');
  const body = await res.json().catch(() => ({}));
  for (const row of body?.data || []) {
    const name = row.name || row.item || '';
    if (name.includes('Playwright Chicken')) {
      await request.delete(`/api/v1/health/nutrilist/${row.uuid}`).catch(() => {});
    }
  }
});

test('per-meal add → suggest pick → row lands in the section, equation updates', async ({ page, request }) => {
  // Seed a distinctive catalog food via the API.
  await request.post('/api/v1/health/nutrition/catalog', {
    data: { name: FOOD_NAME, calories: 231, protein: 43, carbs: 0, fat: 5 },
  });

  await page.goto('/health');
  // Generous timeout: this suite runs its specs in parallel workers against
  // one dev server process, so first paint can lag under contention.
  await expect(page.getByText('Breakfast')).toBeVisible({ timeout: 20_000 });

  const equationBefore = await page.locator('.health-equation__math').textContent();

  await page.getByText(/Add food/).first().click();
  await page.getByPlaceholder(/Food name/).fill('playwright chick');
  const suggestion = page.locator('.health-suggest__item', { hasText: FOOD_NAME }).first();
  await expect(suggestion).toBeVisible();
  await suggestion.click();

  // The row appears inside the Breakfast section
  const breakfast = page.locator('.health-meal', { hasText: 'Breakfast' });
  await expect(breakfast.getByText(FOOD_NAME)).toBeVisible();

  // Equation strip moved (food total changed)
  await expect(page.locator('.health-equation__math')).not.toHaveText(equationBefore);

  // Cleanup: delete the row via the edit sheet
  page.on('dialog', (d) => d.accept());
  await breakfast.getByText(FOOD_NAME).click();
  await page.getByRole('button', { name: /^Delete$/ }).click();
  await expect(breakfast.getByText(FOOD_NAME)).not.toBeVisible();
});
