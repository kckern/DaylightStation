import { expect, test } from '@playwright/test';

test.use({ serviceWorkers: 'block' });

async function installDashboard(page, failedMode, path = '/life/now', { scaffolding = false } = {}) {
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
      const dashboard = {
        goalProgress: [{ id: 'goal', name: 'Summary goal', state: 'active', progress: 0.5 }],
        ...(scaffolding && { stage: 'scaffolding', completeness: { hasPurpose: true, valueCount: 1, goalCount: 0 } }),
      };
      const priorities = scaffolding
        ? [
            { type: 'plan_gap', gap: 'goals', title: 'Pick a priority goal', reason: 'Put your plan to work' },
            { type: 'goal_deadline', title: 'Upcoming goal', reason: 'Due soon' },
          ]
        : failedMode ? [{ type: 'goal_deadline', title: 'Upcoming goal', reason: 'Due soon' }] : [];
      const json = mode === 'dashboard' ? { dashboard } : { priorities };
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

test('Life Dashboard uses native links for setup and priorities with a separate touch dismissal', async ({ browser, baseURL }) => {
  const context = await browser.newContext({
    baseURL, serviceWorkers: 'block', hasTouch: true, viewport: { width: 390, height: 850 },
  });
  try {
    const page = await context.newPage();
    await installDashboard(page, null, '/life/now', { scaffolding: true });
    const main = page.getByRole('main');
    const setup = main.getByRole('link', { name: 'Add a couple of values' });
    const priority = main.getByRole('link', { name: 'Pick a priority goal' });
    const dismiss = main.getByRole('button', { name: 'Dismiss Pick a priority goal' });
    await expect(setup).toHaveAttribute('href', '/life/plan/values');
    await expect(main.getByRole('link', { name: 'Name your purpose' })).toHaveCount(0);
    await expect(main.getByRole('link', { name: 'Upcoming goal' })).toHaveCount(0);
    await expect(priority).toHaveAttribute('href', '/life/plan/goals');
    await expect.poll(() => dismiss.evaluate(button => {
      const { width, height } = button.getBoundingClientRect();
      return Math.min(width, height);
    })).toBeGreaterThanOrEqual(44);

    await setup.focus();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL('/life/plan/values');
    await page.goBack();
    await priority.focus();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL('/life/plan/goals');
    await page.goBack();

    await priority.scrollIntoViewIfNeeded();
    const cardCorner = await priority.evaluate(link => {
      const { left, top } = link.closest('.life-priority').getBoundingClientRect();
      return { x: left + 4, y: top + 4 };
    });
    await page.touchscreen.tap(cardCorner.x, cardCorner.y);
    await expect(page).toHaveURL('/life/plan/goals');
    await page.goBack();

    await priority.focus();
    await page.keyboard.press('Tab');
    await expect(dismiss).toBeFocused();
    await page.keyboard.press('Space');
    await expect(priority).toHaveCount(0);
    await expect(page).toHaveURL('/life/now');
    await expect(main.getByText('Upcoming goal')).toBeVisible();
  } finally {
    await context.close();
  }
});
