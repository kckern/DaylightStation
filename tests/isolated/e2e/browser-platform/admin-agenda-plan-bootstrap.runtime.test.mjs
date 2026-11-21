import { expect, test } from '@playwright/test';

test.use({ serviceWorkers: 'block', viewport: { width: 1440, height: 850 } });

const routePath = '/admin/content/agendas/family/plans/week';
const seriesPath = '/api/v1/admin/content/agendas/family';
const planPath = `${seriesPath}/plans/week`;
const contextPath = `${seriesPath}/planning-context`;
const directoryPath = '/api/v1/admin/people';
const planResponse = title => ({ headers: { ETag: '"plan"' }, json: {
  schema: 'agenda-plan/v1', household_id: 'fixture', series_id: 'family', plan_id: 'week', revision: 1,
  title, week_of: '2026-11-23', scheduled_on: '2026-11-23', state: 'draft',
  calendar: { timezone: 'UTC', week_starts_on: 'monday' }, participants: [], list: { sections: [] }, activity_settings: {},
} });
const contextResponse = { json: { thisWeek: '2026-11-16', nextWeek: '2026-11-23' } };
const directoryResponse = { headers: { ETag: '"directory"' }, json: { people: [] } };

for (const scenario of [
  { name: 'both pending', heldPaths: [planPath, contextPath, directoryPath] },
  { name: 'one failed', heldPaths: [planPath, directoryPath], contextFails: true },
]) {
  test(`Admin Agenda Plan cancels its bootstrap reads on exit with ${scenario.name}`, async ({ page, baseURL }) => {
    const origin = new URL(baseURL).origin;
    const held = new Map();
    const canceled = [];
    const reads = [];
    let reopened = false;
    let reopenedDirectory;

    await page.context().route('**/*', route => (
      new URL(route.request().url()).origin === origin ? route.fallback() : route.abort()
    ));
    await page.routeWebSocket('**/*', () => {});
    page.on('requestfailed', request => {
      const path = new URL(request.url()).pathname;
      if (held.get(path)?.request() === request) canceled.push(path);
    });
    await page.route('**/api/**', route => {
      const request = route.request();
      const { pathname } = new URL(request.url());
      if (![planPath, contextPath, directoryPath].includes(pathname)) {
        return route.fulfill({ json: pathname.endsWith('/supervision/bootstrap') ? { enabled: false } : {} });
      }
      reads.push(`${request.method()} ${pathname}`);
      if (request.method() !== 'GET') return route.fulfill({ status: 405 });
      if (!reopened && scenario.heldPaths.includes(pathname)) {
        held.set(pathname, route);
        return;
      }
      if (pathname === contextPath) {
        return !reopened && scenario.contextFails
          ? route.fulfill({ status: 500, json: { message: 'Fixture context unavailable' } })
          : route.fulfill(contextResponse);
      }
      if (pathname === planPath) return route.fulfill(planResponse('Reopened fixture plan'));
      reopenedDirectory = route;
    });

    await page.goto(routePath);
    await expect(page.getByText(scenario.contextFails ? 'Fixture context unavailable' : 'Loading agenda…', { exact: true })).toBeVisible();
    await expect.poll(() => [...held.keys()].sort()).toEqual([...scenario.heldPaths].sort());
    await page.getByRole('link', { name: 'Devices', exact: true }).click();
    await expect(page).toHaveURL('/admin/household/devices');
    await expect.poll(() => canceled.sort()).toEqual([...scenario.heldPaths].sort());
    const lateResponses = {
      [planPath]: planResponse('Departed fixture plan'),
      [contextPath]: contextResponse,
      [directoryPath]: directoryResponse,
    };
    for (const [path, route] of held) await route.fulfill(lateResponses[path]).catch(() => {});

    reopened = true;
    await page.goBack();
    await expect(page).toHaveURL(routePath);
    await expect.poll(() => Boolean(reopenedDirectory)).toBe(true);
    await expect(page.getByLabel('Title', { exact: true })).toHaveValue('Reopened fixture plan');
    await expect(page.getByRole('heading', { name: 'Next week', exact: true })).toBeVisible();
    await expect(page.getByText('Manage named guests', { exact: true })).toHaveCount(0);
    await reopenedDirectory.fulfill(directoryResponse);
    await expect(page.getByText('Manage named guests', { exact: true })).toBeVisible();
    expect(reads.sort()).toEqual([planPath, contextPath, directoryPath].flatMap(path => [`GET ${path}`, `GET ${path}`]).sort());
  });
}
