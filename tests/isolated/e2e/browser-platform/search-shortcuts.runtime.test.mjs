import { expect, test } from '@playwright/test';

test.use({ serviceWorkers: 'block' });

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('media-app.first-use-done', 'done'));
  await page.routeWebSocket('**/*', () => {});
  await page.route('**/api/**', route => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/reader/feeds')) return route.fulfill({ json: [] });
    if (path.endsWith('/reader/stream')) return route.fulfill({ json: { items: [], continuation: null } });
    return route.fulfill({ json: path.endsWith('/supervision/bootstrap') ? { enabled: false } : {} });
  });
});

test('Feed leaves an active dialog alone, types a slash in search and adds one history entry', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 850 });
  await page.goto('/feed/reader');
  const subscriptions = page.getByRole('button', { name: 'Open subscriptions' });
  await subscriptions.click();
  const dialog = page.getByRole('dialog', { name: 'Subscriptions' });
  await expect(dialog).toBeFocused();
  await page.keyboard.press('/');
  await expect(dialog).toBeFocused();
  await expect(page).toHaveURL(/\/feed\/reader$/);
  await page.keyboard.press('Escape');
  await expect(subscriptions).toBeFocused();

  await page.keyboard.press('/');
  const search = page.getByRole('textbox', { name: 'Search feed history' });
  await expect(page).toHaveURL(/\/feed\/search$/);
  await expect(search).toBeFocused();
  await page.keyboard.press('/');
  await expect(search).toHaveValue('/');
  await page.getByRole('main', { name: 'Feed' }).focus();
  await page.keyboard.press('/');
  await page.goBack();
  await expect(page).toHaveURL(/\/feed\/reader$/);
});

for (const width of [390, 1440]) {
  test(`Media opens the search control for ${width}px and types a slash into it`, async ({ page }) => {
    await page.setViewportSize({ width, height: 850 });
    await page.goto('/media');
    await expect(page.getByTestId('media-dock')).toBeVisible();
    const mobile = width === 390;
    const search = mobile
      ? page.getByRole('searchbox', { name: 'Search media', exact: true })
      : page.getByRole('textbox', { name: 'Search media…', exact: true });
    await page.keyboard.press('/');
    await expect(search).toBeFocused();
    await page.keyboard.press('/');
    await expect(search).toHaveValue('/');
  });
}

test('Media search does not steal focus from a confirmation dialog', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 850 });
  await page.goto('/media');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByTestId('settings-reset-session').click();
  const dialog = page.getByRole('dialog', { name: 'Start fresh on this device?' });
  const cancel = dialog.getByRole('button', { name: 'Cancel', exact: true });
  await cancel.focus();
  await page.keyboard.press('/');
  await expect(cancel).toBeFocused();
});
