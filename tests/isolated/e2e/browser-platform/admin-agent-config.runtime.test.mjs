import { expect, test } from '@playwright/test';

test.use({ serviceWorkers: 'block' });

test('agent settings save the selected member’s goals after the previous read resolves', async ({ page }) => {
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
  const delivered = page.waitForResponse(res => res.request() === pendingGoals.request());
  await pendingGoals.fulfill({ json: { parsed: { weight: { target_lbs: 150 }, owner: 'alpha' } } });
  await (await delivered).finished();
  await page.evaluate(() => new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done))));
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
