import { expect, test } from '@playwright/test';
import { installHealthFixtures } from '../../../live/flow/health/healthFixtures.mjs';

const date = '2026-11-22';
const today = '/health?date=' + date;
const progress = '/health/progress?date=' + date;
test.use({ locale: 'en-US', timezoneId: 'UTC', serviceWorkers: 'block', viewport: { width: 390, height: 850 } });

async function openToday(page) {
  await page.clock.setFixedTime(new Date(date + 'T18:00:00Z'));
  await page.routeWebSocket('**/*', () => {});
  const fixture = await installHealthFixtures(page, { items: [
    { uuid: 'rice', version: 1, name: 'Rice', mealTime: 'evening', calories: 120, grams: 100, date },
    { uuid: 'salmon', version: 2, name: 'Salmon', mealTime: 'evening', calories: 180, grams: 100, date },
  ] });
  await page.route('**/supervision/bootstrap', route => route.fulfill({ json: { enabled: false } }));
  await page.goto(progress);
  await page.getByRole('link', { name: 'Today', exact: true }).click();
  return fixture;
}

async function checkKeyboardExit(page, trigger, firstItem) {
  for (const key of ['Tab', 'Shift+Tab']) {
    // The browser chooses the native neighbor at this viewport, including
    // WebKit's platform-specific tab order.
    await trigger.focus();
    await page.keyboard.press(key);
    const neighbor = await page.evaluateHandle(() => document.activeElement);
    await trigger.press('Enter');
    await expect(firstItem).toBeFocused();
    await page.keyboard.press(key);
    await expect(firstItem).toBeHidden();
    await expect.poll(() => neighbor.evaluate(element => document.activeElement === element)).toBe(true);
    await neighbor.dispose();
  }
  await trigger.press('Enter');
  await page.keyboard.press('Escape');
  await expect(firstItem).toBeHidden();
  await expect(trigger).toBeFocused();
  await expect(page).toHaveURL(today);
}

