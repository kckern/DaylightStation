import { test, expect } from '@playwright/test';
import { installHealthFixtures } from './healthFixtures.mjs';

test('draft and scroll survive tab navigation; absent goals offer a real form; medical rows retain units', async ({ page }) => {
  const state = await installHealthFixtures(page);
  await page.route('**/api/v1/health/medical', route => route.fulfill({ json: { metrics: [{ metric: 'glucose', unit: 'mmol/L', latest: { value: 5, unit: 'mmol/L' }, readings: [
    { id: 'a', date: '2026-09-01', value: 90, unit: 'mg/dL' }, { id: 'b', date: '2026-09-02', value: 5, unit: 'mmol/L' },
  ] }] } }));
  await page.setViewportSize({ width: 390, height: 700 });
  await page.goto('/health?date=2026-09-01');
  await page.getByText('+ Add food…', { exact: true }).last().click();
  await page.getByRole('combobox').fill('my unfinished food');
  const priorScroll = await page.locator('.ds-chrome__main').evaluate(element => element.scrollTop);
  await page.getByRole('link', { name: 'Medical', exact: true }).click();
  await expect(page.locator('.health-medical__row').first()).toContainText('90 mg/dL');
  await expect(page.locator('.health-medical__row').last()).toContainText('5 mmol/L');
  await page.getByRole('link', { name: 'Progress', exact: true }).click();
  await expect(page.getByLabel('Birth year')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Save goals', exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Today', exact: true }).click();
  await expect(page.getByRole('combobox')).toHaveValue('my unfinished food');
  await expect(page).toHaveURL(/date=2026-09-01/);
  await expect.poll(() => page.locator('.ds-chrome__main').evaluate(element => element.scrollTop)).toBe(priorScroll);
  expect(state.unexpected).toEqual([]);
  await page.screenshot({ path: test.info().outputPath('mobile-draft.png') });
});

test('entry dialog contains keyboard focus and restores it on Escape', async ({ page }) => {
  const state = await installHealthFixtures(page, { items: [{ uuid: 'row-a', name: 'Fixture oats', date: '2026-09-01', mealTime: 'morning', grams: 80, calories: 300 }] });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('/health?date=2026-09-01');
  const row = page.locator('.health-row', { hasText: 'Fixture oats' });
  await row.click();
  await expect(page.getByLabel('Weight in grams')).toBeFocused();
  for (let i = 0; i < 20; i++) {
    await page.keyboard.press('Tab');
    expect(await page.evaluate(() => Boolean(document.activeElement?.closest('[role="dialog"]')))).toBe(true);
  }
  await page.screenshot({ path: test.info().outputPath('desktop-editor.png') });
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(row).toBeFocused();
  expect(state.unexpected).toEqual([]);
});

test('failed voice capture keeps retry bytes and original day across tabs', async ({ page }) => {
  const state = await installHealthFixtures(page);
  let attempts = 0;
  await page.route('**/api/v1/health/nutrition/input', route => {
    attempts++;
    return attempts === 1 ? route.fulfill({ status: 503, json: { error: 'Please retry this recording' } }) : route.fallback();
  });
  await page.goto('/health?date=2026-09-01');
  await page.getByRole('button', { name: 'Log by voice to Breakfast', exact: true }).click();
  await page.getByRole('button', { name: 'Stop recording — Breakfast', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Retry recording', exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Medical', exact: true }).click();
  await page.getByRole('link', { name: 'Today', exact: true }).click();
  await page.getByRole('button', { name: 'Previous week', exact: true }).click();
  await page.locator('.health-weekstrip__cell').first().click();
  await page.getByRole('button', { name: 'Retry recording', exact: true }).click();
  await expect.poll(() => state.items.length).toBe(1);
  expect(state.items[0].date).toBe('2026-09-01');
  expect(attempts).toBe(2);
  expect(state.unexpected).toEqual([]);
});
