import { test, expect } from '@playwright/test';
import { installHealthFixtures } from './healthFixtures.mjs';
const date = '2026-09-04';
const items = [
  { uuid: 'taco', name: 'Fish Taco', kind: 'group', calories: 0, grams: 105, icon: 'default' },
  { uuid: 'tortilla', name: 'Tortilla', parentId: 'taco', calories: 145, grams: 50, icon: 'tortilla' },
  { uuid: 'fish', name: 'White Fish', parentId: 'taco', calories: 52, grams: 55, icon: 'default' },
].map(row => ({ ...row, date, mealTime: 'afternoon', version: 1 }));

for (const width of [1440, 390]) test(`group and review layout at ${width}px`, async ({ page }, testInfo) => {
  await page.setViewportSize({ width, height: 1000 });
  const state = await installHealthFixtures(page, { items });
  let pending = [{ id: 'shake', version: 'v1', date, mealTime: 'afternoon', source: 'scanner', captureMethod: 'upc',
    items: [{ id: 'shake-item', label: 'Fixture protein shake', grams: null, amount: 325, unit: 'ml', calories: 160, protein: 30 }] }];
  await page.route('**/api/v1/health/nutrition/pending?*', route => route.fulfill({ json: { pending } }));
  let release;
  const imageWait = new Promise(resolve => { release = resolve; });
  await page.route('**/api/v1/health/nutrition/icons/tortilla', async route => {
    await imageWait;
    await route.fulfill({ contentType: 'image/png', body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jN1kAAAAASUVORK5CYII=', 'base64') });
  });
  let reviewed;
  await page.route('**/api/v1/health/nutrition/pending/shake/review', async route => {
    reviewed = route.request().postDataJSON(); pending = [];
    await route.fulfill({ json: { success: true } });
  });
  await page.goto('/health?date=' + date);
  const group = page.getByRole('button', { name: 'Collapse Fish Taco', exact: true });
  await expect(group).toBeVisible();
  await expect(page.getByText('Total · 197 kcal')).toBeVisible();
  const tortilla = page.locator('.health-row', { hasText: 'Tortilla' });
  const before = await tortilla.boundingBox();
  release();
  await expect(tortilla.locator('.health-food-art')).toHaveAttribute('data-state', 'ready');
  expect(await tortilla.boundingBox()).toEqual(before);
  const slot = await tortilla.locator('.health-food-art').boundingBox();
  expect(slot.width).toBe(24); expect(slot.height).toBe(24);
  await group.click();
  await expect(tortilla).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole('button', { name: 'Expand Fish Taco', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Expand Fish Taco', exact: true }).click();
  await expect(tortilla).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('health-review-layout.png'), fullPage: true });
  await page.getByRole('button', { name: 'Review food', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Review food' });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel('Servings', { exact: true }).fill('0.5');
  await expect(dialog.getByLabel('Calories (kcal)', { exact: true })).toHaveValue('80');
  await dialog.getByRole('button', { name: 'Confirm food' }).click();
  await expect(dialog).not.toBeVisible();
  expect(reviewed).toMatchObject({ expectedVersion: 'v1', portionFactor: 0.5, action: 'confirm' });
  expect(state.unexpected).toEqual([]);
});

for (const width of [1440, 390]) test(`cleanup questions and settings at ${width}px`, async ({ page }, testInfo) => {
  await page.setViewportSize({ width, height: 1000 });
  const fixture = await installHealthFixtures(page, { items });
  let state = { version: 1, settings: { enabled: false, dryRun: true, telegram: false }, runs: [], questions: [
    { id: 'q1', version: 1, status: 'open', question: 'Was the white fish cod?', entryNames: { fish: 'White Fish' },
      choices: [{ id: '0', label: 'Yes, cod', repair: { updates: [{ id: 'fish', changes: { name: 'Cod' } }], createGroups: [] } }] },
  ] };
  let answer;
  await page.route('**/api/v1/health/nutrition/cleanup**', async route => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith('/history')) return route.fulfill({ json: { records: [{ id: 'repair', at: '2026-09-04T19:00:00Z', actor: 'nutrition-auditor', reason: 'Matched fish artwork',
      before: [{ uuid: 'fish', name: 'White Fish', icon: 'default' }], after: [{ uuid: 'fish', name: 'White Fish', icon: 'fish' }], evidence: [{ kind: 'icons' }] }], total: 1 } });
    if (url.pathname.endsWith('/answer')) { answer = route.request().postDataJSON(); state.questions = []; return route.fulfill({ json: { status: 'resolved' } }); }
    if (url.pathname.endsWith('/settings')) { Object.assign(state.settings, route.request().postDataJSON()); state.version++; }
    return route.fulfill({ json: state });
  });
  await page.goto('/health?date=' + date);
  await expect(page.getByText('White Fish: name: Cod')).toBeVisible();
  await page.getByRole('button', { name: 'Yes, cod', exact: true }).click();
  await expect(page.getByText('Was the white fish cod?')).toHaveCount(0);
  expect(answer).toMatchObject({ choiceId: '0', expectedVersion: 1 });
  await page.getByRole('button', { name: 'Health settings', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Nutrition cleanup', exact: true })).toBeVisible();
  await expect(page.getByLabel('Automatic cleanup', { exact: true })).not.toBeChecked();
  await expect(page.getByLabel('Preview only — do not change food or send questions', { exact: true })).toBeChecked();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('cleanup-settings.png'), fullPage: true });
  await page.getByRole('button', { name: 'Details', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Repair details', exact: true });
  await expect(dialog.getByRole('columnheader', { name: 'Before', exact: true })).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Undo this repair', exact: true })).toBeVisible();
  expect(fixture.unexpected).toEqual([]);
});
