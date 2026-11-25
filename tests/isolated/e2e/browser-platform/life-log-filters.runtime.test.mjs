import { expect, test } from '@playwright/test';

test.use({ serviceWorkers: 'block', timezoneId: 'UTC', viewport: { width: 390, height: 850 } });

// 82e8618433: a period view's title is 'Week', 'Month', ... and gains ' · <date range>' only when
// the read carries dates; these fixtures carry none.
const logDate = '2026-11-22';
const logRetryCases = [
  ...['Week', 'Month', 'Season', 'Year', 'Decade'].map(scope => ({
    label: scope, scope, title: scope, route: '/life/log',
    request: `scope/${scope.toLowerCase()}`,
  })),
  { label: 'direct day', title: 'Nov 22, 2026', route: `/life/log/${logDate}`, request: logDate },
  { label: 'direct category', title: 'Health', route: '/life/log/category/health', request: 'category/health?scope=month' },
];

for (const { label, scope, title, route: url, request } of logRetryCases) {
  test(`Life Log ${label} keeps focus in its read region during Retry`, async ({ page }) => {
    if (!scope) await page.setViewportSize({ width: 1440, height: 850 });
    const member = { username: 'amy', displayName: 'Amy' };
    const path = `/api/v1/life/log/amy/${request}`;
    const pending = Promise.withResolvers();
    const reads = [];
    await page.clock.setFixedTime(new Date(`${logDate}T16:00:00Z`));
    await page.routeWebSocket('**/*', () => {});
    await page.route('**/api/**', async route => {
      const actual = route.request();
      const { pathname, search } = new URL(actual.url());
      if (pathname + search === path) {
        if (reads.push(actual.method()) === 1) {
          return route.fulfill({ status: 409, json: { error: 'Fixture refused this log read' } });
        }
        await pending.promise;
        return route.fulfill({ json: { days: {}, summaries: [] } });
      }
      const json = pathname.endsWith('/life/users') ? { users: [member] }
        : pathname.endsWith('/life/user') ? member
        : pathname.endsWith('/supervision/bootstrap') ? { enabled: false } : {};
      return route.fulfill({ json });
    });

    const main = page.getByRole('main');
    const results = main.getByRole('region', { name: 'Log results', exact: true });
    const retry = main.getByRole('button', { name: 'Retry', exact: true });
    const stayFocused = scope === 'Season' ? main.getByRole('checkbox', { name: 'Health', exact: true })
      : label === 'direct category' ? page.getByRole('link', { name: 'Log', exact: true }) : results;

    try {
      await page.goto(url);
      if (scope && scope !== 'Week') await main.locator('label').filter({ hasText: new RegExp(`^${scope}$`) }).click();
      await retry.press('Enter');
      await expect.poll(() => reads).toEqual(['GET', 'GET']);
      await expect(retry).toHaveCount(0);
      expect(await page.evaluate(() => document.activeElement === document.body)).toBe(false);
      await expect(results).toBeFocused();
      await expect(results).toHaveAttribute('aria-busy', 'true');
      await expect(results.getByRole('heading', { name: title, exact: true })).toHaveCount(0);
      if (scope) await expect(main.getByRole('radio', { name: scope, exact: true })).toBeEnabled();
      if (stayFocused !== results) await stayFocused.focus();
    } finally {
      pending.resolve();
    }

    await expect(results.getByRole('heading', { name: title, exact: true })).toBeVisible();
    await expect(results).not.toHaveAttribute('aria-busy', 'true');
    await expect(stayFocused).toBeFocused();
    expect(reads).toEqual(['GET', 'GET']);
  });
}

