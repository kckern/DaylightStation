import { expect, test } from '@playwright/test';

test.use({ serviceWorkers: 'block', timezoneId: 'UTC', viewport: { width: 390, height: 850 } });

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
    await expect(main.getByRole('heading', { name: scope === 'Decade' ? scope : `This ${scope}`, exact: true })).toBeVisible();
    await expect(main.getByText('1 sources', { exact: true })).toBeVisible();
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
