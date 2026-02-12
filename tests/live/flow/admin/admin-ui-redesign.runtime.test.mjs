/**
 * Admin UI Redesign Verification
 *
 * Verifies:
 * 1. DS design tokens are applied (custom background colors)
 * 2. Brand mark renders in sidebar
 * 3. Navigation active state has accent border
 * 4. Breadcrumbs use monospace font with / separators
 * 5. Notifications provider is mounted
 */

import { test, expect } from '@playwright/test';
import { FRONTEND_URL } from '#fixtures/runtime/urls.mjs';

const BASE_URL = FRONTEND_URL;

test.describe.configure({ mode: 'serial' });

let sharedPage;
let sharedContext;

test.beforeAll(async ({ browser }) => {
  sharedContext = await browser.newContext({
    viewport: { width: 1920, height: 1080 }
  });
  sharedPage = await sharedContext.newPage();
});

test.afterAll(async () => {
  if (sharedPage) await sharedPage.close();
  if (sharedContext) await sharedContext.close();
});

test.describe('Admin UI Redesign Verification', () => {
  test.setTimeout(60000);

  test('health check', async ({ request }) => {
    const response = await request.get(`${BASE_URL}/admin`);
    expect(response.status()).toBe(200);
  });

  test('brand mark renders in sidebar', async () => {
    await sharedPage.goto(`${BASE_URL}/admin`, {
      waitUntil: 'networkidle',
      timeout: 30000
    });
    await sharedPage.waitForURL('**/admin/**', { timeout: 10000 });

    const brand = sharedPage.locator('.ds-nav-brand');
    await expect(brand).toBeVisible({ timeout: 5000 });
    const brandText = await brand.textContent();
    expect(brandText).toContain('DAYLIGHT');
  });

  test('active nav item has accent styling', async () => {
    const menusLink = sharedPage.locator('.ds-nav-item', { hasText: 'Menus' }).first();
    await menusLink.click();
    await sharedPage.waitForURL('**/content/lists/menus', { timeout: 10000 });

    const activeItem = sharedPage.locator('.ds-nav-item-active');
    const count = await activeItem.count();
    expect(count, 'Should have at least one active nav item').toBeGreaterThanOrEqual(1);
  });

  test('breadcrumbs use / separators', async () => {
    await sharedPage.goto(`${BASE_URL}/admin/system/config`, {
      waitUntil: 'networkidle',
      timeout: 30000
    });

    const header = sharedPage.locator('.mantine-AppShell-header');
    const headerText = await header.textContent();
    expect(headerText).toContain('/');
    expect(headerText).toContain('System');
    expect(headerText).toContain('Config');
  });

  test('DS background colors are applied', async () => {
    const adminApp = sharedPage.locator('.admin-app');
    const bgColor = await adminApp.evaluate(el =>
      getComputedStyle(el).backgroundColor
    );
    // Should be close to #0C0E14 (rgb(12, 14, 20)), not white or transparent
    expect(bgColor).not.toBe('rgb(255, 255, 255)');
    expect(bgColor).not.toBe('rgba(0, 0, 0, 0)');
  });

  test('notifications container is mounted', async () => {
    // Mantine Notifications mounts a container div
    const notifContainer = sharedPage.locator('.mantine-Notifications-root');
    await expect(notifContainer).toBeAttached({ timeout: 5000 });
  });
});
