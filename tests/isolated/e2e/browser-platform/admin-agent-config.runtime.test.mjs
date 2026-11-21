import { expect, test } from '@playwright/test';

test.use({ serviceWorkers: 'block' });

test('agent settings save the selected member’s goals after the previous read is cancelled', async ({ page }) => {
  let pendingGoals;
  const writes = [];
  await page.routeWebSocket('**/*', () => {});
  await page.route('**/api/**', route => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path === '/api/v1/admin/household') {
      return route.fulfill({ json: { members: [{ username: 'alpha' }, { username: 'beta' }] } });
    }
    if (request.method() === 'PUT') {
      writes.push({ path, data: request.postDataJSON() });
      return route.fulfill({ json: {} });
    }
    if (path.endsWith('/program-state')) {
      const owner = path.includes('/beta/') ? 'beta' : 'alpha';
      return route.fulfill({ json: { parsed: { program: { id: owner }, owner } } });
    }
    if (path.endsWith('/goals')) {
      if (path.includes('/alpha/')) {
        pendingGoals = route;
        return;
      }
      return route.fulfill({ json: { parsed: { weight: { target_lbs: 175 }, owner: 'beta' } } });
    }
    return route.fulfill({ json: path.endsWith('/supervision/bootstrap') ? { enabled: false } : {} });
  });
  await page.goto('/admin/agents/fixture#config');
  await expect.poll(() => Boolean(pendingGoals)).toBe(true);
  await page.getByPlaceholder('Select user').click();
  await page.getByRole('option', { name: 'beta' }).click();
  const weight = page.getByLabel('Weight target (lbs)');
  await expect(weight).toHaveValue('175');
  await weight.fill('180');
  await expect.poll(() => pendingGoals.request().failure()).not.toBeNull();
  await expect(weight).toHaveValue('180');
  await page.getByRole('button', { name: 'Save Goals' }).click();
  await expect.poll(() => writes).toEqual([{
    path: '/api/v1/admin/config/files/users/beta/agents/fixture/goals',
    data: { parsed: { weight: { target_lbs: 180 }, owner: 'beta' } },
  }]);
  await page.getByLabel('Program ID').fill('updated beta');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect.poll(() => writes[1]).toEqual({
    path: '/api/v1/admin/config/files/users/beta/agents/fixture/program-state',
    data: { parsed: { program: { id: 'updated beta' }, owner: 'beta' } },
  });
});

test('the config directory groups files and opens the chosen editable path', async ({ page }) => {
  await page.routeWebSocket('**/*', () => {});
  await page.route('**/api/**', route => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/v1/admin/config/files') {
      return route.fulfill({ json: { files: [
        { name: 'hidden.yml', path: 'system/hidden.yml', directory: 'system', masked: true },
        { name: 'sample.yml', path: 'household/sample.yml', directory: 'household' },
      ] } });
    }
    return route.fulfill({ json: path.endsWith('/supervision/bootstrap') ? { enabled: false } : {} });
  });
  await page.goto('/admin/system/config');
  const main = page.getByRole('main');
  await expect(main).toContainText(/household.*sample\.yml.*system.*hidden\.yml.*Protected/s);
  await expect(main.getByRole('button', { name: /hidden\.yml/ })).toHaveCount(0);
  await main.getByRole('button', { name: /sample\.yml/ }).click();
  await expect(page).toHaveURL(/\/admin\/system\/config\/household\/sample\.yml$/);
});

test('the config directory retries a failed read and keeps focus through recovery', async ({ page }) => {
  const reads = [];
  let retryRead;
  await page.routeWebSocket('**/*', () => {});
  await page.route('**/api/**', route => {
    const { pathname } = new URL(route.request().url());
    if (pathname === '/api/v1/admin/config/files') {
      reads.push(route.request().method());
      if (reads.length === 1) return route.fulfill({ status: 500, json: { message: 'Directory unavailable' } });
      retryRead = route;
      return;
    }
    return route.fulfill({ json: pathname.endsWith('/supervision/bootstrap') ? { enabled: false } : {} });
  });

  await page.goto('/admin/system/config');
  await expect(page.getByRole('alert')).toContainText('Config files failed to load');
  const retry = page.getByRole('button', { name: 'Retry', exact: true });
  await expect(retry).toBeVisible();
  await retry.press('Enter');

  const region = page.getByRole('region', { name: 'Config files', exact: true });
  await expect.poll(() => reads).toEqual(['GET', 'GET']);
  await expect(region).toBeFocused();
  await expect(region).toHaveAttribute('aria-busy', 'true');
  await retryRead.fulfill({ json: { files: [
    { name: 'sample.yml', path: 'household/sample.yml', directory: 'household' },
  ] } });
  await expect(region.getByRole('button', { name: /sample\.yml/ })).toBeVisible();
  await expect(region).toBeFocused();
  await expect(region).not.toHaveAttribute('aria-busy', 'true');
});

