import { expect, test } from '@playwright/test';

test.use({ serviceWorkers: 'block' });

const cases = [
  { resource: 'weight', label: 'Weight history', width: 390, text: '171.6' },
  { resource: 14, label: 'Logged intake', width: 1440, chart: /^1 days with data/ },
  { resource: 30, label: 'Intake vs burn', width: 390, chart: /^1 days: average intake/ },
];

function progressRead(url) {
  if (url.pathname.endsWith('/health/weight')) return 'weight';
  if (url.pathname.endsWith('/health/goals')) return 'goals';
  if (!url.pathname.endsWith('/health/budget/range')) return null;
  const { searchParams } = url;
  return (Date.parse(searchParams.get('to')) - Date.parse(searchParams.get('from'))) / 86400000 + 1;
}

function progressResponse(resource, url) {
  if (resource === 'weight') return {
    '2026-09-10': { date: '2026-09-10', lbs: 170.9, measurement: 170.9, lbs_adjusted_average: 171.6 },
  };
  if (resource === 'goals') return { goals: { targetWeightLbs: 170, weeklyRateLbs: 0.5, budgetFloor: 1600 } };
  return { days: [{
    date: url.searchParams.get('to'), budget: 2000, food: 1500, exercise: 300, remaining: 800, status: 'under',
  }] };
}

async function interceptHealth(page, handleRead) {
  await page.routeWebSocket('**/*', () => {});
  await page.route('**/api/**', route => {
    const url = new URL(route.request().url());
    const resource = progressRead(url);
    if (resource !== null) return handleRead(route, resource, url);
    const json = url.pathname.endsWith('/supervision/bootstrap') ? { enabled: false }
      : url.pathname.endsWith('/health/context') ? { userId: 'alice' } : {};
    return route.fulfill({ json });
  });
}

for (const { resource, label, width, text, chart } of cases) {
  test(`Health Progress ${label} keeps focus through its own GET Retry`, async ({ page }) => {
    await page.setViewportSize({ width, height: 850 });
    const pending = Promise.withResolvers();
    const reads = [];
    await interceptHealth(page, async (route, owner, url) => {
      reads.push([route.request().method(), owner, url.pathname + url.search]);
      if (owner === resource) {
        if (reads.filter(([, key]) => key === resource).length === 1) {
          return route.fulfill({ status: 409, json: { error: 'Temporarily unavailable' } });
        }
        await pending.promise;
      }
      return route.fulfill({ json: progressResponse(owner, url) });
    });

    await page.goto('/health/progress');
    const main = page.getByRole('main');
    const edit = main.getByRole('button', { name: 'Edit goals' });
    const region = main.getByRole('region', { name: label, exact: true });
    try {
      await expect(edit).toBeVisible();
      await main.getByRole('button', { name: 'Retry', exact: true }).press('Enter');
      await expect.poll(() => reads.filter(([, key]) => key === resource).length).toBe(2);
      await expect(region).toBeFocused();
      await expect(region).toHaveAttribute('aria-busy', 'true');
      await expect(edit).toBeVisible();
      const siblingLabels = ['Goals', ...cases.map(item => item.label)].filter(name => name !== label);
      for (const name of siblingLabels) {
        const sibling = main.getByRole('region', { name, exact: true });
        await expect(sibling).toBeVisible();
        await expect(sibling).not.toHaveAttribute('aria-busy', 'true');
      }
      if (resource === 30) await edit.focus();
    } finally {
      pending.resolve();
    }

    await expect(text ? region.getByText(text, { exact: true }) : region.getByRole('img', { name: chart })).toBeVisible();
    await expect(region).not.toHaveAttribute('aria-busy', 'true');
    await expect(resource === 30 ? edit : region).toBeFocused();
    const matching = reads.filter(([, key]) => key === resource);
    expect(matching).toEqual([matching[0], matching[0]]);
    expect(reads.every(([method]) => method === 'GET')).toBe(true);
    expect(reads).toHaveLength(5);
  });
}

test('Health Progress keeps accepted charts and the Goals draft through a Coach refresh', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 850 });
  let refreshing = false;
  const pending = new Map();
  const reads = [];
  await interceptHealth(page, (route, resource, url) => {
    reads.push([route.request().method(), resource]);
    if (!refreshing) return route.fulfill({ json: progressResponse(resource, url) });
    pending.set(resource, { route, url });
  });
  await page.route('**/agents/health-coach/run-stream', route => {
    refreshing = true;
    return route.fulfill({
      contentType: 'text/event-stream',
      body: 'data: {"type":"text-delta","text":"Fixture answer"}\n\ndata: {"type":"done"}\n\n',
    });
  });

  await page.goto('/health/progress');
  const main = page.getByRole('main');
  const weight = main.getByText('171.6', { exact: true });
  // includeHidden: the open Goals sheet hides the page behind it from assistive technology.
  const intake = main.getByRole('img', { name: /^1 days with data/, includeHidden: true });
  const burn = main.getByRole('img', { name: /^1 days: average intake/, includeHidden: true });
  for (const chart of [weight, intake, burn]) await expect(chart).toBeVisible();
  await page.getByRole('link', { name: 'Progress', exact: true }).focus();
  await page.keyboard.press('Control+k');
  const coach = page.getByRole('dialog', { name: 'Health Coach', exact: true });
  await coach.getByPlaceholder(/^Ask…/).fill('Review fixture progress');
  await coach.getByRole('button', { name: 'Send message' }).click();
  await expect(coach.getByText('Fixture answer', { exact: true })).toBeVisible();
  await expect.poll(() => [...pending.keys()].map(String).sort()).toEqual(['14', '30', 'goals', 'weight']);
  await coach.getByRole('button', { name: 'Close', exact: true }).click();

  for (const chart of [weight, intake, burn]) await expect(chart).toBeVisible();
  for (const { label } of cases) {
    await expect(main.getByRole('region', { name: label, exact: true })).toHaveAttribute('aria-busy', 'true');
  }
  await main.getByRole('button', { name: 'Edit goals' }).click();
  const sheet = page.getByRole('dialog', { name: 'Edit goals', exact: true });
  const draft = sheet.getByRole('textbox', { name: 'Target weight', exact: true });
  await draft.fill('163');
  for (const [resource, { route, url }] of pending) {
    if (resource === 'weight' || resource === 'goals') {
      await route.fulfill({ status: 409, json: { error: 'Refresh unavailable' } });
    } else {
      await route.fulfill({ json: progressResponse(resource, url) });
    }
  }
  // The open Goals sheet hides the page behind it from assistive technology, so look past that.
  for (const { label } of cases) {
    await expect(main.getByRole('region', { name: label, exact: true, includeHidden: true })).not.toHaveAttribute('aria-busy', 'true');
  }
  await expect(main.getByRole('region', { name: 'Goals', exact: true, includeHidden: true })).not.toHaveAttribute('aria-busy', 'true');
  await expect(draft).toHaveValue(/163/);
  await expect(sheet.getByRole('button', { name: 'Retry', exact: true })).toHaveCount(0);
  for (const chart of [weight, intake, burn]) await expect(chart).toBeVisible();
  expect(reads).toHaveLength(8);
  expect(reads.every(([method]) => method === 'GET')).toBe(true);
});
