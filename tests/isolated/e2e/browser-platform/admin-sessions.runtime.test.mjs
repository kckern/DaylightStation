import { expect, test } from '@playwright/test';

test.use({ serviceWorkers: 'block' });

test('a pending revoke remains exclusive after reopening Sessions and refreshes the roster when confirmed', async ({ page, baseURL }) => {
  const current = { id: 'desktop', username: 'Amy', current: true, userAgent: 'Linux Firefox/1' };
  const phone = { id: 'phone', username: 'Amy', userAgent: 'iPhone Safari/1' };
  let sessions = [current, phone];
  const deletes = [];
  const release = Promise.withResolvers();
  await page.context().route('**/*', route => (
    new URL(route.request().url()).origin === new URL(baseURL).origin ? route.fallback() : route.abort()
  ));
  await page.routeWebSocket('**/*', () => {});
  await page.route('**/api/**', async route => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (request.method() === 'GET' && path === '/api/v1/auth/sessions') {
      return route.fulfill({ json: { revocable: true, sessions } });
    }
    if (request.method() === 'DELETE' && path.startsWith('/api/v1/auth/sessions/')) {
      deletes.push(path);
      const firstRequest = deletes.length === 1;
      await release.promise;
      if (!firstRequest) return route.fulfill({ status: 404, json: { error: 'No such session' } });
      sessions = [current];
      return route.fulfill({ json: { revoked: true, id: phone.id } });
    }
    return route.fulfill({ json: path.endsWith('/supervision/bootstrap') ? { enabled: false } : {} });
  });
  const phoneRow = page.getByRole('row').filter({ hasText: 'iPhone' });
  const signOut = phoneRow.getByRole('button', { name: 'Sign out', exact: true });
  try {
    await page.goto('/admin/household/sessions');
    await signOut.click();
    await expect.poll(() => deletes).toEqual(['/api/v1/auth/sessions/phone']);
    await page.getByRole('link', { name: 'Devices', exact: true }).click();
    await expect(page).toHaveURL(/\/admin\/household\/devices$/);
    await page.goBack();
    await expect(page).toHaveURL(/\/admin\/household\/sessions$/);
    await expect(phoneRow).toBeVisible();
    const bulk = page.getByRole('button', { name: 'Sign out 1 other', exact: true });
    await expect(signOut).toBeDisabled();
    await expect(bulk).toBeDisabled();
    // Bypass Playwright's enabled check to exercise a real pointer on both controls.
    for (const control of [signOut, bulk]) {
      const { x, y, width, height } = await control.boundingBox();
      await page.mouse.click(x + width / 2, y + height / 2);
    }
  } finally {
    release.resolve();
  }
  await expect(phoneRow).toHaveCount(0);
  await expect(page.getByRole('row').filter({ hasText: 'this device' }).getByRole('button', { name: 'Sign out here' })).toBeVisible();
  await expect(page.getByText('Signed out iPhone · Safari.')).toHaveCount(0);
  await expect(page.getByText(/No such session/)).toHaveCount(0);
  expect(deletes).toEqual(['/api/v1/auth/sessions/phone']);
});
