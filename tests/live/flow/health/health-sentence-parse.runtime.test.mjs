// Fixture-backed journey. No user data is created or removed by this test.
import { test, expect } from '@playwright/test';

test('sentence logs immediately, without an extra accept step', async ({ page }) => {
  let items = [];
  let creates = 0;
  await page.route('**/api/v1/health/**', async route => {
    const request = route.request();
    const url = new URL(request.url());
    if (request.method() === 'POST' && url.pathname.endsWith('/nutrition/input')) {
      creates++;
      const { date, bucket } = request.postDataJSON();
      items = [{ uuid: 'fixture-eggs', name: 'Scrambled eggs', date, mealTime: bucket,
        grams: 100, calories: 150, protein: 12, carbs: 2, fat: 10, settled: false }];
      return route.fulfill({ json: { committed: true, entryIds: ['fixture-eggs'], date, mealTime: bucket } });
    }
    if (request.method() !== 'GET') return route.abort('blockedbyclient');
    const payload = url.pathname.endsWith('/context') ? { userId: 'health-fixture' }
      : url.pathname.endsWith('/day') ? { items, date: url.searchParams.get('date'), revision: creates,
        budget: { budget: 2000, food: items.length * 150, exercise: 0, remaining: 2000 - items.length * 150, macros: {}, sessions: [] } }
      : url.pathname.includes('/nutrilist') ? { data: items }
      : url.pathname.endsWith('/budget') ? { budget: 2000, food: items.length * 150, exercise: 0, remaining: 2000 - items.length * 150, macros: {}, sessions: [] }
      : url.pathname.endsWith('/budget/range') ? { days: [] }
      : url.pathname.endsWith('/catalog/suggest') ? { items: [] }
      : url.pathname.endsWith('/nutrition/observations') ? { observations: [] }
      : url.pathname.endsWith('/nutrition/pending') ? { pending: [] }
      : {};
    return route.fulfill({ json: payload });
  });
  await page.route('**/api/v1/lifelog/weight', route => route.fulfill({ json: {} }));
  await page.goto('/health');
  await page.getByText(/Add food/).first().click();
  const input = page.getByRole('combobox', { name: 'Food name or sentence' });
  await input.fill('two scrambled eggs');
  await input.press('Enter');
  await expect(page.locator('.health-row', { hasText: /Scrambled eggs/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /^accept$/i })).toHaveCount(0);
  expect(creates).toBe(1);
});
