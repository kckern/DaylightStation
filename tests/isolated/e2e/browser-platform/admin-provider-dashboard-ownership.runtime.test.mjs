import { expect, test } from '@playwright/test';

test.use({ serviceWorkers: 'block' });

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

async function changeRoute(page, path) {
  await page.evaluate(next => {
    history.pushState({}, '', next);
    dispatchEvent(new PopStateEvent('popstate'));
  }, path);
}

test('Integrations shows a retryable read error and opens a provider by keyboard after recovery', async ({ page }) => {
  const firstRead = deferred();
  const reads = [];
  const integrationsPath = '/api/v1/admin/integrations';
  const providerDetailUrl = 'https://withings.invalid/details';

  await page.routeWebSocket('**/*', () => {});
  await page.route('**/api/**', async route => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path === integrationsPath) {
      reads.push(request.method());
      if (reads.length === 1) {
        await firstRead.promise;
        return route.fulfill({ status: 500, json: { error: 'Provider roster unavailable' } });
      }
      return route.fulfill({ json: { integrations: [
        { provider: 'withings', category: 'health', hasAuth: true },
        { provider: 'plex', category: 'media', hasAuth: false },
      ] } });
    }
    if (path === `${integrationsPath}/withings`) {
      return route.fulfill({ json: { integration: { provider: 'withings', category: 'health', url: providerDetailUrl } } });
    }
    if (path === '/api/v1/auth/context') return route.fulfill({ json: { setupComplete: true, authenticated: true } });
    if (path === '/api/v1/supervision/bootstrap') return route.fulfill({ json: { enabled: false } });
    return route.fulfill({ json: {} });
  });

  const emptyState = page.getByText('No integrations found.', { exact: true });
  const loadingState = page.getByLabel('Loading integrations', { exact: true });
  try {
    await page.goto('/admin/system/integrations');
    await expect.poll(() => reads).toEqual(['GET']);
    await expect(loadingState).toBeVisible();
    await expect(emptyState).toHaveCount(0);
  } finally {
    firstRead.resolve();
  }

  const errorState = page.getByRole('alert').filter({ hasText: 'Provider roster unavailable' });
  await expect(errorState).toBeVisible();
  await expect(loadingState).toHaveCount(0);
  await expect(emptyState).toHaveCount(0);
  expect(reads).toEqual(['GET']);
  await errorState.getByRole('button', { name: 'Retry', exact: true }).click();

  const withings = page.getByRole('link', { name: /Withings/ });
  await expect(withings).toBeVisible();
  await expect(page.getByRole('link', { name: /Plex/ })).toBeVisible();
  await expect(errorState).toHaveCount(0);
  await expect(emptyState).toHaveCount(0);
  await withings.press('Enter');
  await expect(page).toHaveURL(/\/admin\/system\/integrations\/withings$/);
  await expect(page.getByRole('link', { name: providerDetailUrl })).toBeVisible();
  expect(reads).toEqual(['GET', 'GET']);
});

