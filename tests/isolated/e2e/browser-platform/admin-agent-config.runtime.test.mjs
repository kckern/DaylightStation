import { expect, test } from '@playwright/test';

test.use({ serviceWorkers: 'block' });

test('Health Coach config saves only to the selected member after the previous read is cancelled', async ({ page }) => {
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
  await page.goto('/admin/agents/health-coach#config');
  await expect.poll(() => Boolean(pendingGoals)).toBe(true);
  await page.getByLabel('User:').click();
  await page.getByRole('option', { name: 'beta' }).click();
  const weight = page.getByLabel('Weight target (lbs)');
  await expect(weight).toHaveValue('175');
  await weight.fill('180');
  await expect.poll(() => pendingGoals.request().failure()).not.toBeNull();
  await expect(weight).toHaveValue('180');
  await page.getByRole('button', { name: 'Save Goals' }).click();
  const goalsWrite = {
    path: '/api/v1/admin/health-coach/members/beta/config/goals',
    data: { parsed: { weight: { target_lbs: 180 }, owner: 'beta' } },
  };
  await expect.poll(() => writes).toEqual([goalsWrite]);
  await page.getByLabel('Program ID').fill('updated beta');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  const programWrite = {
    path: '/api/v1/admin/health-coach/members/beta/config/program-state',
    data: { parsed: { program: { id: 'updated beta' }, owner: 'beta' } },
  };
  await expect.poll(() => writes).toEqual([goalsWrite, programWrite]);
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

test('Admin preserves a non-mapping Shopping section and opens it in the raw editor', async ({ page }) => {
  const writes = [];
  await page.routeWebSocket('**/*', () => {});
  await page.route('**/api/**', route => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path === '/api/v1/admin/config/files/household/harvest/config.yml' && request.method() === 'GET') {
      return route.fulfill({ json: { parsed: { shopping: 17 }, raw: 'shopping: 17\n' } });
    }
    if (request.method() === 'PUT') writes.push(path);
    return route.fulfill({ json: path.endsWith('/supervision/bootstrap') ? { enabled: false } : {} });
  });

  await page.goto('/admin/apps/shopping');
  await expect(page.getByText(/This file can't be displayed as a form/i)).toBeVisible();
  await expect(page.getByRole('switch', { name: 'Enabled' })).toHaveCount(0);
  await page.getByRole('link', { name: 'Open YAML editor' }).click();
  await expect(page).toHaveURL('/admin/system/config/household/harvest/config.yml');
  await expect(page.locator('.cm-content')).toContainText('shopping: 17');
  expect(writes).toEqual([]);
});

test('Admin allows a missing Shopping section to be configured', async ({ page }) => {
  const writes = [];
  await page.routeWebSocket('**/*', () => {});
  await page.route('**/api/**', route => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path === '/api/v1/admin/config/files/household/harvest/config.yml' && request.method() === 'GET') {
      return route.fulfill({ json: { parsed: {}, raw: '{}\n' } });
    }
    if (request.method() === 'PUT') writes.push(request.postDataJSON());
    return route.fulfill({ json: path.endsWith('/supervision/bootstrap') ? { enabled: false } : {} });
  });

  await page.goto('/admin/apps/shopping');
  await page.getByText('Enabled', { exact: true }).click();
  await page.getByTestId('config-save-button').click();
  await expect.poll(() => writes).toEqual([{ expectedRevision: null, parsed: { shopping: { enabled: true } } }]);
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

test('Config Files keeps a YAML draft through native Back and Forward and clears confirmed discard', async ({ page }) => {
  const writes = [];
  await page.routeWebSocket('**/*', () => {});
  await page.route('**/api/**', route => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path === '/api/v1/admin/config/files') {
      return route.fulfill({ json: { files: [
        { name: 'sample.yml', path: 'household/sample.yml', directory: 'household' },
      ] } });
    }
    if (path === '/api/v1/admin/config/files/household/sample.yml' && request.method() === 'GET') {
      return route.fulfill({ json: { parsed: { enabled: true }, raw: 'enabled: true\n' } });
    }
    if (request.method() === 'PUT') writes.push(path);
    return route.fulfill({ json: path.endsWith('/supervision/bootstrap') ? { enabled: false } : {} });
  });

  await page.goto('/admin/system/config');
  await page.getByRole('button', { name: /sample\.yml/ }).click();
  await expect(page).toHaveURL('/admin/system/config/household/sample.yml');
  const editor = page.locator('.cm-content');
  await expect(editor).toContainText('enabled: true');
  await editor.fill('enabled: false');

  await page.goBack();
  await expect(page).toHaveURL('/admin/system/config');
  await expect(page.getByRole('dialog', { name: 'Discard unsaved changes?' })).toHaveCount(0);
  await page.goForward();
  await expect(page).toHaveURL('/admin/system/config/household/sample.yml');
  await expect(editor).toContainText('enabled: false');
  await expect(page.getByText('Unsaved', { exact: true })).toBeVisible();
  expect(writes).toEqual([]);

  await page.getByRole('link', { name: 'Back to Config', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Discard unsaved changes?' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Discard', exact: true }).click();
  await expect(page).toHaveURL('/admin/system/config');
  await page.goBack();
  await expect(page).toHaveURL('/admin/system/config/household/sample.yml');
  await expect(editor).toContainText('enabled: true');
  await expect(page.getByText('Unsaved', { exact: true })).toHaveCount(0);
  expect(writes).toEqual([]);
});

