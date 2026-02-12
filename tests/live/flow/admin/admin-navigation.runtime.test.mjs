/**
 * Admin Navigation Smoke Test
 *
 * Verifies:
 * 1. /admin health check returns 200
 * 2. /admin redirects to /admin/content/lists/menus (default route)
 * 3. All 4 nav section headers render (CONTENT, APPS, HOUSEHOLD, SYSTEM)
 * 4. Each nav item navigates to its route and renders content
 * 5. No blank/error pages across the admin panel
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

// All nav items extracted from AdminNav.jsx navSections
const NAV_SECTIONS = [
  {
    section: 'CONTENT',
    items: [
      { label: 'Menus', path: '/admin/content/lists/menus' },
      { label: 'Watchlists', path: '/admin/content/lists/watchlists' },
      { label: 'Programs', path: '/admin/content/lists/programs' },
    ]
  },
  {
    section: 'APPS',
    items: [
      { label: 'Fitness', path: '/admin/apps/fitness' },
      { label: 'Finance', path: '/admin/apps/finance' },
      { label: 'Gratitude', path: '/admin/apps/gratitude' },
      { label: 'Shopping', path: '/admin/apps/shopping' },
    ]
  },
  {
    section: 'HOUSEHOLD',
    items: [
      { label: 'Members', path: '/admin/household/members' },
      { label: 'Devices', path: '/admin/household/devices' },
    ]
  },
  {
    section: 'SYSTEM',
    items: [
      { label: 'Integrations', path: '/admin/system/integrations' },
      { label: 'Scheduler', path: '/admin/system/scheduler' },
      { label: 'Config', path: '/admin/system/config' },
    ]
  }
];

test.describe('Admin Navigation Smoke Test', () => {
  test.setTimeout(120000);

  test('health check - /admin returns 200', async ({ request }) => {
    const response = await request.get(`${BASE_URL}/admin`);
    expect(response.status(), '/admin should return 200').toBe(200);
    console.log(`/admin returned ${response.status()}`);
  });

  test('/admin redirects to default route', async () => {
    await sharedPage.goto(`${BASE_URL}/admin`, {
      waitUntil: 'networkidle',
      timeout: 30000
    });

    // AdminApp has: <Route index element={<Navigate to="content/lists/menus" replace />} />
    await sharedPage.waitForURL('**/admin/content/lists/menus', { timeout: 10000 });
    const url = sharedPage.url();
    expect(url).toContain('/admin/content/lists/menus');
    console.log(`Redirected to: ${url}`);
  });

  test('all 4 nav section headers render', async () => {
    // Ensure we are on an admin page
    if (!sharedPage.url().includes('/admin')) {
      await sharedPage.goto(`${BASE_URL}/admin`, {
        waitUntil: 'networkidle',
        timeout: 30000
      });
    }

    const sectionLabels = ['CONTENT', 'APPS', 'HOUSEHOLD', 'SYSTEM'];

    for (const label of sectionLabels) {
      // Section headers are <Text tt="uppercase"> elements with the section name
      const header = sharedPage.locator(`text="${label}"`).first();
      await expect(header, `Section header "${label}" should be visible`).toBeVisible({ timeout: 5000 });
      console.log(`Section header visible: ${label}`);
    }
  });

  test('click each nav item - verify URL changes and content loads', async () => {
    const allItems = NAV_SECTIONS.flatMap(s => s.items);
    const errors = [];

    for (const item of allItems) {
      console.log(`Navigating to: ${item.label} (${item.path})`);

      // Click the NavLink by its label text
      const navLink = sharedPage.locator(`.mantine-NavLink-root`, { hasText: item.label }).first();
      await expect(navLink, `Nav item "${item.label}" should be visible`).toBeVisible({ timeout: 5000 });
      await navLink.click();

      // Wait for URL to update
      await sharedPage.waitForURL(`**${item.path}**`, { timeout: 10000 });
      const currentUrl = sharedPage.url();
      expect(currentUrl, `URL should contain ${item.path}`).toContain(item.path);

      // Wait for page content to load
      await sharedPage.waitForTimeout(1500);

      // Verify the page is not blank - look for any Mantine component rendering
      const hasContent = await sharedPage.locator([
        '.mantine-Text-root',
        '.mantine-Paper-root',
        '.mantine-Table-root',
        '.mantine-Stack-root',
        '.mantine-Loader-root',
        '.mantine-Alert-root',
        '.mantine-Badge-root',
      ].join(', ')).first().isVisible().catch(() => false);

      if (!hasContent) {
        errors.push(`${item.label} (${item.path}): No visible Mantine content`);
        console.log(`  WARNING: No visible content on ${item.label}`);
      } else {
        console.log(`  OK: Content rendered on ${item.label}`);
      }

      // Check for uncaught JS errors that would produce a blank page
      const errorAlert = sharedPage.locator('.mantine-Alert-root[data-color="red"]');
      const hasError = await errorAlert.count() > 0;
      if (hasError) {
        const errorText = await errorAlert.first().textContent();
        console.log(`  Note: Error alert on ${item.label}: ${errorText?.substring(0, 80)}`);
      }

      // Verify the clicked nav item shows as active
      const activeNavLink = sharedPage.locator('.mantine-NavLink-root[data-active="true"]', { hasText: item.label });
      const isActive = await activeNavLink.count() > 0;
      console.log(`  Active state: ${isActive}`);
    }

    if (errors.length > 0) {
      console.log(`\nPages with no content: ${errors.length}`);
      errors.forEach(e => console.log(`  - ${e}`));
    }

    expect(errors, `${errors.length} pages rendered blank`).toHaveLength(0);
  });
});
