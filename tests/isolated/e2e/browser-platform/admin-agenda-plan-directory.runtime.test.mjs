import { expect, test } from '@playwright/test';

test.use({ serviceWorkers: 'block', viewport: { width: 1440, height: 850 } });

const seriesPath = '/api/v1/admin/content/agendas/family';
const directoryPath = '/api/v1/admin/people';
const guestPath = `${directoryPath}/guests/visitor`;
const plan = {
  schema: 'agenda-plan/v1', household_id: 'fixture', series_id: 'family', plan_id: 'week', revision: 1,
  title: 'Fixture weekly plan', week_of: '2026-11-23', scheduled_on: '2026-11-23', state: 'draft',
  calendar: { timezone: 'UTC', week_starts_on: 'monday' }, participants: [], list: { sections: [] }, activity_settings: {},
};
const guest = name => ({ person: { kind: 'guest', id: 'visitor' }, display: { name, avatar: null }, active: true });
const directory = (name, etag) => ({ headers: { ETag: etag }, json: { people: [guest(name)] } });

test('Admin Agenda plan refresh retires the older guest directory and preserves the current revision', async ({ page, baseURL }) => {
  const origin = new URL(baseURL).origin;
  let initialDirectory;
  let canceledInitialDirectory = false;
  const directoryReads = [];
  const guestWrites = [];

  await page.context().route('**/*', route => (
    new URL(route.request().url()).origin === origin ? route.fallback() : route.abort()
  ));
  await page.routeWebSocket('**/*', () => {});
  page.on('requestfailed', request => {
    if (initialDirectory?.request() === request) canceledInitialDirectory = true;
  });
  await page.route('**/api/**', route => {
    const request = route.request();
    const { pathname, search } = new URL(request.url());
    if (pathname === directoryPath) {
      directoryReads.push(`${request.method()} ${pathname}${search}`);
      if (directoryReads.length === 1) {
        initialDirectory = route;
        return;
      }
      return route.fulfill(directory('Fresh Guest', '"new"'));
    }
    if (pathname === guestPath) {
      const write = { method: request.method(), ifMatch: request.headers()['if-match'], body: request.postDataJSON() };
      guestWrites.push(write);
      if (write.method !== 'PUT' || write.ifMatch !== '"new"') {
        return route.fulfill({ status: 409, json: { message: 'Directory revision changed' } });
      }
      return route.fulfill({ headers: { ETag: '"confirmed"' }, json: guest(write.body.name) });
    }
    if (pathname === `${seriesPath}/plans/week`) return route.fulfill({ headers: { ETag: '"plan"' }, json: plan });
    if (pathname === `${seriesPath}/planning-context`) {
      return route.fulfill({ json: { thisWeek: '2026-11-16', nextWeek: '2026-11-23' } });
    }
    return route.fulfill({ json: pathname.endsWith('/supervision/bootstrap') ? { enabled: false } : {} });
  });

  await page.goto('/admin/content/agendas/family/plans/week');
  const title = page.getByLabel('Title', { exact: true });
  await expect(title).toHaveValue(plan.title);
  await expect.poll(() => Boolean(initialDirectory)).toBe(true);
  await page.getByRole('button', { name: 'Refresh display snapshots', exact: true }).click();
  await page.getByText('Manage named guests', { exact: true }).click();
  const freshGuest = page.getByLabel('Name for Fresh Guest', { exact: true });
  await expect(freshGuest).toHaveValue('Fresh Guest');
  await expect.poll(() => canceledInitialDirectory).toBe(true);
  // The stale origin can still try to answer after the browser canceled its GET.
  await initialDirectory.fulfill(directory('Stale Guest', '"old"')).catch(() => {});
  await expect(page.getByLabel('Name for Stale Guest', { exact: true })).toHaveCount(0);

  await freshGuest.fill('Updated Guest');
  await page.getByRole('button', { name: 'Save Fresh Guest', exact: true }).click();
  await expect(page.getByLabel('Name for Updated Guest', { exact: true })).toHaveValue('Updated Guest');
  await expect(title).toHaveValue(plan.title);
  expect(directoryReads).toEqual(Array(2).fill(`GET ${directoryPath}?includeArchived=true`));
  expect(guestWrites).toEqual([{ method: 'PUT', ifMatch: '"new"', body: { name: 'Updated Guest' } }]);
});
