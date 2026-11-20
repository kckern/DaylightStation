import { expect, test } from '@playwright/test';

test.use({ serviceWorkers: 'block' });

const adminCases = [
  {
    name: 'Member',
    canCreateAfterInitialError: true,
    link: 'Members',
    route: '/admin/household/members',
    roster: '/api/v1/admin/household',
    create: '/api/v1/admin/household/members',
    open: 'Add Member',
    submit: 'Add Member',
    fields: { Username: 'fixture' },
    initial: { members: [] },
    previous: { members: [{ username: 'previous', display_name: 'Previous Member' }] },
    previousRow: 'Previous Member',
    updated: { members: [{ username: 'fixture', display_name: 'Fixture Member' }] },
    row: 'Fixture Member',
    empty: 'No household members found. Add one to get started.',
    error: 'Household members failed to load',
    region: 'Household members',
  },
  {
    name: 'Scheduler',
    canCreateAfterInitialError: true,
    link: 'Scheduler',
    route: '/admin/system/scheduler',
    roster: '/api/v1/admin/scheduler/jobs',
    create: '/api/v1/admin/scheduler/jobs',
    open: 'Create Job',
    submit: 'Create',
    fields: { ID: 'fixture', Name: 'Fixture Job', Schedule: '0 * * * *' },
    initial: { jobs: [] },
    previous: { jobs: [{ id: 'previous', name: 'Previous Job', schedule: '0 * * * *' }] },
    previousRow: 'Previous Job',
    updated: { jobs: [{ id: 'fixture', name: 'Fixture Job', schedule: '0 * * * *' }] },
    row: 'Fixture Job',
    empty: 'No scheduler jobs found. Create one to get started.',
    error: 'Scheduler jobs failed to load',
    region: 'Scheduler jobs',
  },
  {
    name: 'Device',
    link: 'Devices',
    route: '/admin/household/devices',
    roster: '/api/v1/admin/household/devices',
    create: '/api/v1/admin/household/devices',
    open: 'Add Device',
    submit: 'Add Device',
    fields: { 'Device ID': 'fixture' },
    initial: { devices: [] },
    previous: { devices: [{ id: 'previous', name: 'Previous Device', type: 'shield-tv' }] },
    previousRow: 'Previous Device',
    updated: { devices: [{ id: 'fixture', name: 'Fixture Device', type: 'shield-tv' }] },
    row: 'Fixture Device',
    empty: 'No devices found',
    error: 'Devices failed to load',
    region: 'Devices',
  },
];

