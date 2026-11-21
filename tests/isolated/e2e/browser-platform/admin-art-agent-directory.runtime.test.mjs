import { expect, test } from '@playwright/test';

test.use({ serviceWorkers: 'block', viewport: { width: 390, height: 850 } });

test.beforeEach(async ({ page }) => {
  await page.routeWebSocket('**/*', () => {});
  await page.route('**/api/**', route => route.fulfill({
    json: new URL(route.request().url()).pathname.endsWith('/supervision/bootstrap') ? { enabled: false } : {},
  }));
});

test('Admin Art retries settings independently and aborts the work read for an old filter', async ({ page }) => {
  const reads = [];
  const release = Promise.withResolvers();
  let settingsReads = 0;
  await page.route('**/api/v1/admin/config/files/**', route => {
    settingsReads++;
    return settingsReads === 1
      ? route.fulfill({ status: 400, json: { error: 'Settings unavailable' } })
      : route.fulfill({ json: { parsed: { quickTags: ['highlights', 'portraits'] } } });
  });
  await page.route('**/api/v1/admin/art/works?*', async route => {
    const query = new URL(route.request().url()).searchParams.get('q');
    reads.push(query);
    const title = ({ old: 'Retired work', current: 'Current work' })[query] ?? 'Initial work';
    if (query === 'old') await release.promise;
    await route.fulfill({ json: { total: 1, works: [{ id: title, image: '/icon-192.png', meta: { title } }] } });
  });

  await page.goto('/admin/content/art');
  const alert = page.getByRole('alert').filter({ hasText: 'Artwork settings failed to load' });
  await expect(page.getByRole('heading', { name: 'Initial work' })).toBeVisible();
  await alert.getByRole('button', { name: 'Retry', exact: true }).click();
  await expect(alert).toHaveCount(0);
  await expect(page.getByText(/1–2 quick-tag/)).toBeVisible();
  expect(settingsReads).toBe(2);
  expect(reads).toEqual([null]);

  const search = page.getByPlaceholder('search title / artist…');
  await search.fill('old');
  try {
    await expect.poll(() => reads).toEqual([null, 'old']);
    const aborted = [];
    page.on('requestfailed', request => {
      const url = new URL(request.url());
      if (url.pathname === '/api/v1/admin/art/works') aborted.push(url.searchParams.get('q'));
    });
    await search.fill('current');
    await expect(page.getByRole('heading', { name: 'Current work' })).toBeVisible();
    await expect.poll(() => aborted).toEqual(['old']);
  } finally {
    release.resolve();
  }
  await expect(page.getByRole('heading', { name: 'Retired work' })).toHaveCount(0);
  expect(reads).toEqual([null, 'old', 'current']);
  expect(settingsReads).toBe(2);
});

test('Admin Agents retries the directory, opens the agent by keyboard and preserves history through a fallback URL', async ({ page }) => {
  const path = '/admin/agents';
  let reads = 0;
  const agent = { id: 'fixture-agent', description: 'Fixture assistant' };
  await page.route('**/api/v1/agents', route => {
    reads++;
    return reads === 1
      ? route.fulfill({ status: 400, json: { error: 'Directory unavailable' } })
      : route.fulfill({ json: { agents: [agent] } });
  });
  await page.route('**/api/v1/admin/content/lists/menus', route => route.fulfill({ json: { lists: [] } }));

  await page.goto(path);
  const alert = page.getByRole('alert').filter({ hasText: 'Agents failed to load' });
  await expect(alert).toContainText('Directory unavailable');
  await expect(page.getByText('No agents registered')).toHaveCount(0);
  await alert.getByRole('button', { name: 'Retry', exact: true }).press('Enter');
  const found = page.getByRole('link', { name: /fixture-agent/ });
  await expect(found).toContainText(agent.description);
  expect(reads).toBe(2);
  await found.press('Enter');
  await expect(page).toHaveURL(`${path}/${agent.id}`);
  await expect(page.getByRole('tab', { name: 'Overview' })).toBeVisible();

  await page.goto('/admin/retired-destination-fixture');
  await expect(page).toHaveURL('/admin/content/lists/menus');
  await page.goBack();
  await expect(page).toHaveURL(`${path}/${agent.id}`);
  await expect(page.getByRole('tab', { name: 'Overview' })).toBeVisible();
});
