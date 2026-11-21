import { expect, test } from '@playwright/test';
import { installHealthFixtures } from '../../../live/flow/health/healthFixtures.mjs';

test.use({
  hasTouch: true, locale: 'en-US', serviceWorkers: 'block', timezoneId: 'UTC',
  viewport: { width: 320, height: 850 },
});

test('Health keeps the last day of a week reachable without scrolling the page sideways', async ({ page }) => {
  await page.routeWebSocket('**/*', () => {});
  await installHealthFixtures(page);
  await page.route('**/supervision/bootstrap', route => route.fulfill({ json: { enabled: false } }));
  await page.clock.setFixedTime(new Date('2026-11-22T18:00:00Z'));

  await page.goto('/health?date=2026-11-18');
  await page.getByText('Week & weight history', { exact: true }).click();
  const week = page.getByRole('group', { name: 'Week navigator' });
  const days = week.locator('.health-weekstrip__days');
  const saturday = week.getByRole('button', { name: /Saturday, November 21/ });
  const sunday = week.getByRole('button', { name: /Sunday, November 22/ });
  await expect(sunday).toBeVisible();
  const main = page.getByRole('main');
  const horizontalOverflow = await main.evaluate(node => node.scrollWidth - node.clientWidth);
  expect(horizontalOverflow).toBe(0);
  expect(await days.evaluate(node => node.scrollWidth - node.clientWidth)).toBeGreaterThan(0);
  expect((await sunday.boundingBox()).width).toBeGreaterThanOrEqual(44);

  await saturday.focus();
  await page.keyboard.press('Tab');
  await expect(sunday).toBeFocused();
  const dayBox = await sunday.boundingBox();
  const visibleBox = await days.boundingBox();
  expect(dayBox.x + dayBox.width).toBeLessThanOrEqual(visibleBox.x + visibleBox.width + 1);
  expect(await days.evaluate(node => node.scrollLeft)).toBeGreaterThan(0);
  expect(await main.evaluate(node => node.scrollLeft)).toBe(0);
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/date=2026-11-22/);
  await expect(sunday).toHaveAttribute('aria-current', 'date');

  await page.setViewportSize({ width: 390, height: 850 });
  await expect.poll(() => days.evaluate(node => node.scrollWidth - node.clientWidth)).toBe(0);
  expect(await main.evaluate(node => node.scrollWidth - node.clientWidth)).toBe(0);
});

test('Health dismisses a food editor when browser Back changes the viewed day', async ({ page }) => {
  const previous = '2026-11-19';
  const selected = '2026-11-20';
  await page.routeWebSocket('**/*', () => {});
  await installHealthFixtures(page, { items: [{
    uuid: 'next-day-entry', name: 'Next day breakfast', date: selected,
    mealTime: 'morning', calories: 120, grams: 100, version: 1,
  }] });
  await page.route('**/supervision/bootstrap', route => route.fulfill({ json: { enabled: false } }));
  await page.clock.setFixedTime(new Date('2026-11-22T18:00:00Z'));

  await page.goto(`/health?date=${previous}`);
  await page.setViewportSize({ width: 390, height: 850 });
  await page.getByText('Week & weight history', { exact: true }).click();
  await page.getByRole('button', { name: /Friday, November 20/ }).click();
  await expect(page).toHaveURL(new RegExp(`date=${selected}`));
  const edit = page.getByRole('button', { name: 'Edit Next day breakfast' });
  await edit.scrollIntoViewIfNeeded();
  await edit.click();
  const editor = page.getByRole('dialog');
  await expect(editor).toBeVisible();

  await page.goBack();

  await expect(page).toHaveURL(new RegExp(`date=${previous}`));
  await expect(editor).toBeHidden();
});