for (const width of [390, 1440]) {
  test.describe(`roster recovery at ${width}px`, () => {
    test.use({ viewport: { width, height: 850 } });

    for (const fixture of adminCases) {
      test(`${fixture.name} cold Retry keeps focus through the first accepted roster`, async ({ page }) => {
        const requests = [];
        let pending;
        await page.routeWebSocket('**/*', () => {});
        await page.route('**/api/**', route => {
          const request = route.request();
          const { pathname, search } = new URL(request.url());
          if (pathname !== fixture.roster && pathname !== fixture.create) {
            return route.fulfill({ json: pathname.endsWith('/supervision/bootstrap') ? { enabled: false } : {} });
          }
          requests.push([request.method(), pathname + search]);
          if (requests.length === 1) return route.fulfill({ status: 409, json: { error: 'Initial roster unavailable' } });
          pending = route;
        });

        await page.goto(fixture.route);
        const opener = page.getByRole('button', { name: fixture.open, exact: true });
        const retry = page.getByRole('button', { name: 'Retry', exact: true });
        await expect(page.getByRole('alert')).toContainText(fixture.error);
        await retry.press('Enter');
        await expect.poll(() => Boolean(pending)).toBe(true);
        await expect(retry).toHaveCount(0);
        expect(await page.evaluate(() => document.activeElement.tagName)).not.toBe('BODY');
        const region = page.getByRole('region', { name: fixture.region, exact: true });
        await expect(region).toBeFocused();
        await expect(region).toHaveAttribute('aria-busy', 'true');
        if (fixture.canCreateAfterInitialError) await expect(opener).toBeEnabled();
        else await expect(opener).toHaveCount(0);
        await pending.fulfill({ json: fixture.updated });
        await expect(region.getByText(fixture.row, { exact: true })).toBeVisible();
        await expect(region).not.toHaveAttribute('aria-busy', 'true');
        await expect(region).toBeFocused();
        await expect(opener).toBeEnabled();
        expect(requests).toEqual([['GET', fixture.roster], ['GET', fixture.roster]]);
      });
    }

    const scenarios = adminCases.map(fixture => ({ fixture, initialFailure: false }));
    if (width === 390) {
      scenarios.push(...adminCases.filter(fixture => fixture.canCreateAfterInitialError).map(fixture => ({ fixture, initialFailure: true })));
    }
    for (const { fixture, initialFailure } of scenarios) {
      const entry = initialFailure ? ' after an initial roster error' : '';
      test(`${fixture.name} creation closes before revalidation and Retry only reads${entry}`, async ({ page }) => {
        const requests = [];
        const readErrorStatus = fixture.name === 'Device' ? 500 : 503;
        const startWithRows = width === 1440;
        const keepsPreviousRows = startWithRows && fixture.name !== 'Device';
        let pendingRetry;
        let failRefresh;
        const releaseRefresh = new Promise(resolve => { failRefresh = resolve; });
        await page.routeWebSocket('**/*', () => {});
        await page.route('**/api/**', async route => {
          const { pathname } = new URL(route.request().url());
          const method = route.request().method();
          if (method === 'POST' && pathname === fixture.create) {
            requests.push(method);
            return route.fulfill({ status: 201, json: { ok: true } });
          }
          if (method === 'GET' && pathname === fixture.roster) {
            requests.push(method);
            if (requests.length === 1) {
              return initialFailure
                ? route.fulfill({ status: readErrorStatus, json: { error: 'Initial roster unavailable' } })
                : route.fulfill({ json: startWithRows ? fixture.previous : fixture.initial });
            }
            if (requests.join() === 'GET,POST,GET') {
              await releaseRefresh;
              return route.fulfill({ status: readErrorStatus, json: { error: 'Roster unavailable' } });
            }
            pendingRetry = route;
            return;
          }
          return route.fulfill({ json: pathname.endsWith('/supervision/bootstrap') ? { enabled: false } : {} });
        });

        await page.goto(fixture.route);
        const previousRow = page.getByText(fixture.previousRow, { exact: true });
        if (initialFailure) await expect(page.getByRole('alert')).toContainText(fixture.error);
        else if (startWithRows) await expect(previousRow).toBeVisible();
        else await expect(page.getByText(fixture.empty, { exact: true })).toBeVisible();
        const opener = page.getByRole('button', { name: fixture.open, exact: true });
        await opener.press('Enter');
        const dialog = page.getByRole('dialog');
        for (const [label, value] of Object.entries(fixture.fields)) {
          await dialog.getByLabel(label).fill(value);
        }
        await dialog.getByRole('button', { name: fixture.submit, exact: true }).click();
        try {
          await expect.poll(() => requests).toEqual(['GET', 'POST', 'GET']);
          await expect(dialog).toBeHidden();
          await expect(opener).toBeFocused();
          await opener.press('Enter');
          const nextDraft = dialog.getByLabel(Object.keys(fixture.fields)[0]);
          await expect(nextDraft).toHaveValue('');
          await nextDraft.fill('next-draft');
          const failedRead = page.waitForResponse(response => new URL(response.url()).pathname === fixture.roster
            && response.request().method() === 'GET' && response.status() === readErrorStatus);
          failRefresh();
          await failedRead;
          await expect(page.getByText(fixture.error, { exact: true })).toBeVisible();
          await expect(nextDraft).toHaveValue('next-draft');
          await expect(nextDraft).toBeFocused();
          await nextDraft.press('Escape');
          await expect(dialog).toBeHidden();
          await expect(opener).toBeFocused();
        } finally {
          failRefresh();
        }
        await expect(page.getByRole('alert')).toContainText(fixture.error);
        if (keepsPreviousRows) await expect(previousRow).toBeVisible();
        else await expect(previousRow).toHaveCount(0);
        const retry = page.getByRole('button', { name: 'Retry', exact: true });
        await retry.press('Enter');
        await expect.poll(() => Boolean(pendingRetry)).toBe(true);
        await expect(retry).toHaveCount(0);
        expect(await page.evaluate(() => document.activeElement.tagName)).not.toBe('BODY');
        const region = page.getByRole('region', { name: fixture.region, exact: true });
        await expect(region).toBeFocused();
        await expect(region).toHaveAttribute('aria-busy', 'true');
        await expect(region).toBeVisible();
        if (keepsPreviousRows) await expect(previousRow).toBeVisible();
        else await expect(previousRow).toHaveCount(0);
        await expect(opener).toBeEnabled();

        if (startWithRows) {
          await opener.press('Enter');
          const draft = dialog.getByLabel(Object.keys(fixture.fields)[0]);
          await draft.fill('while-retrying');
          await pendingRetry.fulfill({ json: fixture.updated });
          await expect(page.getByText(fixture.row, { exact: true })).toBeVisible();
          await expect(draft).toHaveValue('while-retrying');
          await expect(draft).toBeFocused();
          await draft.press('Escape');
          await expect(dialog).toBeHidden();
          await expect(opener).toBeFocused();
        } else {
          await pendingRetry.fulfill({ json: fixture.updated });
          await expect(region.getByText(fixture.row, { exact: true })).toBeVisible();
          await expect(region).toBeFocused();
        }
        await expect(region).not.toHaveAttribute('aria-busy', 'true');
        await expect(page.getByText(fixture.row, { exact: true })).toBeVisible();
        await expect(previousRow).toHaveCount(0);
        expect(requests).toEqual(['GET', 'POST', 'GET', 'GET']);
      });
    }

    test('Fleet clears a failed reconnect roster and retries with fresh devices', async ({ page }) => {
      let socket;
      let reads = 0;
      let recover;
      const releaseRetry = new Promise(resolve => { recover = resolve; });
      await page.addInitScript(() => localStorage.setItem('media-app.first-use-done', 'done'));
      await page.routeWebSocket('**/*', connection => { socket = connection; });
      await page.route('**/api/**', async route => {
        const { pathname } = new URL(route.request().url());
        if (pathname.endsWith('/device/config')) {
          reads++;
          if (reads === 1) {
            return route.fulfill({ json: { devices: { previous: { name: 'Previous screen', fleet: true } } } });
          }
          if (reads === 2) {
            return route.fulfill({ status: 503, json: { error: 'Fleet roster unavailable' } });
          }
          await releaseRetry;
          return route.fulfill({ json: { devices: { replacement: { name: 'Replacement screen', fleet: true } } } });
        }
        return route.fulfill({ json: pathname.endsWith('/supervision/bootstrap') ? { enabled: false } : {} });
      });

      await page.goto('/media');
      await page.getByRole('button', { name: 'Devices', exact: true }).click();
      await expect(page.getByTestId('fleet-peek-previous')).toBeVisible();
      await expect.poll(() => Boolean(socket)).toBe(true);
      socket.close({ code: 1001, reason: 'fixture restart' });
      const error = page.getByTestId('fleet-error');
      await expect(error).toBeVisible({ timeout: 20000 });
      await expect(error.getByText('Technical details')).toBeVisible();
      await error.getByRole('button', { name: 'Retry' }).click();
      try {
        await expect.poll(() => reads).toBe(3);
        await expect(page.getByTestId('fleet-loading')).toBeVisible();
        await expect(page.getByTestId('fleet-peek-previous')).toHaveCount(0);
      } finally {
        recover();
      }
      await expect(page.getByTestId('fleet-peek-replacement')).toBeVisible();
      expect(reads).toBe(3);
    });
  });
}