test('Life Log applies selected categories across day and period views without refetching the same scope', async ({ page }) => {
  const date = '2026-11-19';
  const earlier = '2026-11-18';
  const member = { username: 'amy', displayName: 'Amy' };
  const health = { source: 'weight', category: 'health', text: 'Recorded morning weight' };
  const calendar = { source: 'calendar', category: 'calendar', text: 'Afternoon appointment' };
  const day = {
    date,
    sources: { weight: {}, calendar: {} },
    categories: { health: { weight: {} }, calendar: { calendar: {} } },
    summaries: [health, calendar],
  };
  const days = {
    [earlier]: { sources: { calendar: {} }, categories: { calendar: { calendar: {} } }, summaries: [calendar] },
    [date]: day,
  };
  const base = '/api/v1/life/log/amy';
  const reads = [];

  await page.clock.setFixedTime(new Date(`${date}T16:00:00Z`));
  await page.routeWebSocket('**/*', () => {});
  await page.route('**/api/**', route => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/v1/life/users') return route.fulfill({ json: { users: [member] } });
    if (path === '/api/v1/life/user') return route.fulfill({ json: member });
    if (path.startsWith(`${base}/`)) {
      reads.push(path);
      return route.fulfill({ json: path === `${base}/${date}` ? day : { days } });
    }
    return route.fulfill({ json: path.endsWith('/supervision/bootstrap') ? { enabled: false } : {} });
  });

  await page.goto('/life/log');
  const main = page.getByRole('main');
  const activity = (day, sources) => main.locator('svg title').filter({ hasText: `${day}: ${sources} sources` });
  const chip = label => main.locator('label').filter({ hasText: new RegExp(`^${label}$`) });
  await expect(activity(date, 2)).toHaveCount(1);
  await expect(activity(earlier, 1)).toHaveCount(1);

  await chip('Health').click();
  await expect(main.getByRole('checkbox', { name: 'Health' })).toBeChecked();
  await expect(activity(date, 1)).toHaveCount(1);
  await expect(activity(earlier, 0)).toHaveCount(1);
  expect(reads).toEqual([`${base}/scope/week`]);

  for (const scope of ['Month', 'Season', 'Year', 'Decade']) {
    await chip(scope).click();
    await expect(main.getByRole('heading', { name: scope, exact: true })).toBeVisible();
    await expect(main.getByText('1 source', { exact: true })).toBeVisible();
  }
  expect(reads).toEqual(['week', 'month', 'season', 'year', 'decade'].map(scope => `${base}/scope/${scope}`));

  await chip('Week').click();
  await expect(activity(date, 1)).toHaveCount(1);
  const beforeDay = [...reads];
  await chip('Calendar').click();
  await expect(activity(date, 2)).toHaveCount(1);
  await expect(activity(earlier, 1)).toHaveCount(1);
  await chip('Health').click();

  await chip('Day').click();
  await expect(main.getByRole('radio', { name: 'Day' })).toBeChecked();
  await expect(main.getByRole('checkbox', { name: 'Calendar' })).toBeChecked();
  await expect(main.getByText(calendar.text, { exact: true })).toBeVisible();
  await expect(main.getByText(health.text, { exact: true })).toHaveCount(0);
  await chip('Calendar').click();
  await expect(main.getByText(health.text, { exact: true })).toBeVisible();
  expect(reads).toEqual([...beforeDay, `${base}/${date}`]);

  await chip('Calendar').click();
  await expect(main.getByText(health.text, { exact: true })).toHaveCount(0);
  await page.goto(`/life/log/${date}`);
  await expect(main.getByText(health.text, { exact: true })).toBeVisible();
  await expect(main.getByText(calendar.text, { exact: true })).toBeVisible();
  expect(reads).toEqual([...beforeDay, `${base}/${date}`, `${base}/${date}`]);
});