test('Config Files drops a history draft when the server baseline changed while away', async ({ page }) => {
  let fileReads = 0;
  await page.routeWebSocket('**/*', () => {});
  await page.route('**/api/**', route => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path === '/api/v1/admin/config/files') {
      return route.fulfill({ json: { files: [
        { name: 'sample.yml', path: 'household/sample.yml', directory: 'household' },
      ] } });
    }
    if (path === '/api/v1/admin/config/files/household/sample.yml' && request.method() === 'GET') {
      fileReads += 1;
      return route.fulfill({ json: fileReads === 1
        ? { parsed: { enabled: true }, raw: 'enabled: true\n' }
        : { parsed: { enabled: false }, raw: 'enabled: false\n' } });
    }
    return route.fulfill({ json: path.endsWith('/supervision/bootstrap') ? { enabled: false } : {} });
  });

  await page.goto('/admin/system/config');
  await page.getByRole('button', { name: /sample\.yml/ }).click();
  const editor = page.locator('.cm-content');
  await expect(editor).toContainText('enabled: true');
  await editor.fill('enabled: local draft');

  await page.goBack();
  await expect(page).toHaveURL('/admin/system/config');
  await page.goForward();
  await expect(page).toHaveURL('/admin/system/config/household/sample.yml');
  await expect.poll(() => fileReads).toBe(2);
  await expect(editor).toContainText('enabled: false');
  await expect(page.getByText('Unsaved', { exact: true })).toHaveCount(0);
});

test('Finance ClickUp IDs reject lossy input and preserve existing IDs on save', async ({ page }) => {
  const writes = [];
  await page.routeWebSocket('**/*', () => {});
  await page.route('**/api/**', route => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path === '/api/v1/admin/config/files/household/finance/config.yml' && request.method() === 'GET') {
      return route.fulfill({ json: { parsed: { clickup: {
        assignees: [7, '9007199254740993'],
        todo_lists: [13, '9007199254740995'],
      } }, raw: 'clickup: {}\n' } });
    }
    if (request.method() === 'PUT') writes.push(request.postDataJSON());
    return route.fulfill({ json: path.endsWith('/supervision/bootstrap') ? { enabled: false } : {} });
  });

  await page.goto('/admin/apps/finance');
  const save = page.getByTestId('config-save-button');
  let hasAcceptedEdit = false;
  for (const [placeholder, rejectedId, acceptedId] of [
    ['Add assignee ID...', 'abc', '42'],
    ['Add list ID...', '9007199254740997', '84'],
  ]) {
    const input = page.getByPlaceholder(placeholder);
    await input.fill(rejectedId);
    await input.press('Enter');
    await expect(page.getByText('Enter a whole-number ID within the safe integer range.')).toBeVisible();
    if (!hasAcceptedEdit) await expect(save).toBeDisabled();
    await input.fill(acceptedId);
    await input.press('Enter');
    await expect(page.getByText('Enter a whole-number ID within the safe integer range.')).toHaveCount(0);
    hasAcceptedEdit = true;
  }

  await expect(save).toBeEnabled();
  await save.click();
  await expect.poll(() => writes).toEqual([{
    expectedRevision: null,
    parsed: { clickup: {
      assignees: [7, '9007199254740993', 42],
      todo_lists: [13, '9007199254740995', 84],
    } },
  }]);
});
