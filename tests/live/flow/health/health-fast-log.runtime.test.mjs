import { test, expect } from '@playwright/test';
import { installHealthFixtures } from './healthFixtures.mjs';

test('suggestion → food → centered correction → delete → Undo, without household writes', async ({ page }) => {
  const state = await installHealthFixtures(page, { foods: [{ id: 'food-chicken', name: 'Fixture chicken', grams: 150, calories: 231, protein: 43, carbs: 0, fat: 5 }] });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('/health');
  await page.getByRole('button', { name: /Add food to/ }).first().click();
  await page.getByRole('option', { name: /Fixture chicken/ }).click();
  const row = page.locator('.health-row-line', { hasText: 'Fixture chicken' });
  await expect(row).toBeVisible();
  expect(state.requests.filter(request => request.method === 'POST')).toHaveLength(1);
  await row.locator('.health-row__identity').click();
  const panel = page.locator('.ds-sheet__panel');
  await expect(panel).toBeVisible();
  const rect = await panel.boundingBox();
  expect(Math.abs(rect.x + rect.width / 2 - 720)).toBeLessThan(3);
  await expect(page.getByLabel('Portion in g')).toBeFocused();
  await page.getByLabel('Portion in g').fill('75');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(row).toContainText('75 g');
  await row.locator('.health-row__identity').click();
  await page.getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(row).toHaveCount(0);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(row).toContainText('75 g');
  expect(state.unexpected).toEqual([]);
});