test('Life Log restores a history visit after its period loads and isolates the next member', async ({ page, baseURL }) => {
  await page.setViewportSize({ width: 390, height: 390 });
  const members = [
    { username: 'amy', displayName: 'Amy' },
    { username: 'bob', displayName: 'Bob' },
  ];
  const period = '/api/v1/life/log/amy/scope/month';
  const day = {
    sources: { weight: {}, calendar: {} },
    categories: { health: { weight: {} }, calendar: { calendar: {} } },
  };
  const days = Object.fromEntries(Array.from({ length: 30 }, (_, index) => [
    '2026-11-' + String(index + 1).padStart(2, '0'), day,
  ]));
  const release = Promise.withResolvers();
  let monthReads = 0;
  const origin = new URL(baseURL).origin;
  await page.context().route('**/*', route => (
    new URL(route.request().url()).origin === origin ? route.fallback() : route.abort()
  ));
  await page.routeWebSocket('**/*', () => {});
  await page.route('**/api/**', async route => {
    const { pathname, searchParams } = new URL(route.request().url());
    if (pathname === '/api/v1/life/users') return route.fulfill({ json: { users: members } });
    if (pathname === '/api/v1/life/user') {
      const user = searchParams.get('username') || 'amy';
      return route.fulfill({ json: members.find(member => member.username === user) });
    }
    if (pathname === period) {
      if (++monthReads === 2) await release.promise;
      return route.fulfill({ json: { days } });
    }
    return route.fulfill({ json: pathname.endsWith('/supervision/bootstrap') ? { enabled: false } : {} });
  });
  await page.clock.setFixedTime(new Date('2026-11-19T16:00:00Z'));

  await page.goto('/life/plan');
  const logTab = page.getByRole('link', { name: 'Log', exact: true });
  await logTab.click();
  const main = page.getByRole('main');
  const scroll = () => main.evaluate(node => node.scrollTop);
  const month = main.getByRole('radio', { name: 'Month' });
  const week = main.getByRole('radio', { name: 'Week' });
  const health = main.getByRole('checkbox', { name: 'Health' });
  const monthHeading = main.getByRole('heading', { name: 'Month', exact: true });
  const lastWeek = main.getByText(/^Week of /).last();
  await main.locator('label').filter({ hasText: /^Month$/ }).click();
  await main.locator('label').filter({ hasText: /^Health$/ }).click();
  await expect(monthHeading).toBeVisible();
  await expect(month).toBeChecked();
  await expect(health).toBeChecked();
  await lastWeek.scrollIntoViewIfNeeded();
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const savedPosition = await scroll();
  expect(savedPosition).toBeGreaterThan(100);

  await logTab.click();
  await expect(month).toBeChecked();
  await expect(health).toBeChecked();
  await expect.poll(scroll).toBe(savedPosition);

  await page.getByRole('link', { name: 'Plan', exact: true }).click();
  await expect(page).toHaveURL(/\/life\/plan$/);
  await page.goBack();
  try {
    await expect(page).toHaveURL(/\/life\/log$/);
    await expect(month).toBeChecked();
    await expect(health).toBeChecked();
    await expect.poll(() => monthReads).toBe(2);
    await expect(monthHeading).toHaveCount(0);
    await expect.poll(scroll).toBe(0);
  } finally {
    release.resolve();
  }
  await expect(monthHeading).toBeAttached();
  await expect(main.locator('svg title').filter({ hasText: '2026-11-19: 1 sources' })).toHaveCount(1);
  await expect.poll(scroll).toBe(savedPosition);
  await expect(lastWeek).toBeInViewport();

  await page.goForward();
  await expect(page).toHaveURL(/\/life\/plan$/);
  await logTab.click();
  await expect(week).toBeChecked();
  await expect(health).not.toBeChecked();
  await expect.poll(scroll).toBe(0);
  await page.goBack();
  await expect(page).toHaveURL(/\/life\/plan$/);
  await page.goBack();
  await expect(month).toBeChecked();
  await expect(health).toBeChecked();
  await expect.poll(scroll).toBe(savedPosition);

  await page.goBack();
  await expect(page).toHaveURL(/\/life\/plan$/);
  await page.goForward();
  await expect(page).toHaveURL(/\/life\/log$/);
  await expect(month).toBeChecked();
  await expect(health).toBeChecked();
  await expect.poll(scroll).toBe(savedPosition);

  const switcher = page.getByRole('textbox', { name: 'Switch household member' });
  await switcher.click();
  await page.getByRole('option', { name: 'Bob' }).click();
  await expect(switcher).toHaveValue('Bob');
  await expect(week).toBeChecked();
  await expect(health).not.toBeChecked();
  await expect.poll(scroll).toBe(0);
});
