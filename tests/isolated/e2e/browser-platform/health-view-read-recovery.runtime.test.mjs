import { expect, test } from '@playwright/test';

const date = '2026-11-22';
const today = '/health?date=' + date;
const context = '/api/v1/health/context';
const medical = '/api/v1/health/medical';
const day = '/api/v1/health/day';
const review = '/api/v1/health/nutrition/pending';
const observations = '/api/v1/health/nutrition/observations';
const dayResult = {
  date,
  items: [{ id: 'fixture', uuid: 'fixture', name: 'Fixture meal item', kind: 'item', date, mealTime: 'evening', calories: 100, grams: 100 }],
  revision: 1,
  budget: { budget: 2000, food: 100, remaining: 1900 },
};
const reviewResult = { pending: [{ id: 'review-item', date, source: 'web', items: [{ label: 'Pending fixture', calories: 30 }] }] };
const responses = {
  [context]: { userId: 'alice' }, [medical]: { metrics: [] }, [day]: dayResult,
  [review]: { pending: [] }, [observations]: { observations: [] },
};
const cases = [
  { label: 'Health', endpoint: context, path: today, region: 'Health' },
  { label: 'Medical readings', endpoint: medical, path: '/health/medical', region: 'Medical readings' },
  { label: 'Food log', endpoint: day, path: today, region: 'Food log' },
  { label: 'Food review unavailable', endpoint: review, path: today, region: 'Food review', sibling: observations, siblingLabel: 'Measurements unavailable' },
  { label: 'Measurements unavailable', endpoint: observations, path: today, region: 'Measurements', sibling: review, siblingLabel: 'Food review unavailable' },
];

test.use({ serviceWorkers: 'block' });

