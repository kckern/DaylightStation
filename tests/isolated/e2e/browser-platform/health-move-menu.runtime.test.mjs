import { expect, test } from '@playwright/test';
import { installHealthFixtures } from '../../../live/flow/health/healthFixtures.mjs';

const date = '2026-11-22';
test.use({ locale: 'en-US', serviceWorkers: 'block', viewport: { width: 390, height: 850 }, timezoneId: 'UTC' });

for (const inDialog of [false, true]) {
  test(`Health explains invalid dates and returns focus in ${inDialog ? 'the whole-day dialog' : 'selected foods'}`, async ({ page }) => {
    await page.clock.setFixedTime(new Date(date + 'T18:00:00Z'));
    await page.routeWebSocket('**/*', () => {});
    const fixture = await installHealthFixtures(page, {
      items: [{ uuid: 'rice', name: 'Rice', mealTime: 'evening', calories: 120, grams: 100, date }],
    });
    await page.route('**/supervision/bootstrap', route => route.fulfill({ json: { enabled: false } }));
    await page.goto('/health?date=' + date);

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
  });
}