test('Integration Detail keeps provider data and test results with the provider route', async ({ page }) => {
  const oldRead = deferred();
  const readStarted = deferred();
  const oldTest = deferred();
  const testStarted = deferred();
  await page.routeWebSocket('**/*', () => {});
  await page.route('**/api/**', async route => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path === '/api/v1/auth/context') return route.fulfill({ json: { setupComplete: true, authenticated: true } });
    if (path === '/api/v1/supervision/bootstrap') return route.fulfill({ json: { enabled: false } });
    if (path.startsWith('/api/v1/supervision/access')) return route.fulfill({ json: { allowed: true, issuedAt: Date.now(), expiresAt: Date.now() + 5000, epoch: 0 } });
    if (path === '/api/v1/admin/integrations/alpha') {
      readStarted.resolve();
      await oldRead.promise;
      return route.fulfill({ json: { integration: { provider: 'alpha', category: 'ai', url: 'https://alpha.invalid/details' } } });
    }
    if (path === '/api/v1/admin/integrations/alpha/test') {
      testStarted.resolve();
      await oldTest.promise;
      return route.fulfill({ json: { status: 'success', message: 'alpha marker' } });
    }
    if (path === '/api/v1/admin/integrations/withings/test') {
      return route.fulfill({ json: { status: 'success', message: 'withings marker' } });
    }
    if (path === '/api/v1/admin/integrations/withings') {
      return route.fulfill({ json: { integration: { provider: 'withings', category: 'ai', url: 'https://withings.invalid/details' } } });
    }
    return route.fulfill({ json: {} });
  });

  await page.goto('/admin/system/integrations/alpha');
  await readStarted.promise;
  await changeRoute(page, '/admin/system/integrations/withings');
  await expect(page.getByRole('link', { name: 'https://withings.invalid/details' })).toBeVisible();
  await page.getByRole('button', { name: 'Test Connection' }).click();
  await expect(page.getByText('withings marker', { exact: true })).toBeVisible();
  oldRead.resolve();
  await expect(page.getByRole('link', { name: 'https://withings.invalid/details' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'https://alpha.invalid/details' })).toHaveCount(0);

  await changeRoute(page, '/admin/system/integrations/alpha');
  await page.getByRole('button', { name: 'Test Connection' }).click();
  await testStarted.promise;
  await changeRoute(page, '/admin/system/integrations/withings');
  await expect(page.getByRole('link', { name: 'https://withings.invalid/details' })).toBeVisible();
  await page.getByRole('button', { name: 'Test Connection' }).click();
  await expect(page.getByText('withings marker', { exact: true })).toBeVisible();
  oldTest.resolve();
  await expect(page.getByText('alpha marker')).toHaveCount(0);
});

for (const change of ['member', 'date']) {
  test('Agent Dashboard keeps briefing and delete target with selected ' + change, async ({ page }) => {
    const oldRead = deferred();
    const started = deferred();
    const releaseDelete = deferred();
    const writes = [];
    let firstPath;
    await page.routeWebSocket('**/*', () => {});
    await page.route('**/api/**', async route => {
      const request = route.request();
      const path = new URL(request.url()).pathname;
      if (path === '/api/v1/admin/household') {
        return route.fulfill({ json: { members: [
          { username: 'alice', display_name: 'Alice' },
          { username: 'bob', display_name: 'Bob' },
        ] } });
      }
      if (path.includes('/health-dashboard/')) {
        if (request.method() === 'DELETE') {
          writes.push(path);
          await releaseDelete.promise;
          return route.fulfill({ json: { ok: true } });
        }
        if (!firstPath) {
          firstPath = path;
          started.resolve();
          await oldRead.promise;
        }
        return route.fulfill({ json: { dashboard: { coach: { briefing: 'Briefing ' + path } } } });
      }
      return route.fulfill({ json: path.endsWith('/supervision/bootstrap') ? { enabled: false } : {} });
    });

    await page.goto('/admin/agents/health-coach#dashboards');
    await started.promise;
    if (change === 'member') {
      await page.getByPlaceholder('Select user').click();
      await page.getByRole('option', { name: 'Bob' }).click();
    } else {
      await page.getByLabel('Dashboard date').fill('2026-10-01');
    }
    const selectedPath = change === 'member'
      ? firstPath.replace('/alice/', '/bob/')
      : firstPath.replace(/[^/]+$/, '2026-10-01');
    await expect(page.getByText('Briefing ' + selectedPath, { exact: true })).toBeVisible();
    oldRead.resolve();
    await page.waitForTimeout(100);
    await expect(page.getByText('Briefing ' + selectedPath, { exact: true })).toBeVisible();
    await expect(page.getByText('Briefing ' + firstPath, { exact: true })).toHaveCount(0);

    await page.getByRole('button', { name: 'Delete', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toContainText(change === 'member' ? 'bob' : '2026-10-01');
    const remove = dialog.getByRole('button', { name: 'Delete', exact: true });
    await remove.press('Enter');
    try {
      await expect.poll(() => writes).toEqual([selectedPath]);
      await expect(remove).toBeFocused();
      await expect(remove).toHaveAttribute('aria-busy', 'true');
      await page.keyboard.press('Enter');
      await page.keyboard.press('Escape');
      await expect(dialog).toBeVisible();
    } finally {
      releaseDelete.resolve();
    }
    await expect(dialog).toBeHidden();
    expect(writes).toEqual([selectedPath]);
  });
}