for (const width of [390, 1440]) {
  test.describe(`Health reads at ${width}px`, () => {
    test.use({ viewport: { width, height: 850 } });

    for (const fixture of cases) {
      test(`${fixture.region} keeps keyboard focus through explicit Retry`, async ({ page }) => {
        const calls = [];
        let armed = false;
        let settled = false;
        let pending;
        await page.clock.setFixedTime(new Date(date + 'T18:00:00Z'));
        await page.routeWebSocket('**/*', () => {});
        await page.route('**/api/**', route => {
          const request = route.request();
          const { pathname, search, searchParams } = new URL(request.url());
          if (!(pathname in responses)) return route.fulfill({ json: { enabled: false } });
          calls.push([request.method(), pathname + search]);
          const selectedDate = searchParams.get('date') === date || pathname === context || pathname === medical;
          if (selectedDate && (pathname === fixture.sibling || (!armed && pathname === fixture.endpoint))) {
            return route.fulfill({ status: 409, json: { error: 'Fixture unavailable' } });
          }
          if (selectedDate && pathname === fixture.endpoint && !settled) {
            pending = route;
            return;
          }
          return route.fulfill({ json: responses[pathname] });
        });

        await page.goto(fixture.path);
        const retryFor = label => page.getByRole('alert').filter({ hasText: label + ' failed to load' })
          .getByRole('button', { name: 'Retry', exact: true });
        const retry = retryFor(fixture.label);
        const settings = page.getByRole('button', { name: 'Health settings', exact: true });
        const draft = page.getByRole('textbox', { name: 'Log food or change this day', exact: true });
        const addReading = page.getByRole('button', { name: 'Add reading', exact: true });
        await expect(retry).toBeVisible();
        const inToday = fixture.path === today && fixture.endpoint !== context;
        if (inToday) await draft.fill('food draft during Retry');
        if (fixture.sibling) await expect(retryFor(fixture.siblingLabel)).toBeEnabled();
        const before = calls.length;
        const exactGet = ['GET', fixture.endpoint + (inToday ? '?date=' + date : '')];
        armed = true;
        await retry.press('Enter');
        await expect.poll(() => Boolean(pending)).toBe(true);
        await expect(retry).toHaveCount(0);
        expect(await page.evaluate(() => document.activeElement.tagName)).not.toBe('BODY');
        expect(calls.slice(before).filter(([, path]) => path === exactGet[1])).toEqual([exactGet]);

        const region = page.getByRole(fixture.endpoint === observations ? 'group' : 'region', {
          name: fixture.region, exact: true,
        });
        await expect(region).toBeFocused();
        await expect(region).toHaveAttribute('aria-busy', 'true');
        await expect(region).toBeVisible();
        if (fixture.endpoint === context) {
          await expect(settings).toHaveCount(0);
        } else {
          await expect(settings).toBeEnabled();
          for (const tab of ['Today', 'Progress', 'Medical', 'Coach']) {
            await expect(page.getByRole('link', { name: tab, exact: true })).toBeVisible();
          }
        }
        if (fixture.endpoint === medical) await expect(addReading).toHaveCount(0);
        if (fixture.sibling) {
          await expect(retryFor(fixture.siblingLabel)).toBeEnabled();
          await expect(page.getByText('Fixture meal item', { exact: true })).toBeVisible();
        }
        if (inToday) await expect(draft).toHaveValue('food draft during Retry');

        const nonempty = fixture.endpoint === review && width === 1440;
        const moveToDraft = fixture.endpoint === day && width === 1440;
        if (moveToDraft) await draft.focus();
        settled = true;
        await pending.fulfill({ json: nonempty ? reviewResult : responses[fixture.endpoint] });
        if (fixture.endpoint === context) await expect(settings).toBeEnabled();
        if (fixture.endpoint === medical) await expect(addReading).toBeEnabled();
        if (fixture.endpoint === day) await expect(region.getByText('Fixture meal item', { exact: true })).toBeVisible();
        if (fixture.endpoint === review) {
          const status = region.getByRole('status');
          await expect(status).toHaveText(nonempty ? '1 food capture needs review below.' : 'No food captures need review.');
          if (nonempty) await expect(page.getByText('1 capture not counted · Review', { exact: true })).toBeVisible();
        }
        if (fixture.endpoint === observations) {
          await expect(region.getByRole('button', { name: 'No follow-ups', exact: true })).toBeEnabled();
          await expect(page.getByText('Nothing waiting. All caught up.', { exact: true })).toHaveCount(0);
        }
        await expect(region).not.toHaveAttribute('aria-busy', 'true');
        await expect(moveToDraft ? draft : region).toBeFocused();
        if (inToday) await expect(draft).toHaveValue('food draft during Retry');
        if (fixture.sibling) {
          await expect(retryFor(fixture.siblingLabel)).toBeEnabled();
          const scopedReads = [day, review, observations].map(path => path + '?date=' + date);
          expect(calls.slice(before).filter(([, path]) => scopedReads.includes(path))).toEqual([exactGet]);
        } else if (fixture.endpoint !== context) {
          // Claiming the accepted Health owner can revalidate context after it settles.
          expect(calls.slice(before).filter(([, path]) => path === exactGet[1])).toEqual([exactGet]);
        }
        expect(calls.every(([method]) => method === 'GET')).toBe(true);

        if (fixture.endpoint === review) {
          await draft.focus();
          await expect(region).toHaveCount(0);
        }
        if (fixture.endpoint === observations) {
          await page.keyboard.press('Tab');
          await expect(region.getByRole('button', { name: 'No follow-ups', exact: true })).toBeFocused();
        }
      });
    }
  });
}

test('Focused Food review Retry remains available when the food day poll also fails', async ({ page }) => {
  let dayUnavailable = false;
  let holdReview = false;
  let pendingReview;
  await page.setViewportSize({ width: 390, height: 850 });
  await page.clock.install({ time: new Date(date + 'T18:00:00Z') });
  await page.routeWebSocket('**/*', () => {});
  await page.route('**/api/**', route => {
    const { pathname, searchParams } = new URL(route.request().url());
    if (searchParams.get('date') === date) {
      if (pathname === day && dayUnavailable) return route.fulfill({ status: 409, json: {} });
      if (pathname === review) {
        if (!holdReview) return route.fulfill({ status: 409, json: {} });
        pendingReview = route;
        return;
      }
    }
    return route.fulfill({ json: responses[pathname] ?? { enabled: false } });
  });
  await page.goto(today);
  await expect(page.getByText('Fixture meal item', { exact: true })).toBeVisible();
  const region = page.getByRole('region', { name: 'Food review', exact: true });
  const retry = region.getByRole('button', { name: 'Retry', exact: true });
  await expect(retry).toBeVisible();
  holdReview = true;
  await retry.press('Enter');
  await expect.poll(() => Boolean(pendingReview)).toBe(true);
  await expect(region).toBeFocused();

  dayUnavailable = true;
  await page.clock.fastForward(16_000);
  const stale = page.getByRole('button', { name: "Couldn't refresh · Retry", exact: true });
  await expect(stale).toBeVisible();
  await pendingReview.fulfill({ status: 409, json: {} });
  await expect(retry).toBeVisible();
  await expect(region).not.toHaveAttribute('aria-busy', 'true');
  await expect(region).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(retry).toBeFocused();
  await page.getByRole('textbox', { name: 'Log food or change this day', exact: true }).focus();
  await expect(region).toHaveCount(0);
  await expect(stale).toBeVisible();
});

