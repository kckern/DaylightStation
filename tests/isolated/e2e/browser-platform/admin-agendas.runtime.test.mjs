import { expect, test } from '@playwright/test';

test.use({ serviceWorkers: 'block', viewport: { width: 1440, height: 850 } });

const base = '/api/v1/admin/content/agendas';
const plansPath = `${base}/family/plans`;
const contextPath = `${base}/family/planning-context`;
const children = [plansPath, contextPath];
const responses = {
  [base]: { series: [
    { document: { series_id: 'family', title: 'Fixture family agenda', status: 'active' } },
    { document: { series_id: 'old', title: 'Fixture old agenda', status: 'archived' } },
  ] },
  [plansPath]: { plans: [{ document: { week_of: '2026-11-16', state: 'published' } }] },
  [contextPath]: { thisWeek: '2026-11-16', nextWeek: '2026-11-23' },
};

for (const scenario of [
  { name: 'series list', expectedHeld: [base], firstVisit: [base] },
  { name: 'active series reads', expectedHeld: children, firstVisit: [base, ...children] },
  { name: 'active series read after a sibling failure', expectedHeld: [plansPath], firstVisit: [base, ...children], failContext: true },
]) {
  test(`Admin Agendas cancels its pending ${scenario.name} when leaving the index`, async ({ page, baseURL }) => {
    const origin = new URL(baseURL).origin;
    const requests = [];
    const canceled = [];
    const held = new Map();
    let reopened = false;

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
      const path = new URL(request.url()).pathname;
      if (path === base || path.startsWith(`${base}/`)) {
        requests.push(`${request.method()} ${path}`);
        if (request.method() !== 'GET' || !(path in responses)) return route.fulfill({ status: 405 });
        if (!reopened && scenario.failContext && path === contextPath) {
          return route.fulfill({ status: 500, json: { message: 'Planning context unavailable' } });
        }
        if (!reopened && scenario.expectedHeld.includes(path)) {
          held.set(path, route);
          return;
        }
        return route.fulfill({ json: responses[path] });
      }
      return route.fulfill({ json: path.endsWith('/supervision/bootstrap') ? { enabled: false } : {} });
    });

    await page.goto('/admin/content/agendas');
    const pendingMessage = scenario.failContext ? 'Planning context unavailable' : 'Loading agendas…';
    await expect(page.getByText(pendingMessage, { exact: true })).toBeVisible();
    await expect.poll(() => [...held.keys()].sort()).toEqual([...scenario.expectedHeld].sort());
    await page.getByRole('link', { name: 'Devices', exact: true }).click();
    await expect(page).toHaveURL('/admin/household/devices');
    await expect.poll(() => [...canceled].sort()).toEqual([...scenario.expectedHeld].sort());
    for (const [path, route] of held) {
      // The old origin may answer after the browser has canceled the transport.
      await route.fulfill({ json: responses[path] }).catch(() => {});
    }
    expect([...requests].sort()).toEqual(scenario.firstVisit.map(path => `GET ${path}`).sort());

    reopened = true;
    await page.goBack();
    await expect(page).toHaveURL('/admin/content/agendas');
    await expect(page.getByRole('link', { name: 'Fixture family agenda', exact: true })).toBeVisible();
    await expect(page.getByText('This week: published', { exact: true })).toBeVisible();
    await expect(page.getByText('Next week: missing', { exact: true })).toBeVisible();
    const archived = page.getByRole('link', { name: 'Fixture old agenda', exact: true });
    await expect(archived).toBeHidden();
    await page.getByText('Archived agendas', { exact: true }).click();
    await expect(archived).toBeVisible();
    expect([...requests].sort()).toEqual([...scenario.firstVisit, base, ...children].map(path => `GET ${path}`).sort());
  });
}
