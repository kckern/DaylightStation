import { expect, test } from '@playwright/test';

test.use({ serviceWorkers: 'block' });

test('Admin wraps keyboard focus through the compact navigation and its header', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 850 });
  await page.routeWebSocket('**/*', () => {});
  await page.route('**/api/**', route => {
    const { pathname } = new URL(route.request().url());
    if (pathname.endsWith('/supervision/bootstrap')) return route.fulfill({ json: { enabled: false } });
    if (pathname.endsWith('/admin/notifications')) {
      return route.fulfill({ json: { quiet_hours: { enabled: false, start: '21:00', end: '07:00' }, cooldowns: {} } });
    }
    return route.fulfill({ json: {} });
  });
  await page.goto('/admin/system/config');

  const toggle = page.getByRole('button', { name: 'Toggle admin navigation' });
  const nav = page.getByRole('navigation', { name: 'Primary' });
  const notifications = nav.getByRole('link', { name: 'Notifications', exact: true });
  await toggle.press('Enter');
  await expect(nav.getByRole('link', { name: 'Config', exact: true })).toBeFocused();
  await expect(page.getByRole('main')).toBeHidden();

  await notifications.focus();
  await page.keyboard.press('Tab');
  await expect(toggle).toBeFocused();
  const focusedBreadcrumbs = page.locator('.admin-breadcrumbs:focus');
  await page.keyboard.press('Tab');
  if (await focusedBreadcrumbs.count()) await page.keyboard.press('Tab');
  await expect(page.getByRole('banner').getByRole('link', { name: 'Admin', exact: true })).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  if (await focusedBreadcrumbs.count()) await page.keyboard.press('Shift+Tab');
  await expect(toggle).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(notifications).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/admin\/system\/notifications$/);
  await expect(nav).toBeHidden();
  await expect(page.locator('.admin-content')).toBeFocused();
});

test('Admin transfers focus from the desktop rail when compact navigation replaces it', async ({ page }) => {
  await page.setViewportSize({ width: 768, height: 850 });
  await page.routeWebSocket('**/*', () => {});
  await page.route('**/api/**', route => {
    const { pathname } = new URL(route.request().url());
    if (pathname.endsWith('/supervision/bootstrap')) return route.fulfill({ json: { enabled: false } });
    if (pathname.endsWith('/admin/notifications')) {
      return route.fulfill({ json: { quiet_hours: { enabled: false, start: '21:00', end: '07:00' }, cooldowns: {} } });
    }
    return route.fulfill({ json: {} });
  });
  await page.goto('/admin/content/lists/menus');

  const notifications = page.getByRole('navigation', { name: 'Primary' })
    .getByRole('link', { name: 'Notifications', exact: true });
  await notifications.focus();
  await expect(notifications).toBeFocused();
  await page.setViewportSize({ width: 767, height: 850 });

  await expect(page.getByRole('button', { name: 'Toggle admin navigation' })).toBeFocused();
});

test('Escape cancels the discard dialog before closing compact navigation', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 850 });
  const writes = [];
  await page.routeWebSocket('**/*', () => {});
  await page.route('**/api/**', route => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (request.method() === 'PUT') writes.push(path);
    if (path === '/api/v1/admin/household/members/alice') {
      return route.fulfill({ json: { member: { username: 'alice', display_name: 'Alice', email: 'alice@example.invalid', type: 'family_member' } } });
    }
    return route.fulfill({ json: path.endsWith('/supervision/bootstrap') ? { enabled: false } : {} });
  });
  await page.goto('/admin/household/members/alice');
  await page.getByLabel('Display Name', { exact: true }).fill('Alice draft');

  const toggle = page.getByRole('button', { name: 'Toggle admin navigation' });
  const nav = page.getByRole('navigation', { name: 'Primary' });
  const members = nav.getByRole('link', { name: 'Members', exact: true });
  await toggle.press('Enter');
  await expect(members).toBeFocused();
  await members.press('Enter');
  const dialog = page.getByRole('dialog', { name: 'Discard unsaved changes?' });
  await expect(dialog).toBeVisible();

  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(nav).toBeVisible();
  await expect(members).toBeFocused();
  await expect(page.getByLabel('Display Name', { exact: true })).toHaveValue('Alice draft');
  expect(writes).toEqual([]);

  await page.keyboard.press('Escape');
  await expect(nav).toBeHidden();
  await expect(toggle).toBeFocused();

  await toggle.press('Enter');
  await members.press('Enter');
  await expect(dialog).toBeVisible();
  await page.setViewportSize({ width: 1440, height: 850 });
  await expect(nav).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(page).toHaveURL('/admin/household/members/alice');
  await expect(page.getByLabel('Display Name', { exact: true })).toHaveValue('Alice draft');
  expect(writes).toEqual([]);
});