test('Media Fleet reads its configured roster once when the tab returns to the foreground', async ({ page }) => {
  let reads = 0;
  let screen = 'previous';
  await page.addInitScript(() => {
    localStorage.setItem('media-app.first-use-done', 'done');
    window.rosterFixtureVisible = true;
    Object.defineProperty(document, 'visibilityState', {
      get: () => window.rosterFixtureVisible ? 'visible' : 'hidden',
    });
  });
  await page.routeWebSocket('**/*', () => {});
  await page.route('**/api/**', route => {
    const { pathname } = new URL(route.request().url());
    if (pathname.endsWith('/device/config')) {
      reads++;
      return route.fulfill({ json: { devices: { [screen]: { name: `${screen} screen`, fleet: true } } } });
    }
    return route.fulfill({ json: pathname.endsWith('/supervision/bootstrap') ? { enabled: false } : {} });
  });

  await page.goto('/media');
  await page.getByRole('button', { name: 'Devices', exact: true }).click();
  const current = page.getByTestId('fleet-peek-previous');
  await expect(current).toBeVisible();
  const setVisibility = visible => page.evaluate(value => {
    window.rosterFixtureVisible = value;
    document.dispatchEvent(new Event('visibilitychange'));
  }, visible);

  screen = 'replacement';
  await setVisibility(false);
  await expect(current).toBeVisible();
  expect(reads).toBe(1);

  await setVisibility(true);
  await expect(page.getByTestId('fleet-peek-replacement')).toBeVisible();
  await expect(current).toHaveCount(0);
  expect(reads).toBe(2);
});

