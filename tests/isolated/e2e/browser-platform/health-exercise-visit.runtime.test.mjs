import { expect, test } from '@playwright/test';

test.use({ serviceWorkers: 'block', timezoneId: 'UTC', viewport: { width: 390, height: 850 } });

test('Health Today retires hidden workout enrichment and reads it when Today returns', async ({ page, baseURL }) => {
  const date = '2026-11-19';
  const origin = new URL(baseURL).origin;
  const workouts = [{
    id: 'home-test', title: 'Workout fixture', homeSessionId: 'segment-1', calories: 347, minutes: 44,
  }];
  const day = { items: [], budget: { budget: 2000, remaining: 2000, sessions: workouts } };
  const fitnessPath = '/api/v1/fitness/sessions';
  const reads = [];
  let firstRead;

  await page.context().route('**/*', route => (
    new URL(route.request().url()).origin === origin ? route.fallback() : route.abort()
  ));
  await page.routeWebSocket('**/*', () => {});
  await page.route('**/api/**', route => {
    const { pathname, searchParams } = new URL(route.request().url());
    if (pathname === '/api/v1/health/context') return route.fulfill({ json: { userId: 'alice' } });
    if (pathname === '/api/v1/health/day' && searchParams.get('date') === date) return route.fulfill({ json: day });
    if (pathname === fitnessPath) {
      reads.push(searchParams.get('date'));
      if (reads.length === 1) { firstRead = route; return; }
      return route.fulfill({ json: { sessions: [{ sessionId: 'current', segments: [{ sessionId: 'segment-1' }] }] } });
    }
    return route.fulfill({ json: pathname.endsWith('/supervision/bootstrap') ? { enabled: false } : {} });
  });
  await page.clock.setFixedTime(new Date(date + 'T16:00:00Z'));
  await page.goto('/health');
  const workout = page.getByText('Workout fixture', { exact: true });
  const oldLink = page.locator('a[href="/fitness/home/session-retired"]');
  await expect(workout).toBeVisible();
  await expect.poll(() => reads).toEqual([date]);

  await page.getByRole('link', { name: 'Progress', exact: true }).click();
  await expect(page).toHaveURL(/\/health\/progress$/);
  await expect(workout).toBeAttached();
  await expect(workout).toBeHidden();

  const responded = page.waitForResponse(response => new URL(response.url()).pathname === fitnessPath);
  await firstRead.fulfill({
    json: { sessions: [{ sessionId: 'retired', segments: [{ sessionId: 'segment-1' }] }] },
  });
  await (await responded).finished();
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await expect(oldLink).toHaveCount(0);
  expect(reads).toEqual([date]);

  await page.getByRole('link', { name: 'Today', exact: true }).click();
  await expect(page.getByRole('link', { name: /Workout fixture/ })).toHaveAttribute('href', '/fitness/home/session-current');
  await expect(oldLink).toHaveCount(0);
  expect(reads).toEqual([date, date]);
});
