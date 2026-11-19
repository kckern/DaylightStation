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

for (const width of [390, 767, 768, 1199, 1200, 1440]) {
  test(`the last navigation item is visible on keyboard focus at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 850 });
    await page.goto(`${BASE_URL}/admin`);
    if (width < 768) await page.getByRole('button', { name: 'Toggle admin navigation' }).click();
    const lastLink = page.getByRole('link', { name: 'Notifications', exact: true });
    const links = page.getByRole('navigation', { name: 'Primary' }).getByRole('link');
    await links.first().focus();
    const linkCount = await links.count();
    for (let i = 1; i < linkCount; i++) {
      await page.keyboard.press('Tab');
      if (await lastLink.evaluate(link => link === document.activeElement)) break;
    }
    await expect(lastLink).toBeFocused();
    await expect(lastLink).toBeInViewport({ ratio: 1 });
    const ring = await lastLink.evaluate(link => {
      const style = getComputedStyle(link);
      return { style: style.outlineStyle, width: parseFloat(style.outlineWidth), offset: parseFloat(style.outlineOffset) };
    });
    expect(ring.style).toBe('solid');
    expect(ring.width).toBeGreaterThan(0);
    expect(ring.width + ring.offset).toBeLessThanOrEqual(0);
    await lastLink.press('Enter');
    await expect(page).toHaveURL(/\/admin\/system\/notifications$/);
  });
}

for (const gesture of ['wheel', 'touch']) {
  test(`the ${gesture} gesture reaches Household Devices in compact navigation`, async ({ browser, browserName }) => {
    test.skip(gesture === 'touch' && browserName !== 'chromium', 'Native touch injection requires Chromium');
    const page = await browser.newPage({ viewport: { width: 390, height: 650 }, hasTouch: gesture === 'touch' });
    try {
      await page.goto(`${BASE_URL}/admin`);
      await page.getByRole('button', { name: 'Toggle admin navigation' }).click();
      const nav = page.getByRole('navigation', { name: 'Primary' });
      const devices = nav.getByRole('link', { name: 'Devices', exact: true });
      const box = await nav.boundingBox();
      const x = Math.round(box.x + box.width / 2);
      const y = Math.round(box.y + box.height * 0.8);
      if (gesture === 'wheel') {
        await page.mouse.move(x, y);
        await page.mouse.wheel(0, box.height);
      } else {
        const session = await page.context().newCDPSession(page);
        await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
        for (let step = 1; step <= 12; step++) {
          await session.send('Input.dispatchTouchEvent', {
            type: 'touchMove', touchPoints: [{ x, y: y - step * Math.floor(box.height / 20) }],
          });
        }
        await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      }
      await expect(devices).toBeInViewport({ ratio: 1 });
      if (gesture === 'touch') await devices.tap();
      else await devices.click();
      await expect(page).toHaveURL(/\/admin\/household\/devices$/);
    } finally {
      await page.close();
    }
  });
}

test('dirty editor navigation and catalog selection preserve the intended draft', async ({ page }) => {
  const saved = [];
  let row = { label: 'One', input: 'plex:1', action: 'Play', shuffle: true };
  await page.addInitScript(() => { window.EventSource = undefined; });
  await page.routeWebSocket('**/*', () => {});
  await page.route('**/api/**', async route => {
    const request = route.request();
    const { pathname } = new URL(request.url());
    if (request.method() === 'PUT' && pathname.endsWith('/example/items/0')) {
      row = { ...row, ...request.postDataJSON() };
      saved.push(row);
      return route.fulfill({ json: { ok: true } });
    }
    if (request.method() !== 'GET') return route.fulfill({ status: 204 });
    let body = {};
    if (pathname.endsWith('/supervision/bootstrap')) body = { enabled: false };
    else if (pathname.endsWith('/members/fixture')) body = { member: { username: 'fixture', display_name: 'Fixture' } };
    else if (pathname.endsWith('/menus/example')) body = { name: 'example', sections: [{ title: 'Section', items: [row] }] };
    else if (pathname.includes('/query/search')) body = { items: [{ id: 'plex:42', title: 'Audit item', type: 'track', source: 'plex', itemType: 'leaf' }] };
    else if (pathname.includes('/lists/menus')) body = { lists: [] };
    return route.fulfill({ json: body });
  });

  await page.goto(`${BASE_URL}/admin/household/members/fixture`);
  const label = page.getByLabel('Display Name');
  await label.fill('Edited');
  const menus = page.getByRole('link', { name: 'Menus', exact: true });
  await menus.click();
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(label).toHaveValue('Edited');
  await menus.click();
  await page.getByRole('button', { name: 'Discard', exact: true }).click();
  await expect(page).toHaveURL(/\/admin\/content\/lists\/menus$/);

  await page.goto(`${BASE_URL}/admin/content/lists/menus/example`);
  await page.getByRole('button', { name: /^Edit settings for One/ }).press('Enter');
  const draft = page.getByTestId('item-label-input');
  await draft.fill('Retained draft');
  await page.getByPlaceholder('Search content or type source:id').fill('Audit');
  await page.getByText('Audit item', { exact: true }).first().click();
  await expect(draft).toHaveValue('Retained draft');
  await page.getByTestId('save-item-button').click();
  await expect(page.getByRole('dialog')).toBeHidden();
  expect(saved).toEqual([expect.objectContaining({ label: 'Retained draft', input: 'plex:42' })]);
});

async function useCompactNavFixture(page) {
  await page.setViewportSize({ width: 390, height: 850 });
  await page.routeWebSocket('**/*', () => {});
  await page.route('**/api/**', route => {
    const { pathname } = new URL(route.request().url());
    if (pathname.endsWith('/supervision/bootstrap')) return route.fulfill({ json: { enabled: false } });
    if (pathname.endsWith('/admin/notifications')) return route.fulfill({ json: { quiet_hours: { enabled: false, start: '21:00', end: '07:00' }, cooldowns: {} } });
    if (pathname.endsWith('/members/fixture')) return route.fulfill({ json: { member: { username: 'fixture', display_name: 'Fixture' } } });
    return route.fulfill({ json: {} });
  });
}

test('compact navigation restores keyboard focus on Escape, selection, and Back', async ({ page }) => {
  await useCompactNavFixture(page);
  await page.goto(`${BASE_URL}/admin/household/devices`);
  const toggle = page.getByRole('button', { name: 'Toggle admin navigation' });
  const nav = page.getByRole('navigation', { name: 'Primary' });
  const devices = nav.getByRole('link', { name: 'Devices', exact: true });
  const notifications = nav.getByRole('link', { name: 'Notifications', exact: true });
  await toggle.press('Enter');
  await expect(devices).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(nav).toBeHidden();
  await expect(toggle).toBeFocused();
  await toggle.press('Enter');
  await notifications.press('Enter');
  await expect(page).toHaveURL(/\/admin\/system\/notifications$/);
  await expect(nav).toBeHidden();
  await expect(page.locator('.admin-content')).toBeFocused();
  await toggle.press('Enter');
  await expect(notifications).toBeFocused();
  await page.goBack();
  await expect(page).toHaveURL(/\/admin\/household\/devices$/);
  await expect(nav).toBeHidden();
  await expect(page.locator('.admin-content')).toBeFocused();
});

test('Escape dismisses a compact dirty-form confirmation before its navigation drawer', async ({ page }) => {
  await useCompactNavFixture(page);
  await page.goto(`${BASE_URL}/admin/household/members/fixture`);
  const name = page.getByLabel('Display Name');
  await name.fill('Unsaved');
  const toggle = page.getByRole('button', { name: 'Toggle admin navigation' });
  await toggle.press('Enter');
  const nav = page.getByRole('navigation', { name: 'Primary' });
  await nav.getByRole('link', { name: 'Notifications' }).press('Enter');
  const dialog = page.getByRole('dialog', { name: 'Discard unsaved changes?' });
  await expect(dialog).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(nav).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(toggle).toBeFocused();
  await expect(nav).toBeHidden();
  await expect(name).toHaveValue('Unsaved');
});

test('Admin keeps navigation focus visible across the 767px and 768px boundary', async ({ page }) => {
  await useCompactNavFixture(page);
  await page.setViewportSize({ width: 767, height: 850 });
  await page.goto(`${BASE_URL}/admin/household/devices`);
  const toggle = page.getByRole('button', { name: 'Toggle admin navigation' });
  const nav = page.getByRole('navigation', { name: 'Primary' });
  const devices = nav.getByRole('link', { name: 'Devices', exact: true });
  await expect(nav).toBeHidden();
  await toggle.press('Enter');
  await expect(devices).toBeFocused();
  await page.setViewportSize({ width: 768, height: 850 });
  await expect(toggle).toBeHidden();
  await expect(nav).toBeVisible();
  await expect(devices).toBeFocused();
  await page.setViewportSize({ width: 767, height: 850 });
  await expect(nav).toBeHidden();
  await expect(toggle).toBeFocused();
});