test('Admin Devices leaves a slow enforcement poll alone while the visible status ages', async ({ page }) => {
  const now = new Date('2026-11-19T12:00:00Z');
  await page.setViewportSize({ width: 1440, height: 850 });
  await page.clock.install({ time: now });
  await page.routeWebSocket('**/*', () => {});
  const statusReads = [];
  const status = lastContactAt => ({ enforcement: { consumers: [{
    deviceId: 'fixture', deviceLabel: 'Fixture device', capability: 'ha-stop', acknowledged: true, lastContactAt,
  }] } });
  await page.route('**/api/**', async route => {
    const { pathname } = new URL(route.request().url());
    if (pathname.endsWith('/shutdown/status')) {
      statusReads.push(route);
      if (statusReads.length === 1) return route.fulfill({ json: status(now.getTime()) });
      return;
    }
    return route.fulfill({ json: pathname.endsWith('/supervision/bootstrap') ? { enabled: false } : {} });
  });

  await page.goto('/admin/household/devices');
  await expect(page.getByText('Fixture device — Power: acknowledged (ready)', { exact: true })).toBeVisible();
  await page.clock.runFor(2000);
  await expect.poll(() => statusReads.length).toBe(2);
  await page.clock.runFor(4200);
  await expect(page.getByText(/Fixture device — Power: unverified.*stale/)).toBeVisible();
  expect(statusReads).toHaveLength(2);

  const freshTime = await page.evaluate(() => Date.now());
  await statusReads[1].fulfill({ json: status(freshTime) });
  await expect(page.getByText('Fixture device — Power: acknowledged (ready)', { exact: true })).toBeVisible();
  await page.clock.runFor(2000);
  await expect.poll(() => statusReads.length).toBe(3);

  const aborted = page.waitForEvent('requestfailed', request => request === statusReads[2].request());
  await page.getByRole('link', { name: 'Sessions', exact: true }).click();
  await expect(page).toHaveURL(/\/admin\/household\/sessions$/);
  await aborted;
  await page.clock.runFor(4200);
  expect(statusReads).toHaveLength(3);
});

for (const [fixture, removing] of [...adminCases.map(fixture => [fixture, false]), [adminCases[0], true]]) {
  test(`a confirmed ${fixture.name} ${removing ? 'removal' : 'creation'} refreshes the reopened roster without closing its new draft`, async ({ page }) => {
    const method = removing ? 'DELETE' : 'POST';
    const actionPath = removing ? fixture.create + '/fixture' : fixture.create;
    const release = Promise.withResolvers();
    const requests = [];
    let roster = removing ? fixture.updated : fixture.initial;
    await page.routeWebSocket('**/*', () => {});
    await page.route('**/api/**', async route => {
      const { pathname } = new URL(route.request().url());
      const operation = route.request().method();
      if (pathname === actionPath && operation === method) {
        requests.push(method);
        await release.promise;
        roster = removing ? fixture.initial : fixture.updated;
        return route.fulfill({ json: { ok: true } });
      }
      if (pathname === fixture.roster && operation === 'GET') {
        requests.push('GET');
        return route.fulfill({ json: roster });
      }
      return route.fulfill({ json: pathname.endsWith('/supervision/bootstrap') ? { enabled: false } : {} });
    });

    await page.goto(fixture.name === 'Device' ? '/admin/household/sessions' : '/admin/household/devices');
    const link = page.getByRole('link', { name: fixture.link, exact: true });
    await link.click();
    const item = page.getByText(fixture.row, { exact: true });
    const dialog = page.getByRole('dialog');
    if (removing) {
      await page.getByRole('row').filter({ hasText: fixture.row }).getByRole('button', { name: 'Remove' }).click();
      await dialog.getByRole('button', { name: 'Remove', exact: true }).click();
    } else {
      await page.getByRole('button', { name: fixture.open, exact: true }).click();
      for (const [label, value] of Object.entries(fixture.fields)) await dialog.getByLabel(label).fill(value);
      await dialog.getByRole('button', { name: fixture.submit, exact: true }).click();
    }
    const draftField = dialog.getByLabel(Object.keys(fixture.fields)[0]);
    try {
      await expect.poll(() => requests).toEqual(['GET', method]);
      await page.goBack();
      await link.click();
      await expect.poll(() => requests).toEqual(['GET', method, 'GET']);
      if (removing) await expect(item).toBeVisible();
      else await expect(item).toHaveCount(0);
      await page.getByRole('button', { name: fixture.open, exact: true }).click();
      await draftField.fill('new-draft');
    } finally {
      release.resolve();
    }
    await expect.poll(() => requests).toEqual(['GET', method, 'GET', 'GET']);
    await expect(draftField).toHaveValue('new-draft');
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
    if (removing) await expect(item).toHaveCount(0);
    else await expect(item).toBeVisible();
    expect(requests).toEqual(['GET', method, 'GET', 'GET']);
  });
}
