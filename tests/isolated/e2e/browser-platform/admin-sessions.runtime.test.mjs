import { expect, test } from '@playwright/test';

test.use({ serviceWorkers: 'block' });

test('a confirmed session revoke updates the reopened roster and preserves the current device', async ({ page }) => {
  const current = { id: 'desktop', username: 'Amy', current: true, userAgent: 'Linux Firefox/1' };
  const phone = { id: 'phone', username: 'Amy', userAgent: 'iPhone Safari/1' };
  let sessions = [current, phone];
  const deletes = [];
  const release = Promise.withResolvers();
  await page.routeWebSocket('**/*', () => {});
  await page.route('**/api/**', async route => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (request.method() === 'GET' && path === '/api/v1/auth/sessions') {
      return route.fulfill({ json: { revocable: true, sessions } });
    }
    if (request.method() === 'DELETE' && path.startsWith('/api/v1/auth/sessions/')) {
      deletes.push(path);
      await release.promise;
      sessions = [current];
      return route.fulfill({ json: { revoked: true } });
    }
    return route.fulfill({ json: path.endsWith('/supervision/bootstrap') ? { enabled: false } : {} });
  });
  const phoneRow = page.getByRole('row').filter({ hasText: 'iPhone' });
  try {
    await page.goto('/admin/household/sessions');
    await phoneRow.getByRole('button', { name: 'Sign out', exact: true }).click();
    await expect.poll(() => deletes).toEqual(['/api/v1/auth/sessions/phone']);
    await page.getByRole('link', { name: 'Devices', exact: true }).click();
    await expect(page).toHaveURL(/\/admin\/household\/devices$/);
    await page.goBack();
    await expect(page).toHaveURL(/\/admin\/household\/sessions$/);
    await expect(phoneRow).toBeVisible();
  } finally {
    release.resolve();
  }
  await expect(phoneRow).toHaveCount(0);
  await expect(page.getByRole('row').filter({ hasText: 'this device' }).getByRole('button', { name: 'Sign out here' })).toBeVisible();
  await expect(page.getByText('Signed out iPhone · Safari.')).toHaveCount(0);
  expect(deletes).toEqual(['/api/v1/auth/sessions/phone']);
});
