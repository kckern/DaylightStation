import { expect, test } from '@playwright/test';
import { installHealthFixtures } from '../../../live/flow/health/healthFixtures.mjs';

const date = '2026-11-22';
test.use({ locale: 'en-US', serviceWorkers: 'block', viewport: { width: 390, height: 850 }, timezoneId: 'UTC' });

async function openHealthDay(page, baseURL) {
  await page.clock.setFixedTime(new Date(date + 'T18:00:00Z'));
  const origin = new URL(baseURL).origin;
  await page.context().route('**/*', route => (
    new URL(route.request().url()).origin === origin ? route.fallback() : route.abort()
  ));
  await page.routeWebSocket('**/*', () => {});
  const fixture = await installHealthFixtures(page, {
    items: [{ uuid: 'rice', name: 'Rice', mealTime: 'evening', calories: 120, grams: 100, date }],
  });
  await page.route('**/supervision/bootstrap', route => route.fulfill({ json: { enabled: false } }));
  await page.goto('/health?date=' + date);
  return fixture;
}

for (const inDialog of [false, true]) {
  test(`Health explains invalid dates and honors Escape ownership in ${inDialog ? 'the whole-day dialog' : 'selected foods'}`, async ({ page, baseURL }) => {
    const fixture = await openHealthDay(page, baseURL);

    const wholeDay = page.getByRole('button', { name: "Move this day's food", exact: true });
    const dialog = page.getByRole('dialog', { name: "Move this day's food", exact: true });
    if (inDialog) {
      await wholeDay.press('Enter');
      await expect(dialog.getByRole('checkbox', { name: 'Rice', exact: true })).toBeChecked();
    } else {
      await page.getByRole('button', { name: 'Select foods', exact: true }).press('Enter');
      await page.getByRole('checkbox', { name: 'Select Rice', exact: true }).check();
    }
    const selection = page.getByRole('region', { name: 'Selected foods', exact: true });
    const scope = inDialog ? dialog : selection;
    const picker = scope.getByRole('button', { name: 'Move 1 selected to another day', exact: true });
    await picker.press('Enter');
    const field = page.getByLabel('Move to another day', { exact: true });
    await expect(field).toBeVisible();
    await field.fill(date);
    await expect(field).toHaveAttribute('aria-invalid', 'true');
    await expect(field).toHaveAccessibleDescription('Choose a different day.');
    await field.fill('1999-12-31');
    await expect(field).toHaveAccessibleDescription(/January 1, 2000 or later/);
    await field.fill('2026-11-23');
    await expect(field).toHaveAccessibleDescription('Choose today or an earlier day.');
    await expect(field).toHaveAttribute('min', '2000-01-01');
    await expect(field).toHaveAttribute('max', date);
    await expect(field).toBeFocused();
    const canceledEscape = field.evaluate(input => new Promise(resolve => {
      input.addEventListener('keydown', event => {
        if (event.key !== 'Escape') return;
        event.preventDefault();
        // Let any deferred dismissal run before checking the open menu.
        setTimeout(() => resolve(event.defaultPrevented), 0);
      }, { once: true });
      input.setAttribute('data-escape-probe-ready', '');
    }));
    await expect(field).toHaveAttribute('data-escape-probe-ready', '');
    await page.keyboard.press('Escape');
    expect(await canceledEscape).toBe(true);
    await expect(field).toBeFocused();
    await expect(field).toHaveValue('2026-11-23');
    await expect(field).toHaveAccessibleDescription('Choose today or an earlier day.');

    await page.keyboard.press('Escape');
    await expect(field).toBeHidden();
    await expect(picker).toBeFocused();
    await expect(scope).toBeVisible();
    if (inDialog) {
      await expect(dialog.getByRole('checkbox', { name: 'Rice', exact: true })).toBeChecked();
      await page.keyboard.press('Escape');
      await expect(dialog).toBeHidden();
      await expect(wholeDay).toBeFocused();
    }
    expect(fixture.unexpected).toEqual([]);
    expect(fixture.requests.filter(request => request.method !== 'GET')).toEqual([]);
  });
}

test('Health dismisses the whole-day dialog before canceling a portion draft', async ({ page, baseURL }) => {
  const fixture = await openHealthDay(page, baseURL);

  const portion = page.getByRole('button', { name: /^Adjust portion of Rice,/ });
  await portion.press('ArrowRight');
  await expect(portion).toHaveAccessibleName('Adjust portion of Rice, 101 g');
  const wholeDay = page.getByRole('button', { name: "Move this day's food", exact: true });
  const dialog = page.getByRole('dialog', { name: "Move this day's food", exact: true });
  await wholeDay.press('Enter');
  await expect(dialog).toBeVisible();

  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(wholeDay).toBeFocused();
  await expect(portion).toHaveAccessibleName('Adjust portion of Rice, 101 g');

  await page.keyboard.press('Escape');
  await expect(portion).toHaveAccessibleName('Adjust portion of Rice, 100 g');
  expect(fixture.unexpected).toEqual([]);
  expect(fixture.requests.filter(request => request.method !== 'GET')).toEqual([]);
});
