import { expect, test } from '@playwright/test';

test.use({ serviceWorkers: 'block' });

async function installDashboard(page, failedMode, path = '/life/now') {
  const user = { username: 'amy', displayName: 'Amy' };
  const reads = { priorities: [], dashboard: [], plan: [] };
  const release = Promise.withResolvers();
  await page.routeWebSocket('**/*', () => {});
  await page.route('**/api/**', async route => {
    const { pathname, searchParams } = new URL(route.request().url());
    const identity = searchParams.get('username');
    if (pathname.endsWith('/supervision/bootstrap')) return route.fulfill({ json: { enabled: false } });
    if (pathname.endsWith('/life/users')) return route.fulfill({ json: { users: [user] } });
    if (pathname.endsWith('/life/user')) return route.fulfill({ json: user });
    if (pathname.endsWith('/life/plan/')) {
      reads.plan.push(identity);
      return route.fulfill({ json: { purpose: { statement: 'Fixture plan' } } });
    }
    if (pathname.endsWith('/life/now')) {
      const mode = searchParams.get('mode');
      reads[mode].push(identity);
      if (failedMode === mode) {
        if (reads[mode].length === 1) return route.fulfill({ status: 400, json: { error: mode + ' unavailable' } });
        await release.promise;
      }
      const json = mode === 'dashboard'
        ? { dashboard: { goalProgress: [{ id: 'goal', name: 'Summary goal', state: 'active', progress: 0.5 }] } }
        : { priorities: failedMode ? [{ type: 'goal_deadline', title: 'Upcoming goal', reason: 'Due soon' }] : [] };
      return route.fulfill({ json });
    }
    return route.fulfill({ json: {} });
  });
  await page.goto(path);
  return { reads, release };
}

for (const failedMode of ['priorities', 'dashboard']) {
  test('Life retries only the refused ' + failedMode + ' read and keeps the successful section visible', async ({ page }) => {
    const { reads, release } = await installDashboard(page, failedMode);
    const main = page.getByRole('main');
    const sibling = main.getByText(failedMode === 'priorities' ? 'Summary goal' : 'Upcoming goal');
    const alert = main.getByRole('alert');
    await expect(sibling).toBeVisible();
    await expect(alert).toContainText(failedMode + ' unavailable');
    await expect(main.getByText(/all caught up/)).toHaveCount(0);
    try {
      await alert.getByRole('button', { name: 'Retry' }).click();
      await expect.poll(() => reads[failedMode]).toEqual(['amy', 'amy']);
      await expect(sibling).toBeVisible();
    } finally {
      release.resolve();
    }
    await expect(main.getByText('Upcoming goal')).toBeVisible();
    await expect(main.getByText('Summary goal')).toBeVisible();
    await expect(alert).toHaveCount(0);
    expect(reads[failedMode === 'priorities' ? 'dashboard' : 'priorities']).toEqual(['amy']);
    expect(reads.plan).toEqual(['amy']);
  });
}

test('Life shows caught-up copy after a successful empty priority read', async ({ page }) => {
  const { reads } = await installDashboard(page, null, '/life');
  await expect(page).toHaveURL('/life/now');
  const main = page.getByRole('main');
  await expect(main.getByText(/all caught up/)).toBeVisible();
  await expect(main.getByText('Summary goal')).toBeVisible();
  await expect(main.getByRole('alert')).toHaveCount(0);
  expect(reads).toEqual({ priorities: ['amy'], dashboard: ['amy'], plan: ['amy'] });
});
