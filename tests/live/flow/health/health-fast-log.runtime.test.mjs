import { test, expect } from '@playwright/test';
import { installHealthFixtures } from './healthFixtures.mjs';

test('suggestion → food → centered correction → delete → Undo, without household writes', async ({ page }) => {
  const state = await installHealthFixtures(page, { foods: [{ id: 'food-chicken', name: 'Fixture chicken', grams: 150, calories: 231, protein: 43, carbs: 0, fat: 5 }] });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('/health');
  await page.getByRole('combobox', { name: 'Add to Lunch' }).click();
  await page.getByRole('option', { name: /Fixture chicken/ }).click();
  const row = page.locator('.health-row-line', { hasText: 'Fixture chicken' });
  await expect(row).toBeVisible();
  expect(state.requests.filter(request => request.method === 'POST')).toHaveLength(1);
  const opener = row.getByRole('button', { name: 'Edit Fixture chicken', exact: true });
  await opener.click();
  const panel = page.locator('.ds-sheet__panel');
  await expect(panel).toBeVisible();
  const rect = await panel.boundingBox();
  expect(Math.abs(rect.x + rect.width / 2 - 720)).toBeLessThan(3);
  await expect(page.getByLabel('Portion in g')).toBeFocused();
  await page.getByLabel('Portion in g').fill('75');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(row).toContainText('75 g');
  await opener.click();
  await page.getByRole('button', { name: 'Delete', exact: true }).click();
  // Delete confirms first, from the sheet as from the row X (30e98f20f): the
  // sheet's button only asks, and nothing is removed until the confirm says yes.
  const confirm = page.getByRole('dialog', { name: 'Delete Fixture chicken?' });
  await expect(confirm).toBeVisible();
  expect(state.requests.filter(request => request.method === 'DELETE')).toHaveLength(0);
  await expect(row).toHaveCount(1);
  await confirm.getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(row).toHaveCount(0);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(row).toContainText('75 g');
  expect(state.unexpected).toEqual([]);
});
