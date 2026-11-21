import { expect, test } from '@playwright/test';

test.use({ serviceWorkers: 'block' });

const person = { username: 'amy', displayName: 'Amy' };
const reads = {
  priorities: { priorities: [{ type: 'plan_gap', gap: 'values', title: 'Fixture priority' }] },
  dashboard: { dashboard: { goalProgress: [{ id: 'goal', name: 'Fixture goal', state: 'active', progress: 0.5 }] } },
  plan: { purpose: { statement: 'Fixture plan' } },
  triage: { enrolled: true, mode: 'live', preDone: { archived: 2 } },
};

const cases = [
  { key: 'priorities', label: 'Priorities', width: 390, result: 'Fixture priority', sibling: 'Fixture goal' },
  { key: 'dashboard', label: 'Dashboard summary', width: 390, result: 'Fixture goal', sibling: 'Fixture priority' },
  { key: 'dashboard', label: 'Dashboard summary', width: 1440, result: 'Fixture goal', sibling: 'Fixture priority', moveFocus: true },
  { key: 'plan', label: 'Life plan', width: 390, result: 'Fixture priority' },
  { key: 'triage', label: 'Triage summary', width: 1440, result: '2 emails archived', sibling: 'Fixture goal' },
  { key: 'triage', label: 'Triage summary', width: 390, result: 'Triage is not set up for this member.', sibling: 'Fixture goal', unenrolled: true },
];

async function installReads(page, key, { unenrolled, warm = false } = {}) {
  const seen = [];
  const writes = [];
  const sessions = [];
  const release = Promise.withResolvers();
  await page.routeWebSocket('**/*', () => {});
  await page.route('**/api/**', async route => {
    const request = route.request();
    const { pathname, searchParams } = new URL(request.url());
    if (/^\/api\/v1\/(life|triage)\//.test(pathname) && request.method() !== 'GET') writes.push(pathname);
    if (pathname === '/api/v1/triage/session') sessions.push(request.method());
    const resource = pathname.endsWith('/life/now') ? searchParams.get('mode')
      : pathname.endsWith('/life/plan/') ? 'plan'
      : pathname.endsWith('/triage/summary') ? 'triage' : null;
    if (resource && Object.hasOwn(reads, resource)) {
      seen.push([request.method(), resource, searchParams.get('username')]);
      if (resource === key) {
        const attempt = seen.filter(([, read]) => read === key).length;
        const failedAttempt = warm ? 2 : 1;
        if (attempt === failedAttempt) {
          return route.fulfill({ status: 409, json: { error: 'Temporarily unavailable' } });
        }
        if (attempt > failedAttempt) await release.promise;
      }
      const json = resource === 'triage' && unenrolled ? { enrolled: false } : reads[resource];
      return route.fulfill({ json });
    }
    const json = pathname.endsWith('/supervision/bootstrap') ? { enabled: false }
      : pathname.endsWith('/life/users') ? { users: [person] }
      : pathname.endsWith('/life/user') ? person : {};
    return route.fulfill({ json });
  });
  return { seen, writes, sessions, release };
}

for (const { key, label, width, result, sibling, moveFocus, unenrolled } of cases) {
  const outcome = unenrolled ? 'when the member is not enrolled'
    : moveFocus ? 'until the user chooses another control' : 'through read recovery';
  test(`Life Now ${label} keeps keyboard focus ${outcome}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 850 });
    const { seen, writes, sessions, release } = await installReads(page, key, { unenrolled });
    await page.goto('/life/now');
    const main = page.getByRole('main');
    const region = main.getByRole('region', { name: label, exact: true });
    const nav = page.getByRole('link', { name: 'Now', exact: true });
    const readKey = ['GET', key, 'amy'];
    try {
      await main.getByRole('button', { name: /^retry$/i }).press('Enter');
      await expect.poll(() => seen.filter(([, resource]) => resource === key)).toEqual([readKey, readKey]);
      await expect(region).toBeFocused();
      await expect(region).toHaveAttribute('aria-busy', 'true');
      if (sibling) {
        await expect(main.getByText(sibling, { exact: true })).toBeVisible();
      }
      if (key === 'plan') {
        await expect(main.getByText('Fixture priority', { exact: true })).toHaveCount(0);
      }
      if (moveFocus) await nav.focus();
    } finally {
      release.resolve();
    }
    await expect(main.getByText(result, { exact: true })).toBeVisible();
    await expect(region).not.toHaveAttribute('aria-busy', 'true');
    await expect(moveFocus ? nav : region).toBeFocused();
    if (key === 'dashboard' && !moveFocus) {
      await expect(region.getByRole('status')).toHaveText('Dashboard summary loaded.');
    }
    if (key === 'plan') {
      await expect(region.getByRole('status')).toHaveText('Life plan loaded.');
      await nav.focus();
      await expect(region).toHaveCount(0);
    }
    expect(seen).toHaveLength(5);
    expect(writes).toEqual([]);
    expect(sessions).toEqual([]);
    if (unenrolled) await expect(main.getByRole('link', { name: /Start triage/ })).toHaveCount(0);
  });
}

test('Life Now can retry a cached plan independently of its available cards', async ({ page }) => {
  const { seen, writes, sessions, release } = await installReads(page, 'plan', { warm: true });
  const plan = ['GET', 'plan', 'amy'];
  await page.goto('/life/plan');
  await expect(page.getByText('Fixture plan', { exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Now', exact: true }).click();
  const main = page.getByRole('main');
  const region = main.getByRole('region', { name: 'Life plan', exact: true });
  try {
    await main.getByRole('button', { name: 'Retry', exact: true }).press('Enter');
    await expect.poll(() => seen.filter(([, key]) => key === 'plan')).toEqual([plan, plan, plan]);
    await expect(region).toBeFocused();
    await expect(region).toHaveAttribute('aria-busy', 'true');
    await expect(main.getByText('Fixture priority', { exact: true })).toBeVisible();
    await expect(main.getByText('Fixture goal', { exact: true })).toBeVisible();
    await expect(region.getByRole('region', { name: 'Priorities', exact: true })).toHaveCount(0);
    await expect(region.getByRole('region', { name: 'Dashboard summary', exact: true })).toHaveCount(0);
  } finally {
    release.resolve();
  }
  await expect(region.getByRole('status')).toHaveText('Life plan loaded.');
  await expect(region).toBeFocused();
  expect(writes).toEqual([]);
  expect(sessions).toEqual([]);
});