test('the config editor retains focus in its region while Retry replaces the failed-read alert', async ({ page }) => {
  const reads = [];
  let retryRead;
  await page.routeWebSocket('**/*', () => {});
  await page.route('**/api/**', route => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path === '/api/v1/admin/config/files/household/sample.yml' && request.method() === 'GET') {
      reads.push(request.method());
      if (reads.length === 1) return route.fulfill({ status: 500, json: { message: 'File unavailable' } });
      retryRead = route;
      return;
    }
    return route.fulfill({ json: path.endsWith('/supervision/bootstrap') ? { enabled: false } : {} });
  });

  await page.goto('/admin/system/config/household/sample.yml');
  await expect(page.getByRole('alert')).toBeVisible();
  const retry = page.getByRole('button', { name: 'Retry', exact: true });
  await retry.press('Enter');

  const region = page.getByRole('region', { name: 'sample.yml editor', exact: true });
  await expect.poll(() => reads).toEqual(['GET', 'GET']);
  await expect(region).toBeFocused();
  await expect(region).toHaveAttribute('aria-busy', 'true');
  await retryRead.fulfill({ json: { parsed: { enabled: true }, raw: 'enabled: true\n' } });
  await expect(page.locator('.cm-content')).toContainText('enabled: true');
  await expect(region).toBeFocused();
  await expect(region).not.toHaveAttribute('aria-busy', 'true');
});

test('Admin opens the raw editor when a loaded app config has no structured value', async ({ page }) => {
  const reads = [];
  await page.routeWebSocket('**/*', () => {});
  await page.route('**/api/**', route => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path === '/api/v1/admin/config/files/household/gratitude/config.yml' && request.method() === 'GET') {
      reads.push(path);
      return route.fulfill({ json: { parsed: null, raw: 'categories: [\n' } });
    }
    return route.fulfill({ json: path.endsWith('/supervision/bootstrap') ? { enabled: false } : {} });
  });

  await page.goto('/admin/apps/gratitude');
  await expect(page.getByText(/This file can't be displayed as a form/i)).toBeVisible();
  const rawEditor = page.getByRole('link', { name: 'Open YAML editor' });
  await expect(rawEditor).toHaveAttribute('href', '/admin/system/config/household/gratitude/config.yml');
  await rawEditor.click();
  await expect(page).toHaveURL('/admin/system/config/household/gratitude/config.yml');
  await expect(page.locator('.cm-content')).toContainText('categories: [');
  expect(reads).toEqual([
    '/api/v1/admin/config/files/household/gratitude/config.yml',
    '/api/v1/admin/config/files/household/gratitude/config.yml',
  ]);
});

test('Admin keeps a valid YAML scalar out of the Shopping structured editor', async ({ page }) => {
  const writes = [];
  await page.routeWebSocket('**/*', () => {});
  await page.route('**/api/**', route => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path === '/api/v1/admin/config/files/household/harvest/config.yml' && request.method() === 'GET') {
      return route.fulfill({ json: { parsed: false, raw: 'false\n' } });
    }
    if (request.method() === 'PUT') writes.push(path);
    return route.fulfill({ json: path.endsWith('/supervision/bootstrap') ? { enabled: false } : {} });
  });

  await page.goto('/admin/apps/shopping');
  await expect(page.getByText(/This file can't be displayed as a form/i)).toBeVisible();
  await expect(page.getByRole('switch', { name: 'Enabled' })).toHaveCount(0);
  await page.getByRole('link', { name: 'Open YAML editor' }).click();
  await expect(page).toHaveURL('/admin/system/config/household/harvest/config.yml');
  await expect(page.locator('.cm-content')).toContainText('false');
  expect(writes).toEqual([]);
});

test('config Back preserves a dirty YAML draft until discard is confirmed', async ({ page }) => {
  const writes = [];
  await page.routeWebSocket('**/*', () => {});
  await page.route('**/api/**', route => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path === '/api/v1/admin/config/files/household/sample.yml' && request.method() === 'GET') {
      return route.fulfill({ json: { parsed: { enabled: true }, raw: 'enabled: true\n' } });
    }
    if (request.method() === 'PUT') writes.push(path);
    return route.fulfill({ json: path.endsWith('/supervision/bootstrap') ? { enabled: false } : {} });
  });

  await page.goto('/admin/system/config/household/sample.yml');
  const editor = page.locator('.cm-content');
  await expect(editor).toContainText('enabled: true');
  await editor.fill('enabled: false');
  const back = page.getByRole('link', { name: 'Back to Config', exact: true });
  await expect(back).toHaveAttribute('href', '/admin/system/config');
  await back.press('Enter');

  const dialog = page.getByRole('dialog', { name: 'Discard unsaved changes?' });
  await expect(dialog).toBeVisible();
  await expect(editor).toContainText('enabled: false');
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(back).toBeFocused();
  await expect(editor).toContainText('enabled: false');
  expect(writes).toEqual([]);

  await back.press('Enter');
  await page.getByRole('button', { name: 'Discard', exact: true }).click();
  await expect(page).toHaveURL('/admin/system/config');
  expect(writes).toEqual([]);
});
