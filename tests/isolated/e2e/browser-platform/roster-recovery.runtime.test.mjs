import { expect, test } from '@playwright/test';

test.use({ serviceWorkers: 'block' });

const adminCases = [
  {
    name: 'Member',
    route: '/admin/household/members',
    roster: '/api/v1/admin/household',
    create: '/api/v1/admin/household/members',
    open: 'Add Member',
    submit: 'Add Member',
    fields: { Username: 'fixture' },
    initial: { members: [] },
    updated: { members: [{ username: 'fixture', display_name: 'Fixture Member' }] },
    row: 'Fixture Member',
    error: 'Household members failed to load',
  },
  {
    name: 'Scheduler',
    route: '/admin/system/scheduler',
    roster: '/api/v1/admin/scheduler/jobs',
    create: '/api/v1/admin/scheduler/jobs',
    open: 'Create Job',
    submit: 'Create',
    fields: { ID: 'fixture', Name: 'Fixture Job', Schedule: '0 * * * *' },
    initial: { jobs: [] },
    updated: { jobs: [{ id: 'fixture', name: 'Fixture Job', schedule: '0 * * * *' }] },
    row: 'Fixture Job',
    error: 'Scheduler jobs failed to load',
  },
];

for (const width of [390, 1440]) {
  test.describe(`roster recovery at ${width}px`, () => {
    test.use({ viewport: { width, height: 850 } });

    for (const fixture of adminCases) {
      test(`${fixture.name} creation closes before revalidation and Retry only reads`, async ({ page }) => {
        const requests = [];
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
            if (requests.join() === 'GET') return route.fulfill({ json: fixture.initial });
            if (requests.join() === 'GET,POST,GET') {
              await releaseRefresh;
              return route.fulfill({ status: 503, json: { error: 'Roster unavailable' } });
            }
            return route.fulfill({ json: fixture.updated });
          }
          return route.fulfill({ json: pathname.endsWith('/supervision/bootstrap') ? { enabled: false } : {} });
        });

        await page.goto(fixture.route);
        await page.getByRole('button', { name: fixture.open, exact: true }).click();
        const dialog = page.getByRole('dialog');
        for (const [label, value] of Object.entries(fixture.fields)) {
          await dialog.getByLabel(label).fill(value);
        }
        await dialog.getByRole('button', { name: fixture.submit, exact: true }).click();
        try {
          await expect.poll(() => requests).toEqual(['GET', 'POST', 'GET']);
          await expect(dialog).toBeHidden();
        } finally {
          failRefresh();
        }
        await expect(page.getByRole('alert')).toContainText(fixture.error);
        await page.getByRole('button', { name: 'Retry', exact: true }).click();
        await expect(page.getByRole('row').filter({ hasText: fixture.row })).toBeVisible();
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