test('Health dismisses a pending food deletion when browser Back changes the viewed day', async ({ page }) => {
  const previous = '2026-11-19';
  const selected = '2026-11-20';
  await page.routeWebSocket('**/*', () => {});
  const state = await installHealthFixtures(page, { items: [{
    uuid: 'next-day-entry', name: 'Next day breakfast', date: selected,
    mealTime: 'morning', calories: 120, grams: 100, version: 1,
  }] });
  await page.route('**/supervision/bootstrap', route => route.fulfill({ json: { enabled: false } }));
  await page.clock.setFixedTime(new Date('2026-11-22T18:00:00Z'));

  await page.goto(`/health?date=${previous}`);
  await page.setViewportSize({ width: 390, height: 850 });
  await page.getByText('Week & weight history', { exact: true }).click();
  await page.getByRole('button', { name: /Friday, November 20/ }).click();
  const edit = page.getByRole('button', { name: 'Edit Next day breakfast' });
  await edit.scrollIntoViewIfNeeded();
  await edit.click();
  await page.getByRole('button', { name: 'Delete', exact: true }).click();
  const confirmation = page.getByRole('dialog', { name: 'Delete Next day breakfast?', exact: true });
  await expect(confirmation).toBeVisible();

  await page.goBack();

  await expect(page).toHaveURL(new RegExp(`date=${previous}`));
  await expect(confirmation).toBeHidden();
  expect(state.requests.filter(request => request.method === 'DELETE')).toHaveLength(0);
});

for (const status of [200, 500]) {
  test(`Health keeps a newer day's delete confirmation when an older deletion settles (${status})`, async ({ page }) => {
    const previous = '2026-11-19';
    const selected = '2026-11-20';
    const deleteStarted = Promise.withResolvers();
    const releaseDelete = Promise.withResolvers();
    await page.routeWebSocket('**/*', () => {});
    await installHealthFixtures(page, { items: [
      { uuid: 'previous-day-entry', name: 'Previous day breakfast', date: previous,
        mealTime: 'morning', calories: 110, grams: 100, version: 1 },
      { uuid: 'next-day-entry', name: 'Next day breakfast', date: selected,
        mealTime: 'morning', calories: 120, grams: 100, version: 1 },
    ] });
    await page.route('**/api/v1/health/nutrilist/next-day-entry', async route => {
      if (route.request().method() !== 'DELETE') return route.fallback();
      deleteStarted.resolve();
      await releaseDelete.promise;
      return route.fulfill({ status, json: status === 200 ? { affectedIds: ['next-day-entry'] } : { error: 'Delete refused' } });
    });
    await page.route('**/supervision/bootstrap', route => route.fulfill({ json: { enabled: false } }));
    await page.clock.setFixedTime(new Date('2026-11-22T18:00:00Z'));

    await page.goto(`/health?date=${previous}`);
    await page.setViewportSize({ width: 390, height: 850 });
    await page.getByText('Week & weight history', { exact: true }).click();
    await page.getByRole('button', { name: /Friday, November 20/ }).click();
    const nextEdit = page.getByRole('button', { name: 'Edit Next day breakfast' });
    await nextEdit.scrollIntoViewIfNeeded();
    await nextEdit.click();
    await page.getByRole('button', { name: 'Delete', exact: true }).click();
    const nextConfirm = page.getByRole('dialog', { name: 'Delete Next day breakfast?', exact: true });
    await nextConfirm.getByRole('button', { name: 'Delete', exact: true }).click();
    await deleteStarted.promise;

    await page.goBack();
    await expect(page).toHaveURL(new RegExp(`date=${previous}`));
    const previousEdit = page.getByRole('button', { name: 'Edit Previous day breakfast' });
    await previousEdit.scrollIntoViewIfNeeded();
    await previousEdit.click();
    await page.getByRole('button', { name: 'Delete', exact: true }).click();
    const previousConfirm = page.getByRole('dialog', { name: 'Delete Previous day breakfast?', exact: true });
    await expect(previousConfirm).toBeVisible();
    await expect(previousConfirm.getByRole('button', { name: 'Delete', exact: true })).toBeDisabled();
    await expect(previousConfirm.getByRole('button', { name: 'Cancel', exact: true })).toBeEnabled();
    await page.keyboard.press('Escape');
    await expect(previousConfirm).toBeHidden();
    await page.getByRole('button', { name: 'Actions for Previous day breakfast' }).click();
    await page.getByRole('menuitem', { name: 'Remove', exact: true }).click();
    await expect(previousConfirm).toBeVisible();

    releaseDelete.resolve();
    if (status === 200) {
      await expect(previousConfirm).toBeVisible();
    } else {
      await expect(previousConfirm).toBeVisible();
      await expect(previousConfirm.getByRole('alert')).toHaveCount(0);
    }
    await expect(previousConfirm.getByRole('button', { name: 'Delete', exact: true })).toBeEnabled();
  });
}
