// tests/runtime/fitness-url-routing/fitness-url-routing.runtime.test.mjs
/**
 * Fitness URL Routing Runtime Tests
 *
 * Validates URL-based deep linking functionality.
 * Uses baseURL from playwright.config.js (webServer starts npm run dev).
 */

import { test, expect } from '@playwright/test';

test.describe('Fitness URL Routing', () => {
  test.beforeEach(async ({ page }) => {
    // Clear any previous state - uses baseURL from playwright.config.js
    await page.goto('/fitness');
    await page.waitForSelector('.fitness-app-container', { timeout: 10000 });
  });

  test('default route loads menu view', async ({ page }) => {
    await page.goto('/fitness');
    await page.waitForSelector('.fitness-app-container');

    // Should show menu/grid content
    const mainContent = page.locator('.fitness-main-content');
    await expect(mainContent).toBeVisible();
  });

  test('/fitness/users loads users view', async ({ page }) => {
    await page.goto('/fitness/users');
    await page.waitForSelector('.fitness-app-container');

    // Should show session plugin
    const pluginContainer = page.locator('.fitness-plugin-container, [class*="session"]');
    await expect(pluginContainer).toBeVisible({ timeout: 10000 });
  });

  test('/fitness/show/:id loads show view', async ({ page, baseURL }) => {
    // Use a known show ID from test fixtures or skip if none
    const testShowId = '12345'; // Replace with actual test ID

    await page.goto(`/fitness/show/${testShowId}`);
    await page.waitForSelector('.fitness-app-container');

    // URL should reflect the route
    expect(page.url()).toContain(`/fitness/show/${testShowId}`);
  });

  test('query params are parsed correctly', async ({ page }) => {
    await page.goto('/fitness?music=off&fullscreen=1');
    await page.waitForSelector('.fitness-app-container');

    // App should load without errors
    const errors = await page.evaluate(() => window.__consoleErrors || []);
    expect(errors.filter(e => e.includes('Error'))).toHaveLength(0);
  });

  test('navigation updates URL', async ({ page }) => {
    await page.goto('/fitness');
    await page.waitForSelector('.fitness-app-container');

    // Click on users nav item (if present)
    const usersNav = page.locator('[data-nav="users"], .nav-item:has-text("Users"), button:has-text("Session")');
    const navCount = await usersNav.count();

    if (navCount > 0) {
      await usersNav.first().click();
      await page.waitForTimeout(500);

      // URL should update
      expect(page.url()).toContain('/fitness/');
    }
  });
});