test('The food log keeps accepted rows and keyboard focus during a warm retry', async ({ page }) => {
  let phase = 'initial';
  const dayReads = [];
  let retryRead;
  await page.setViewportSize({ width: 390, height: 850 });
  await page.clock.setFixedTime(new Date(date + 'T18:00:00Z'));
  await page.routeWebSocket('**/*', () => {});
  await page.route('**/api/**', route => {
    const { pathname, searchParams } = new URL(route.request().url());
    if (pathname === day && searchParams.get('date') === date) {
      dayReads.push(route.request().method());
      if (phase === 'fail') return route.fulfill({ status: 409, json: {} });
      if (phase === 'retry') {
        retryRead = route;
        return;
      }
    }
    return route.fulfill({ json: responses[pathname] ?? { enabled: false } });
  });
  await page.goto(today);
  const row = page.getByText('Fixture meal item', { exact: true });
  await expect(row).toBeVisible();
  phase = 'fail';
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  const action = page.getByRole('button', { name: "Couldn't refresh · Retry", exact: true });
  await expect(action).toBeVisible();
  const before = dayReads.length;
  phase = 'retry';
  await action.press('Enter');
  await expect.poll(() => Boolean(retryRead)).toBe(true);
  const region = page.getByRole('region', { name: 'Food log', exact: true });
  await expect(region).toBeFocused();
  await expect(region).toHaveAttribute('aria-busy', 'true');
  await expect(row).toBeVisible();
  await retryRead.fulfill({ json: dayResult });
  await expect(region).not.toHaveAttribute('aria-busy', 'true');
  await expect(region).toBeFocused();
  expect(dayReads.slice(before)).toEqual(['GET']);
});

test('Retry after a refused reading deletion only rereads Medical readings', async ({ page }) => {
  const calls = [];
  let pending;
  const reading = { id: 'fixture', date, value: 73, unit: 'bpm' };
  const medicalResult = { metrics: [{ metric: 'resting_hr', latest: reading, unit: 'bpm', readings: [reading] }] };
  await page.setViewportSize({ width: 390, height: 850 });
  await page.routeWebSocket('**/*', () => {});
  page.on('dialog', dialog => dialog.accept());
  await page.route('**/api/**', route => {
    const request = route.request();
    const { pathname } = new URL(request.url());
    if (pathname === medical + '/fixture') {
      calls.push(request.method());
      return route.fulfill({ status: 409, json: {} });
    }
    if (pathname === medical) {
      calls.push(request.method());
      if (calls.length === 1) return route.fulfill({ json: medicalResult });
      pending = route;
      return;
    }
    return route.fulfill({ json: responses[pathname] ?? { enabled: false } });
  });

  await page.goto('/health/medical');
  await page.getByRole('button', { name: 'Delete', exact: true }).press('Enter');
  const warning = page.getByRole('alert').filter({ hasText: 'Reading could not be deleted' });
  await warning.getByRole('button', { name: 'Retry', exact: true }).press('Enter');
  await expect.poll(() => Boolean(pending)).toBe(true);
  const region = page.getByRole('region', { name: 'Medical readings', exact: true });
  await expect(region).toBeFocused();
  await expect(region).toHaveAttribute('aria-busy', 'true');
  await expect(warning).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Add reading', exact: true })).toBeEnabled();
  await pending.fulfill({ json: medicalResult });
  await expect(region).not.toHaveAttribute('aria-busy', 'true');
  await expect(region).toBeFocused();
  await expect(region.getByRole('button', { name: 'Delete', exact: true })).toBeVisible();
  expect(calls).toEqual(['GET', 'DELETE', 'GET']);
});
