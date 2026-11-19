import { expect, test } from '@playwright/test';

test.use({ serviceWorkers: 'block' });

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 850 });
  await page.routeWebSocket('**/*', () => {});
  await page.route('**/api/**', route => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/reader/feeds')) return route.fulfill({ json: [{ id: 'fixture', title: 'Fixture Feed' }] });
    if (path.endsWith('/reader/stream')) return route.fulfill({ json: { items: [], continuation: null } });
    if (path.endsWith('/supervision/bootstrap')) return route.fulfill({ json: { enabled: false } });
    return route.fulfill({ json: {} });
  });
  await page.goto('/feed/reader');
});

test('Reader unlocks the inbox when its open subscriptions drawer becomes a rail', async ({ page }) => {
  const opener = page.getByRole('button', { name: 'Open subscriptions' });
  await opener.focus();
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog', { name: 'Subscriptions' });
  await expect(dialog).toBeFocused();
  await dialog.getByRole('button', { name: 'Close subscriptions' }).focus();

  await page.setViewportSize({ width: 767, height: 850 });
  await expect(dialog).toBeVisible();
  await page.setViewportSize({ width: 768, height: 850 });

  await expect(dialog).toHaveCount(0);
  const rail = page.getByRole('complementary', { name: 'Subscriptions' });
  await expect(rail).toBeFocused();
  await page.setViewportSize({ width: 1440, height: 850 });
  const offline = page.getByRole('group', { name: 'Article state' }).getByRole('button', { name: 'Offline' });
  await offline.click();
  await expect(offline).toHaveAttribute('aria-pressed', 'true');
  await expect(page).toHaveURL(/\/feed\/reader\?view=offline$/);

  await page.setViewportSize({ width: 390, height: 850 });

  await expect(opener).toHaveAttribute('aria-expanded', 'false');
  await opener.focus();
  await page.keyboard.press('Enter');
  await expect(dialog).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(opener).toBeFocused();
  await expect(page).toHaveURL(/\/feed\/reader\?view=offline$/);
});

test('Reader excludes the closed compact subscriptions rail from keyboard navigation', async ({ page }) => {
  const sidebar = page.locator('#reader-subscriptions');
  const opener = page.getByRole('button', { name: 'Open subscriptions' });
  await opener.focus();
  await page.keyboard.press('Shift+Tab');
  await expect(sidebar.locator(':focus')).toHaveCount(0);
  await expect(sidebar).toHaveAttribute('inert', '');
});

test('Reader transfers focus only when narrowing hides the focused subscriptions rail', async ({ page }) => {
  const rail = page.getByRole('complementary', { name: 'Subscriptions' });
  const opener = page.getByRole('button', { name: 'Open subscriptions' });
  const inboxControl = page.getByRole('group', { name: 'Article state' }).getByRole('button', { name: 'all', exact: true });
  await page.setViewportSize({ width: 1440, height: 850 });
  const railControl = rail.getByRole('button', { name: 'Uncategorized', exact: true });
  await railControl.focus();
  await expect(railControl).toBeFocused();

  await page.setViewportSize({ width: 390, height: 850 });
  await expect(opener).toBeFocused();
  await expect(opener).toHaveAttribute('aria-expanded', 'false');

  await page.setViewportSize({ width: 1440, height: 850 });
  await expect(rail).not.toHaveAttribute('inert', '');
  await inboxControl.focus();
  await expect(inboxControl).toBeFocused();
  await page.setViewportSize({ width: 390, height: 850 });

  await expect(page.locator('#reader-subscriptions')).toHaveAttribute('inert', '');
  await expect(inboxControl).toBeFocused();
});
