/**
 * Nav Wiring Test - Proves Home (screen) and Fitness Apps (module_menu) nav items work
 *
 * Verifies:
 * 1. Home nav item is clickable and loads the screen-framework dashboard
 * 2. Clicking a collection and then Home returns to the dashboard
 * 3. Fitness Apps nav item opens the module menu
 */

import { test, expect } from '@playwright/test';

const FITNESS_URL = 'http://localhost:3111/fitness';

test.describe('Fitness Nav Wiring', () => {

  test.beforeEach(async ({ page }) => {
    // Navigate and wait for navbar to load
    await page.goto(FITNESS_URL, { waitUntil: 'networkidle' });
    await page.waitForSelector('.navbar-nav .nav-item', { timeout: 15000 });
  });

  test('Home nav item exists and is clickable', async ({ page }) => {
    // Find the Home nav item (has nav-home class)
    const homeBtn = page.locator('.navbar-nav .nav-item.nav-home');
    await expect(homeBtn).toBeVisible();
    await expect(homeBtn).toBeEnabled();

    // Verify it has the right label
    const label = homeBtn.locator('.nav-label');
    await expect(label).toHaveText('Home');
  });

  test('Home nav item shows active state on load', async ({ page }) => {
    // On initial load, Home should auto-navigate and be active
    const homeBtn = page.locator('.navbar-nav .nav-item.nav-home');

    // Wait for auto-navigation to set the active class
    await expect(homeBtn).toHaveClass(/active/, { timeout: 10000 });
  });

  test('Home nav item loads screen-framework dashboard', async ({ page }) => {
    // The screen-framework renders via ScreenProvider/PanelRenderer
    // Wait for the screen-app container that wraps the dashboard
    const screenApp = page.locator('.screen-app');
    await expect(screenApp).toBeVisible({ timeout: 10000 });
  });

  test('clicking collection then Home returns to dashboard', async ({ page }) => {
    // Wait for Home screen to load first
    await expect(page.locator('.screen-app')).toBeVisible({ timeout: 10000 });

    // Click a collection nav item (not Home, not Fitness Apps)
    // Find any nav-item that is NOT .nav-home and NOT the last item (Fitness Apps)
    const collectionItems = page.locator('.navbar-nav .nav-item:not(.nav-home)');
    const count = await collectionItems.count();
    expect(count).toBeGreaterThan(0);

    // Click the first collection
    await collectionItems.first().click();

    // screen-app should disappear (we're now in menu view)
    await expect(page.locator('.screen-app')).not.toBeVisible({ timeout: 5000 });

    // Now click Home
    const homeBtn = page.locator('.navbar-nav .nav-item.nav-home');
    await homeBtn.click();

    // screen-app should reappear
    await expect(page.locator('.screen-app')).toBeVisible({ timeout: 10000 });

    // Home should be active again
    await expect(homeBtn).toHaveClass(/active/);
  });

  test('Fitness Apps nav item exists', async ({ page }) => {
    // Find nav items and look for one with "Fitness Apps" label
    const allItems = page.locator('.navbar-nav .nav-item');
    const count = await allItems.count();

    let fitnessAppsFound = false;
    for (let i = 0; i < count; i++) {
      const text = await allItems.nth(i).locator('.nav-label').textContent();
      if (text === 'Fitness Apps') {
        fitnessAppsFound = true;
        break;
      }
    }
    expect(fitnessAppsFound).toBe(true);
  });

  test('Fitness Apps nav item opens module menu', async ({ page }) => {
    // Collect console messages for debugging
    const logs = [];
    page.on('console', msg => logs.push(`[${msg.type()}] ${msg.text()}`));

    // Wait for initial home screen to load
    await expect(page.locator('.screen-app')).toBeVisible({ timeout: 10000 });

    // Find and click the Fitness Apps nav item
    const fitnessAppsBtn = page.locator('.navbar-nav .nav-item').filter({ hasText: 'Fitness Apps' });
    await expect(fitnessAppsBtn).toBeVisible();

    // Check URL before click
    const urlBefore = page.url();
    console.log('URL before click:', urlBefore);

    await fitnessAppsBtn.click();

    // Wait for URL to change (proves handleNavigate fired)
    await page.waitForURL(/\/fitness\/menu\//, { timeout: 5000 }).catch(() => {
      console.log('URL did NOT change to /fitness/menu/');
      console.log('URL after click:', page.url());
    });
    console.log('URL after click:', page.url());

    // Check what's in the DOM now
    const hasScreenApp = await page.locator('.screen-app').isVisible().catch(() => false);
    const hasModuleMenu = await page.locator('.fitness-module-menu').isVisible().catch(() => false);
    console.log('screen-app visible:', hasScreenApp);
    console.log('fitness-module-menu visible:', hasModuleMenu);

    // Log relevant console messages
    const navLogs = logs.filter(l => l.includes('navigate') || l.includes('module') || l.includes('menu'));
    console.log('Relevant logs:', navLogs.slice(0, 10));

    // Check what rendered in the main content area
    const mainContent = page.locator('.fitness-main-content');
    const mainHTML = await mainContent.innerHTML().catch(() => 'NOT FOUND');
    console.log('Main content first 500 chars:', mainHTML.slice(0, 500));

    // The module menu should render with module cards
    const moduleMenu = page.locator('.fitness-module-menu');
    await expect(moduleMenu).toBeVisible({ timeout: 10000 });
  });

});
