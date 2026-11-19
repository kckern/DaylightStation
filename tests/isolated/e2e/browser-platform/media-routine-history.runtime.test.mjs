import { expect, test } from '@playwright/test';

test.use({ serviceWorkers: 'block', viewport: { width: 1440, height: 850 } });

const historyResponse = name => ({ items: [{
  at: '2026-11-19T12:00:00Z', routine: { id: 'morning', name }, outcome: 'started', screenName: 'Fixture lounge',
}] });
const flagsResponse = name => ({ items: [{
  routine: { id: 'evening', name }, deviceId: 'lounge', severity: 'warn', problem: 'offline', reason: 'Lounge is offline',
}] });
const responses = { history: historyResponse, flags: flagsResponse };

async function installFixture(page, read) {
  await page.addInitScript(() => localStorage.setItem('media-app.first-use-done', 'done'));
  await page.routeWebSocket('**/ws', () => {});
  await page.route('**/api/**', route => {
    const { pathname } = new URL(route.request().url());
    if (pathname.endsWith('/supervision/bootstrap')) return route.fulfill({ json: { enabled: false } });
    if (pathname.endsWith('/device/config')) return route.fulfill({ json: { devices: { lounge: { name: 'Fixture lounge', fleet: true } } } });
    const section = pathname.endsWith('/routines/history') ? 'history' : pathname.endsWith('/routines/flags') ? 'flags' : null;
    if (section) return read(section, route);
    return route.fulfill({ json: {} });
  });
  await page.goto('/media?view=fleet');
  return () => page.getByTestId('fleet-open-routines').click();
}

test('Media Routines aborts both departed reads and renders only the reopened visit', async ({ page }) => {
  const held = new Map();
  const reads = [];
  let reopening = false;
  const openRoutines = await installFixture(page, (section, route) => {
    reads.push(section);
    if (!reopening) {
      held.set(section, route);
      return;
    }
    return route.fulfill({ json: responses[section]('Reopened ' + section) });
  });

  await openRoutines();
  await expect(page).toHaveURL(/view=routines/);
  await expect.poll(() => held.size).toBe(2);
  const canceled = [];
  page.on('requestfailed', request => {
    for (const [section, route] of held) if (request === route.request()) canceled.push(section);
  });
  await page.goBack();
  await expect(page).toHaveURL(/view=fleet/);
  await expect.poll(() => canceled.sort()).toEqual(['flags', 'history']);

  reopening = true;
  await openRoutines();
  await expect(page.getByTestId('routine-run')).toContainText('Reopened history');
  await expect(page.getByTestId('routine-flags')).toContainText('Reopened flags');
  for (const [section, route] of held) {
    // A retired transport may already be closed when the old origin responds.
    await route.fulfill({ json: responses[section]('Departed ' + section) }).catch(() => {});
  }
  await expect(page.getByText('Departed history')).toHaveCount(0);
  await expect(page.getByText('Departed flags')).toHaveCount(0);
  expect(reads.sort()).toEqual(['flags', 'flags', 'history', 'history']);
});

test('Media Routines settles and retries history and flags independently', async ({ page }) => {
  const reads = { history: 0, flags: 0 };
  let firstHistory;
  let secondFlags;
  const unavailable = { status: 503, json: { error: 'Unavailable' } };
  const openRoutines = await installFixture(page, (section, route) => {
    const count = ++reads[section];
    if (section === 'history' && count === 1) {
      firstHistory = route;
      return;
    }
    if (section === 'flags' && count === 2) {
      secondFlags = route;
      return;
    }
    return route.fulfill({ json: responses[section](`${section} result ${count}`) });
  });

  await openRoutines();
  await expect.poll(() => Boolean(firstHistory)).toBe(true);
  const flags = page.getByTestId('routine-flags');
  const history = page.getByTestId('routine-run');
  await expect(flags).toContainText('flags result 1');
  await expect(history).toHaveCount(0);
  await firstHistory.fulfill(unavailable);

  const retryHistory = page.getByRole('button', { name: 'Retry routine history', exact: true });
  await expect(page.getByTestId('routine-history-error')).toBeVisible();
  await retryHistory.click();
  await expect(history).toContainText('history result 2');
  await expect(flags).toContainText('flags result 1');
  expect(reads).toEqual({ history: 2, flags: 1 });

  await page.getByRole('button', { name: 'Refresh', exact: true }).click();
  await expect.poll(() => Boolean(secondFlags)).toBe(true);
  await expect(history).toContainText('history result 3');
  await expect(flags).toContainText('flags result 1');
  await secondFlags.fulfill(unavailable);

  const retryFlags = page.getByRole('button', { name: 'Retry routine flags', exact: true });
  await expect(retryFlags).toBeVisible();
  await expect(flags).toContainText('flags result 1');
  await retryFlags.click();
  await expect(flags).toContainText('flags result 3');
  await expect(history).toContainText('history result 3');
  expect(reads).toEqual({ history: 3, flags: 3 });
});