test('Health row actions follow native Tab order and restore focus after Details or canceling Remove', async ({ page }) => {
  const fixture = await openToday(page);
  const trigger = page.getByRole('button', { name: 'Actions for Rice' });
  const details = page.getByRole('menuitem', { name: 'Details', exact: true });
  await trigger.press('Enter');
  await expect(details).toBeFocused();
  await page.goBack();
  await expect(page).toHaveURL(progress);
  await expect(details).toBeHidden();
  await page.goForward();
  await expect(trigger).toHaveAttribute('aria-expanded', 'false');
  await checkKeyboardExit(page, trigger, details);
  await trigger.press('Enter');
  await details.press('Enter');
  const sheet = page.getByRole('dialog', { name: 'Rice', exact: true });
  await expect(sheet.getByLabel('Portion in g', { exact: true })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(sheet).toBeHidden();
  await expect(trigger).toBeFocused();

  await trigger.press('Enter');
  await expect(details).toBeFocused();
  await page.keyboard.press('ArrowUp');
  const remove = page.getByRole('menuitem', { name: 'Remove', exact: true });
  await expect(remove).toBeFocused();
  await page.keyboard.press('Enter');
  const confirm = page.getByRole('dialog', { name: 'Delete Rice?', exact: true });
  await expect(confirm).toBeVisible();
  await expect(confirm.locator(':focus')).toHaveCount(1);
  await confirm.getByRole('button', { name: 'Cancel', exact: true }).press('Enter');
  await expect(confirm).toBeHidden();
  await expect(trigger).toBeFocused();

  const portion = page.getByRole('button', { name: /^Adjust portion of Rice,/ });
  await portion.press('ArrowRight');
  await expect(trigger).toBeDisabled();
  await page.keyboard.press('Escape');
  await expect(trigger).toBeEnabled();
  expect(fixture.requests.filter(request => request.method !== 'GET')).toEqual([]);
  expect(fixture.unexpected).toEqual([]);
});

test('Health entry details can save a food icon and a meal from the draft', async ({ page }) => {
  const fixture = await openToday(page);
  const commands = [];
  await page.route('**/api/v1/health/nutrition/icons?*', route => {
    expect(route.request().method()).toBe('GET');
    return route.fulfill({ json: { icons: ['rice'] } });
  });
  await page.route('**/api/v1/health/nutrition/icons/rice', route => route.fulfill({
    contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>',
  }));
  await page.route('**/api/v1/health/nutrition/{catalog/icon,templates}', route => {
    const request = route.request();
    commands.push([new URL(request.url()).pathname, request.method(), request.postDataJSON()]);
    return route.fulfill({ json: {} });
  });

  await page.getByRole('button', { name: 'Actions for Rice' }).press('Enter');
  await page.getByRole('menuitem', { name: 'Details', exact: true }).press('Enter');
  const sheet = page.getByRole('dialog', { name: 'Rice', exact: true });
  await sheet.getByText('Nutrition, date & evidence', { exact: true }).click();
  await sheet.getByRole('textbox', { name: 'Name', exact: true }).fill('Rice bowl');
  await sheet.getByRole('button', { name: 'Change food icon' }).click();
  await sheet.getByRole('button', { name: 'rice', exact: true }).click();
  await sheet.getByRole('button', { name: 'Use icon for this food' }).click();
  await expect.poll(() => commands).toEqual([
    ['/api/v1/health/nutrition/catalog/icon', 'PUT', { name: 'Rice', icon: 'rice' }],
  ]);
  await sheet.getByRole('button', { name: 'Save as meal' }).click();
  await expect.poll(() => commands).toEqual([
    ['/api/v1/health/nutrition/catalog/icon', 'PUT', { name: 'Rice', icon: 'rice' }],
    ['/api/v1/health/nutrition/templates', 'POST', {
      name: 'Rice bowl',
      components: [expect.objectContaining({ name: 'Rice bowl', icon: 'rice', role: 'core', grams: 100, calories: 120 })],
    }],
  ]);
  await expect(sheet.getByRole('button', { name: 'Save as meal' })).toBeEnabled();
  expect(fixture.requests.filter(request => request.method !== 'GET')).toEqual([]);
  expect(fixture.unexpected).toEqual([]);
});

test('Health selected meal picker preserves ticks on dismissal and commits only the chosen move', async ({ page }) => {
  const fixture = await openToday(page);
  const commands = [];
  const release = Promise.withResolvers();
  await page.route('**/health/nutrition/foods-move', async route => {
    const body = route.request().postDataJSON();
    commands.push({ method: route.request().method(), body });
    await release.promise;
    const row = fixture.items[0];
    row.mealTime = body.toMeal;
    row.version++;
    return route.fulfill({ json: { committed: true, undoToken: 'move-rice', affectedIds: [row.uuid], affectedDates: [date], items: [row] } });
  });
  await page.getByRole('button', { name: 'Select foods', exact: true }).press('Enter');
  const rice = page.getByRole('checkbox', { name: 'Select Rice', exact: true });
  const salmon = page.getByRole('checkbox', { name: 'Select Salmon', exact: true });
  await rice.check();
  const selection = page.getByRole('region', { name: 'Selected foods' });
  const trigger = selection.getByRole('button', { name: 'Move 1 selected to a meal' });
  const breakfast = page.getByRole('menuitem', { name: 'Breakfast', exact: true });
  await checkKeyboardExit(page, trigger, breakfast);
  await expect(rice).toBeChecked();
  await expect(salmon).not.toBeChecked();
  expect(commands).toEqual([]);
  await trigger.press('Enter');
  await page.keyboard.press('ArrowDown');
  const lunch = page.getByRole('menuitem', { name: 'Lunch', exact: true });
  await expect(lunch).toBeFocused();
  await page.keyboard.press('Enter');
  try {
    await expect.poll(() => commands).toEqual([{ method: 'POST', body: expect.objectContaining({
      selectedIds: ['rice'], toMeal: 'afternoon', expectedVersions: { rice: 1 },
    }) }]);
    await expect(selection.getByRole('button', { name: 'Move 1 selected to another day' })).toBeDisabled();
  } finally {
    release.resolve();
  }
  await expect(selection).toBeHidden();
  await expect(page.getByRole('button', { name: 'Undo move' })).toBeVisible();
  expect(commands).toHaveLength(1);
  expect(fixture.requests.filter(request => request.method !== 'GET')).toEqual([]);
  expect(fixture.unexpected).toEqual([]);
});
