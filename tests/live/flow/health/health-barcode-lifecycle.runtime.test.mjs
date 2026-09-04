import { test, expect } from '@playwright/test';
import { installHealthFixtures } from './healthFixtures.mjs';

test('unknown barcode → gram-based custom food → known rescan, entirely fixture-owned', async ({ page }) => {
  const state = await installHealthFixtures(page);
  await page.goto('/health');
  const scan = page.getByRole('button', { name: 'Scan barcode to Breakfast', exact: true });
  await scan.click();
  await page.getByLabel('Manual UPC entry').fill('999999123456');
  await page.getByRole('button', { name: /look up/i }).click();
  await expect(page.getByText(/isn't in any database/)).toBeVisible();
  await page.getByLabel('Name', { exact: true }).fill('Fixture granola');
  await page.getByLabel(/Calories/).fill('210');
  await page.getByLabel(/grams/i).fill('50');
  await page.getByRole('button', { name: /create & log/i }).click();
  await expect(page.locator('.health-row', { hasText: 'Fixture granola' })).toHaveCount(1);
  await scan.click();
  await page.getByLabel('Manual UPC entry').fill('999999123456');
  await page.getByRole('button', { name: /look up/i }).click();
  await expect(page.locator('.health-row', { hasText: 'Fixture granola' })).toHaveCount(2);
  expect(state.items.every(row => row.grams === 50)).toBe(true);
  expect(state.unexpected).toEqual([]);
});
