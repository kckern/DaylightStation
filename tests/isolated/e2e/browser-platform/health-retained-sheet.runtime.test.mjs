import { expect, test } from '@playwright/test';
import { installHealthFixtures } from '../../../live/flow/health/healthFixtures.mjs';

test.use({ serviceWorkers: 'block', viewport: { width: 390, height: 850 } });

const scrollOverflow = page => () => page.getByRole('main').evaluate(element => ({
  main: getComputedStyle(element).overflowY,
  body: document.body.style.overflow,
}));
const lockedOverflow = { main: 'hidden', body: 'hidden' };

test('Health suspends a retained Today sheet while another route is active', async ({ page }) => {
  await page.routeWebSocket('**/*', () => {});
  const fixture = await installHealthFixtures(page, {
    foods: [{ id: 'oats', name: 'Rolled oats', grams: 80, calories: 300 }],
  });
  await page.route('**/supervision/bootstrap', route => route.fulfill({ json: { enabled: false } }));

  await page.goto('/health/progress');
  const main = page.getByRole('main');
  const overflow = scrollOverflow(page);
  await expect(main).toBeVisible();
  const restingOverflow = { main: 'auto', body: '' };
  await expect.poll(overflow).toEqual(restingOverflow);
  await page.getByRole('link', { name: 'Today', exact: true }).click();
  await page.getByRole('combobox', { name: 'Add to Lunch', exact: true }).click();
  await page.getByRole('button', { name: /Manage saved foods/ }).press('Enter');
  const sheet = page.getByRole('dialog', { name: 'Saved foods', exact: true });
  await sheet.getByRole('button', { name: /Rolled oats/ }).click();
  const name = sheet.getByRole('textbox', { name: 'Food name' });
  await name.fill('Unsaved oats');
  await expect.poll(overflow).toEqual(lockedOverflow);

  await page.goBack();
  await expect(page).toHaveURL(/\/health\/progress$/);
  await expect(sheet).toBeHidden();
  await expect.poll(overflow).toEqual(restingOverflow);
  await page.keyboard.press('Escape');

  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+k' : 'Control+k');
  const coach = page.getByRole('dialog', { name: 'Health Coach', exact: true });
  await expect(coach.locator(':focus')).toHaveCount(1);
  await page.goForward();
  await expect(page).toHaveURL(/\/health$/);
  await expect(page.locator('a[href="/health"][aria-current="page"]')).toHaveCount(1);
  await expect(page.locator('[role="dialog"][aria-label="Saved foods"]')).toBeHidden();
  await page.keyboard.press('Tab');
  await expect(coach.locator(':focus')).toHaveCount(1);
  await page.keyboard.press('Escape');
  await expect(coach).toBeHidden();
  await expect(name).toHaveValue('Unsaved oats');
  await expect(name).toBeFocused();
  await expect.poll(overflow).toEqual(lockedOverflow);
  await page.keyboard.press('Escape');
  await expect(sheet).toBeHidden();
  await expect.poll(overflow).toEqual(restingOverflow);
  expect(fixture.unexpected).toEqual([]);
});

test('Health unlocks Progress while the Today follow-ups sheet is hidden', async ({ page }) => {
  await page.routeWebSocket('**/*', () => {});
  const fixture = await installHealthFixtures(page);
  await page.route('**/supervision/bootstrap', route => route.fulfill({ json: { enabled: false } }));
  await page.route('**/api/v1/health/nutrition/cleanup', route => route.fulfill({ json: {
    questions: [{ id: 'cod', version: 1, status: 'open', question: 'Was the white fish cod?' }],
  } }));

  await page.goto('/health/progress');
  const overflow = scrollOverflow(page);
  const restingOverflow = { main: 'auto', body: '' };
  await expect.poll(overflow).toEqual(restingOverflow);
  await page.getByRole('link', { name: 'Today', exact: true }).click();
  const bell = page.getByRole('button', { name: '1 follow-up question' });
  await bell.click();
  await page.getByRole('menuitem', { name: /Was the white fish cod/ }).click();
  const sheet = page.getByRole('dialog', { name: 'Follow-ups', exact: true });
  await expect(sheet).toBeVisible();
  await expect.poll(overflow).toEqual(lockedOverflow);

  await page.goBack();
  await expect(page).toHaveURL(/\/health\/progress$/);
  await expect.poll(overflow).toEqual(restingOverflow);
  await expect(bell).toBeHidden();
  await page.keyboard.press('Escape');
  await page.goForward();
  await expect(sheet.getByText('Was the white fish cod?', { exact: true })).toBeVisible();
  expect(fixture.unexpected).toEqual([]);
});
