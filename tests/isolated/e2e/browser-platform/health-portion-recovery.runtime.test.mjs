import { expect, test } from '@playwright/test';
import { installHealthFixtures } from '../../../live/flow/health/healthFixtures.mjs';

const date = '2026-11-22';
test.use({ locale: 'en-US', serviceWorkers: 'block', viewport: { width: 390, height: 850 }, timezoneId: 'UTC' });

test('Health keeps the portion recovery button focused through rebase and save', async ({ page, baseURL }) => {
  const origin = new URL(baseURL).origin;
  const holdRead = Promise.withResolvers();
  const releaseRead = Promise.withResolvers();
  const holdSave = Promise.withResolvers();
  const releaseSave = Promise.withResolvers();
  const refreshedAfterConflict = Promise.withResolvers();
  const writes = [];
  let recover = false;
  let recoveredReads = 0;
  const rice = { uuid: 'rice', name: 'Rice', date, mealTime: 'evening', calories: 120, grams: 100, version: 1 };
  await page.clock.setFixedTime(new Date(`${date}T18:00:00Z`));
  await page.context().route('**/*', route => new URL(route.request().url()).origin === origin ? route.fallback() : route.abort());
  await page.routeWebSocket('**/*', () => {});
  const fixture = await installHealthFixtures(page, { items: [rice] });
  await page.route('**/supervision/bootstrap', route => route.fulfill({ json: { enabled: false } }));
  await page.route('**/nutrilist/rice', async route => {
    if (route.request().method() !== 'PUT') return route.fallback();
    writes.push(route.request().postDataJSON());
    if (writes.length === 1) return route.fulfill({ status: 409, json: { error: 'Portion changed' } });
    holdSave.resolve();
    await releaseSave.promise;
    const updated = { ...rice, grams: 110, version: 3 };
    fixture.items = [updated];
    return route.fulfill({ json: { versions: { rice: 3 }, data: updated } });
  });
  await page.route(`**/health/day?date=${date}`, async route => {
    if (!recover) {
      if (writes.length === 1) refreshedAfterConflict.resolve();
      return route.fallback();
    }
    if (writes.length > 1) return route.fallback();
    if (++recoveredReads === 1) {
      holdRead.resolve();
      await releaseRead.promise;
      return route.fulfill({ status: 409, json: { error: 'Fresh day unavailable' } });
    }
    return route.fulfill({ json: {
      items: [{ ...rice, grams: 95, version: 2 }], budget: { budget: 2000, remaining: 1886 },
    } });
  });

  await page.goto(`/health?date=${date}`);
  const portion = page.getByRole('button', { name: /Adjust portion of Rice/ });
  await portion.press('Enter');
  const field = page.getByRole('textbox', { name: 'Portion (g)' });
  await field.fill('110');
  await field.press('Enter');
  const retry = page.getByRole('button', { name: 'Reload & apply intended change' });
  await expect(retry).toBeVisible();
  await refreshedAfterConflict.promise;
  recover = true;

  try {
    await retry.press('Enter');
    await holdRead.promise;
    await expect(retry).toBeFocused();
    await expect(retry).toHaveAttribute('aria-busy', 'true');
    await page.keyboard.press('Enter');
    expect(recoveredReads).toBe(1);
    expect(writes).toHaveLength(1);
    releaseRead.resolve();
    await expect(page.getByRole('alert').filter({ hasText: 'Fresh day unavailable' })).toBeVisible();
    await expect(retry).toBeEnabled();
    await expect(retry).toBeFocused();
    expect(writes).toHaveLength(1);
    await retry.press('Enter');
    await holdSave.promise;
    await expect(retry).toBeFocused();
    await expect(retry).toHaveAttribute('aria-busy', 'true');
    await page.keyboard.press('Enter');
    expect(recoveredReads).toBe(2);
    expect(writes).toHaveLength(2);
    expect(writes[1]).toMatchObject({ expectedVersion: 2, portion: { value: 110, unit: 'g' } });
    expect(writes[1].operationId).not.toBe(writes[0].operationId);
  } finally {
    releaseRead.resolve();
    releaseSave.resolve();
  }
  const log = page.getByRole('region', { name: 'Food log', exact: true });
  await expect(retry).toHaveCount(0);
  await expect(log).toBeFocused();
  await expect(portion).toHaveAccessibleName(/110 g/);
});
