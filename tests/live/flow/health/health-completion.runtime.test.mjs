import { test, expect } from '@playwright/test';
import { installHealthFixtures } from './healthFixtures.mjs';

test('favorites follow stable food identity after a rename and do not leak to another entry', async ({ page }) => {
  const state = await installHealthFixtures(page, {
    foods: [{ id: 'food-a', name: 'Renamed oats', favorite: true }, { id: 'food-b', name: 'Toast', favorite: false }],
    items: [{ uuid: 'a', foodId: 'food-a', name: 'Original oats', date: '2026-09-01', mealTime: 'morning', grams: 80, calories: 300 },
      { uuid: 'b', foodId: 'food-b', name: 'Toast', date: '2026-09-01', mealTime: 'morning', grams: 40, calories: 100 }],
  });
  await page.goto('/health?date=2026-09-01');
  await page.locator('.health-row', { hasText: 'Original oats' }).click();
  await expect(page.getByRole('button', { name: 'favorite', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'favorite', exact: true }).click();
  await expect(page.getByRole('button', { name: 'favorite', exact: true })).toHaveAttribute('aria-pressed', 'false');
  expect(state.requests.find(request => request.method === 'PUT')?.body).toEqual({ id: 'food-a', favorite: false });
  await page.keyboard.press('Escape');
  await page.locator('.health-row', { hasText: 'Toast' }).click();
  await expect(page.getByRole('button', { name: 'favorite', exact: true })).toHaveAttribute('aria-pressed', 'false');
  expect(state.foods).toHaveLength(2);
  expect(state.items[0].name).toBe('Original oats');
  expect(state.unexpected).toEqual([]);
});

test('coach shares identity, selected-entry context and visible history between overlay, tab and reload', async ({ page }) => {
  const state = await installHealthFixtures(page, { items: [{ uuid: 'a', name: 'Fixture oats', date: '2026-09-01', mealTime: 'morning', grams: 80, calories: 300 }] });
  const calls = [];
  await page.route('**/api/v1/agents/health-coach/run-stream', async route => {
    calls.push(route.request().postDataJSON());
    await route.fulfill({ contentType: 'text/event-stream', body:
      'data: {"type":"text-delta","text":"Fixture coach answer"}\n\ndata: {"type":"finish","reason":"stop"}\n\ndata: {"type":"done"}\n\n' });
  });
  await page.goto('/health?date=2026-09-01');
  const row = page.locator('.health-row', { hasText: 'Fixture oats' });
  await expect(row).toBeVisible({ timeout: 30000 });
  expect(state.requests.filter(request => request.endpoint === '/mentions/all')).toHaveLength(0);
  await row.click();
  await page.getByText('Nutrition, date & evidence', { exact: true }).click();
  await page.getByRole('button', { name: 'Ask coach about this entry' }).click();
  const overlay = page.getByRole('dialog', { name: 'Health Coach' });
  await overlay.getByRole('textbox').fill('Help me with this portion');
  await overlay.getByRole('textbox').press('Enter');
  await expect(overlay.getByText('Fixture coach answer', { exact: true })).toBeVisible();
  expect(calls).toHaveLength(1);
  expect(calls[0].context).toMatchObject({ userId: 'health-fixture', selectedDate: '2026-09-01', selectedEntry: { id: 'a', name: 'Fixture oats', date: '2026-09-01' } });
  await page.keyboard.press('Escape');
  await expect(overlay).not.toBeVisible();
  await expect(row).toBeFocused();
  await page.getByRole('link', { name: 'Coach', exact: true }).click();
  await expect(page.getByText('Fixture coach answer', { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByText('Fixture coach answer', { exact: true })).toBeVisible();
  expect(calls).toHaveLength(1);
  expect(state.unexpected).toEqual([]);
});

test('double-tapping a pending quick-add creates only one request and one row', async ({ page }) => {
  const state = await installHealthFixtures(page, { foods: [{ id: 'food-a', name: 'Fixture oats', grams: 80, calories: 300 }] });
  let release;
  const wait = new Promise(resolve => { release = resolve; });
  let requests = 0;
  await page.route('**/api/v1/health/nutrition/catalog/quickadd', async route => { requests++; await wait; await route.fallback(); });
  await page.goto('/health');
  await page.getByText('+ Add food…', { exact: true }).first().click();
  await page.getByRole('option', { name: /Fixture oats/ }).evaluate(element => { element.click(); element.click(); });
  await expect.poll(() => requests).toBe(1);
  release();
  await expect.poll(() => state.items.length).toBe(1);
  expect(requests).toBe(1);
  expect(state.unexpected).toEqual([]);
});

test('scanner releases its media after its first result and acquires a fresh stream on reopen', async ({ page }) => {
  await page.addInitScript(() => {
    window.fixtureStreams = [];
    const acquire = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = async constraints => {
      const stream = await acquire(constraints);
      window.fixtureStreams.push(stream);
      return stream;
    };
    window.BarcodeDetector = class { async detect() { return [{ rawValue: 'fixture-upc' }]; } };
  });
  const state = await installHealthFixtures(page, { foods: [{ id: 'food-a', name: 'Fixture oats', upc: 'fixture-upc', grams: 80, calories: 300 }] });
  await page.goto('/health');
  for (let count = 1; count <= 2; count++) {
    await page.getByRole('button', { name: 'Scan barcode to Breakfast', exact: true }).click();
    await expect.poll(() => state.items.length).toBe(count);
    await expect.poll(() => page.evaluate(() => window.fixtureStreams.length)).toBe(count);
    await expect.poll(() => page.evaluate(() => window.fixtureStreams.every(stream => stream.getTracks().every(track => track.readyState === 'ended')))).toBe(true);
  }
  expect(state.requests.filter(request => request.endpoint === '/nutrition/input')).toHaveLength(2);
  expect(state.unexpected).toEqual([]);
});
