import { test, expect } from '@playwright/test';
import { installHealthFixtures } from './healthFixtures.mjs';

test('one voice control owns its spinner; capture keeps its original day during navigation', async ({ page }) => {
  const state = await installHealthFixtures(page);
  let release;
  state.holdCapture = new Promise(resolve => { release = resolve; });
  await page.goto('/health');
  await page.getByRole('button', { name: 'Log by voice to Breakfast', exact: true }).click();
  await page.getByRole('button', { name: 'Stop recording — Breakfast', exact: true }).click();
  await expect.poll(() => state.requests.filter(request => request.endpoint === '/nutrition/input').length).toBe(1);
  await expect(page.locator('.health-meal__capture-btn[data-loading]')).toHaveCount(1);
  const originalDay = state.requests.find(request => request.endpoint === '/nutrition/input').body.date;
  await page.getByRole('button', { name: 'Previous week', exact: true }).click();
  await page.locator('.health-weekstrip__cell').first().click();
  await expect(page).not.toHaveURL(new RegExp('date=' + originalDay));
  release();
  await expect(page.locator('.health-meal__capture-btn[data-loading]')).toHaveCount(0);
  await expect.poll(() => state.items.length).toBe(1);
  expect(state.items[0].date).toBe(originalDay);
  expect(state.unexpected).toEqual([]);
});

test('mobile picker is bounded and weeks can be paged without moving selection', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const state = await installHealthFixtures(page, { foods: [{ id: 'oats', name: 'Oatmeal', grams: 80, calories: 300 }] });
  await page.goto('/health');
  await page.getByText('+ Add food…', { exact: true }).first().click();
  const option = page.getByRole('option', { name: /Oatmeal/ });
  await expect(option).toBeVisible();
  await expect(option).toContainText('80 g');
  await expect(option.locator('svg')).toHaveCount(1);
  const bounds = await page.locator('.health-suggest__list').boundingBox();
  expect(bounds.x).toBeGreaterThanOrEqual(0);
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(390);
  await page.getByRole('combobox').press('Escape');
  const selected = await page.locator('[aria-current="date"]').getAttribute('data-date');
  const initialRange = await page.locator('.health-weekstrip__range').textContent();
  await page.getByRole('button', { name: 'Previous week', exact: true }).click();
  const olderRange = await page.locator('.health-weekstrip__range').textContent();
  expect(olderRange).not.toBe(initialRange);
  expect(state.requests.filter(request => request.endpoint === '/day').at(-1).body).toBeNull();
  await page.goBack();
  await expect(page.locator('.health-weekstrip__range')).toHaveText(initialRange);
  await expect(page.locator('[aria-current="date"]')).toHaveAttribute('data-date', selected);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
  expect(overflow).toBe(false);
});
