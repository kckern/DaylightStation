import { expect, test } from '@playwright/test';

test.use({ serviceWorkers: 'block', viewport: { width: 1440, height: 850 } });

const historyResponse = name => ({ items: [{
  at: '2026-11-19T12:00:00Z', routine: { id: 'morning', name }, outcome: 'started', screenName: 'Fixture lounge',
}] });
const flagsResponse = name => ({ items: [{
  routine: { id: 'evening', name }, deviceId: 'lounge', severity: 'warn', problem: 'offline', reason: 'Lounge is offline',
}] });
const responses = { history: historyResponse, flags: flagsResponse };
const unavailable = { status: 503, json: { error: 'Unavailable' } };

async function installFixture(page, read) {
  await page.addInitScript(() => localStorage.setItem('media-app.first-use-done', 'done'));
  await page.routeWebSocket('**/ws', () => {});
  await page.route('**/api/**', route => {
    const { pathname } = new URL(route.request().url());
    if (pathname.endsWith('/supervision/bootstrap')) return route.fulfill({ json: { enabled: false } });
    if (pathname.endsWith('/device/config')) return route.fulfill({ json: { devices: { lounge: { name: 'Fixture lounge', fleet: true } } } });
    const section = pathname.endsWith('/routines/history') ? 'history' : pathname.endsWith('/routines/flags') ? 'flags' : null;
    if (section) {
      expect(route.request().method()).toBe('GET');
      return read(section, route);
    }
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
  const held = new Map();
  const heldReads = new Set(['history-1', 'history-2', 'flags-2', 'flags-3']);
  const openRoutines = await installFixture(page, (section, route) => {
    const count = ++reads[section];
    const read = `${section}-${count}`;
    if (heldReads.has(read)) {
      held.set(read, route);
      return;
    }
    return route.fulfill({ json: responses[section](`${section} result ${count}`) });
  });

  await openRoutines();
  await expect.poll(() => held.has('history-1')).toBe(true);
  const flags = page.getByRole('region', { name: 'Before they run', exact: true });
  const history = page.getByRole('region', { name: 'Recent starts', exact: true });
  const historyRow = history.getByTestId('routine-run');
  await expect(flags).toContainText('flags result 1');
  await expect(historyRow).toHaveCount(0);
  await held.get('history-1').fulfill(unavailable);

  const retryHistory = page.getByRole('button', { name: 'Retry routine history', exact: true });
  await expect(page.getByTestId('routine-history-error')).toBeVisible();
  await retryHistory.press('Enter');
  await expect.poll(() => reads).toEqual({ history: 2, flags: 1 });
  await expect(history).toBeFocused();
  await expect(history).toHaveAttribute('aria-busy', 'true');
  await expect(flags).not.toHaveAttribute('aria-busy', 'true');
  await expect(flags).toContainText('flags result 1');
  await held.get('history-2').fulfill({ json: historyResponse('history result 2') });
  await expect(historyRow).toContainText('history result 2');
  await expect(history).not.toHaveAttribute('aria-busy', 'true');
  await expect(history).toBeFocused();
  await expect(flags).toContainText('flags result 1');
  expect(reads).toEqual({ history: 2, flags: 1 });

  await page.getByRole('button', { name: 'Refresh', exact: true }).click();
  await expect.poll(() => held.has('flags-2')).toBe(true);
  await expect(historyRow).toContainText('history result 3');
  await expect(flags).toContainText('flags result 1');
  await held.get('flags-2').fulfill(unavailable);

  const retryFlags = page.getByRole('button', { name: 'Retry routine flags', exact: true });
  await expect(retryFlags).toBeVisible();
  await expect(flags).toContainText('flags result 1');
  await retryFlags.press('Enter');
  await expect.poll(() => reads).toEqual({ history: 3, flags: 3 });
  await expect(flags).toBeFocused();
  await expect(flags).toHaveAttribute('aria-busy', 'true');
  await expect(history).not.toHaveAttribute('aria-busy', 'true');
  await expect(flags).toContainText('flags result 1');
  await expect(historyRow).toContainText('history result 3');
  const devices = page.getByRole('navigation', { name: 'Primary' }).getByRole('button', { name: 'Devices', exact: true });
  await devices.focus();
  await expect(devices).toBeFocused();
  await held.get('flags-3').fulfill({ json: flagsResponse('flags result 3') });
  await expect(flags).toContainText('flags result 3');
  await expect(flags).not.toHaveAttribute('aria-busy', 'true');
  await expect(devices).toBeFocused();
  await expect(historyRow).toContainText('history result 3');
  expect(reads).toEqual({ history: 3, flags: 3 });
});

test('Media Routines gives keyboard focus to the flags region when retrying without rows', async ({ page }) => {
  const reads = { history: 0, flags: 0 };
  let retryRead;
  const openRoutines = await installFixture(page, (section, route) => {
    const count = ++reads[section];
    if (section === 'history') return route.fulfill({ json: historyResponse('Morning start') });
    if (count === 1) return route.fulfill(unavailable);
    retryRead = route;
  });

  await openRoutines();
  const retry = page.getByRole('button', { name: 'Retry routine flags', exact: true });
  await expect(retry).toBeVisible();
  await expect(page.getByTestId('routine-run')).toContainText('Morning start');
  await retry.press('Enter');
  await expect.poll(() => reads).toEqual({ history: 1, flags: 2 });

  const flags = page.getByRole('region', { name: 'Before they run', exact: true });
  await expect(flags).toBeFocused();
  await expect(flags).toHaveAttribute('aria-busy', 'true');
  await retryRead.fulfill({ json: { items: [] } });
  await expect(retry).toHaveCount(0);
  await expect(flags.getByTestId('routine-flags')).toHaveCount(0);
  await expect(flags).not.toHaveAttribute('aria-busy', 'true');
  await expect(flags).toBeFocused();
  expect(reads).toEqual({ history: 1, flags: 2 });
});
