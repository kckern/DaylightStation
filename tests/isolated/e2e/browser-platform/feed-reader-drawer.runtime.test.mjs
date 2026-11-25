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
});

test('Reader unlocks the inbox when its open subscriptions drawer becomes a rail', async ({ page }) => {
  await page.goto('/feed/reader');
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

  // Subscription filters only apply to the inbox, so Offline has no opener (f979c2aae0).
  await expect(opener).toHaveCount(0);
  await expect(rail).toHaveCount(0);
  await page.getByRole('group', { name: 'Article state' }).getByRole('button', { name: 'all', exact: true }).click();
  await expect(opener).toHaveAttribute('aria-expanded', 'false');
  await opener.focus();
  await page.keyboard.press('Enter');
  await expect(dialog).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(opener).toBeFocused();
});

test('Reader excludes the closed compact subscriptions rail from keyboard navigation', async ({ page }) => {
  await page.goto('/feed/reader');
  const sidebar = page.locator('#reader-subscriptions');
  const opener = page.getByRole('button', { name: 'Open subscriptions' });
  await opener.focus();
  await page.keyboard.press('Shift+Tab');
  await expect(sidebar.locator(':focus')).toHaveCount(0);
  await expect(sidebar).toHaveAttribute('inert', '');
});

test('Reader transfers focus only when narrowing hides the focused subscriptions rail', async ({ page }) => {
  await page.goto('/feed/reader');
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

for (const compact of [true, false]) {
  test(`Reader keeps keyboard focus through subscriptions Retry in its ${compact ? 'drawer' : 'docked rail'}`, async ({ page }) => {
    const released = Promise.withResolvers();
    const pending = Promise.withResolvers();
    const methods = [];
    await page.route('**/api/v1/feed/reader/feeds', async route => {
      methods.push(route.request().method());
      if (methods.length === 1) return route.fulfill({ status: 409, json: { error: 'Refused' } });
      pending.resolve();
      await released.promise;
      return route.fulfill({ json: [{ id: 'fixture', title: 'Fixture Feed' }] });
    });

    try {
      if (!compact) await page.setViewportSize({ width: 1440, height: 850 });
      await page.goto(compact ? '/feed/reader' : '/feed/reader?feeds=fixture');
      const opener = page.getByRole('button', { name: 'Open subscriptions' });
      if (compact) await opener.press('Enter');
      const sidebar = page.getByRole(compact ? 'dialog' : 'complementary', { name: 'Subscriptions' });
      const inbox = page.getByRole('region', { name: 'Reader articles', includeHidden: true });
      const retry = sidebar.getByRole('button', { name: 'Retry', exact: true });
      await retry.press('Enter');
      await pending.promise;
      await expect(retry).toHaveCount(0);
      expect(await sidebar.evaluate(node => node.contains(document.activeElement))).toBe(true);
      const results = sidebar.getByRole('region', { name: 'Feed list' });
      await expect(results).toBeFocused();
      await expect(results).toHaveAttribute('aria-busy', 'true');

      const next = sidebar.getByRole('button', { name: compact ? 'Close subscriptions' : 'View All', exact: true });
      await page.keyboard.press('Tab');
      if (await sidebar.locator('.reader-sidebar:focus').count()) await page.keyboard.press('Tab');
      await expect(next).toBeFocused();
      released.resolve();
      const category = sidebar.getByRole('button', { name: 'Uncategorized', exact: true });
      await expect(category).toBeVisible();
      await expect(results).not.toHaveAttribute('aria-busy', 'true');
      await expect(next).toBeFocused();
      expect(methods).toEqual(['GET', 'GET']);

      if (compact) {
        await expect(inbox).toHaveAttribute('inert', '');
        await page.keyboard.press('Shift+Tab');
        await expect(category).toBeFocused();
        await page.keyboard.press('Tab');
        await expect(next).toBeFocused();
        await page.keyboard.press('Escape');
        await expect(opener).toBeFocused();
      } else {
        await expect(inbox).not.toHaveAttribute('inert', '');
        await category.focus();
        await page.keyboard.press('Tab');
        await expect(inbox.getByRole('button', { name: 'all', exact: true })).toBeFocused();
      }
    } finally {
      released.resolve();
    }
  });
}
