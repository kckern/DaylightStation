import { expect, test } from '@playwright/test';
import { installHealthFixtures } from '../../../live/flow/health/healthFixtures.mjs';

test.use({ serviceWorkers: 'block', viewport: { width: 390, height: 850 }, timezoneId: 'UTC' });

test('Health pauses hidden food progress without interrupting the pending submission', async ({ page }) => {
  const pending = Promise.withResolvers();
  await page.routeWebSocket('**/*', () => {});
  const fixture = await installHealthFixtures(page);
  fixture.holdCapture = pending.promise;
  await page.route('**/supervision/bootstrap', route => route.fulfill({ json: { enabled: false } }));
  await page.clock.install({ time: new Date('2026-11-22T18:00:00Z') });
  await page.goto('/health');

  const draft = page.getByRole('textbox', { name: 'Log food or change this day' });
  await draft.fill('unsent day draft');
  await page.getByRole('combobox', { name: 'Add to Lunch', exact: true }).fill('two eggs on toast');
  await page.getByRole('button', { name: 'Log sentence', exact: true }).click();
  const writes = () => fixture.requests.filter(request => request.endpoint === '/nutrition/input' && request.method === 'POST').length;
  const progress = page.locator('[role=progressbar][aria-label="Food analysis"]');
  const value = async () => Number(await progress.getAttribute('aria-valuenow'));
  const today = page.getByRole('link', { name: 'Today', exact: true });
  const leaveToday = async () => {
    await page.getByRole('link', { name: 'Progress', exact: true }).click();
    await expect(page).toHaveURL(/\/health\/progress$/);
    await expect(progress).toBeHidden();
  };

  try {
    await expect.poll(writes).toBe(1);
    await expect(progress).toBeVisible();
    const started = await value();
    await page.clock.runFor(1000);
    await expect.poll(value).toBeGreaterThan(started);

    await leaveToday();
    await expect(progress).toHaveCount(1);
    expect(await page.evaluate(() => document.visibilityState)).toBe('visible');
    const offscreenValue = await value();
    await page.clock.runFor(2500);
    expect(await value()).toBe(offscreenValue);
    expect(writes()).toBe(1);
    expect(fixture.items).toHaveLength(0);

    await today.click();
    await expect(progress).toBeVisible();
    await expect.poll(value).toBeGreaterThanOrEqual(offscreenValue + 14);
    await expect(draft).toHaveValue('unsent day draft');
    await leaveToday();
  } finally {
    pending.resolve();
  }

  await expect.poll(() => fixture.items.length).toBe(1);
  await today.click();
  await expect(page.getByRole('button', { name: 'Edit Captured eggs', exact: true })).toBeVisible();
  await expect(progress).toHaveCount(0);
  await expect(draft).toHaveValue('unsent day draft');
  expect(writes()).toBe(1);
  expect(fixture.unexpected).toEqual([]);
});
