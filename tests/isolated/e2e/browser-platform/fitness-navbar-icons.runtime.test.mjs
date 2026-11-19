import { expect, test } from '@playwright/test';

test('Fitness renders configured icon names and SVG filenames through the shared asset route', async ({ page }) => {
  const navItems = [
    { name: 'Home', icon: 'home', type: 'screen', target: { screen_id: 'home' } },
    { name: 'Cycle', icon: 'cycle.svg', type: 'screen', target: { screen_id: 'cycle' } },
    { name: 'Missing', icon: 'missing', type: 'screen', target: { screen_id: 'missing' } },
    { name: 'No icon', type: 'screen', target: { screen_id: 'none' } },
  ];
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24"><path d="M2 2h20v20H2z"/></svg>';

  await page.route('**/api/**', route => {
    const { pathname } = new URL(route.request().url());
    if (pathname === '/api/v1/supervision/bootstrap') {
      return route.fulfill({ json: { enabled: false } });
    }
    if (pathname === '/api/v1/fitness') {
      return route.fulfill({ json: { fitness: { content: { nav_items: navItems } } } });
    }
    if (pathname === '/api/v1/static/img/icons/home.svg' || pathname === '/api/v1/static/img/icons/cycle.svg') {
      return route.fulfill({ contentType: 'image/svg+xml', body: svg });
    }
    if (pathname.startsWith('/api/v1/static/img/icons/')) {
      return route.fulfill({ status: 404 });
    }
    return route.fulfill({ json: {} });
  });

  await page.goto('/fitness');
  const nav = page.locator('.fitness-navbar nav');
  for (const [name, filename] of [['Home', 'home.svg'], ['Cycle', 'cycle.svg']]) {
    const icon = nav.getByRole('button', { name, exact: true }).locator('img');
    await expect(icon).toHaveAttribute('src', new URL(`/api/v1/static/img/icons/${filename}`, page.url()).href);
    await expect.poll(() => icon.evaluate(image => image.naturalWidth)).toBe(24);
  }
  await expect(nav.getByRole('button', { name: 'Missing' }).locator('svg[aria-hidden="true"]')).toBeVisible();
  await expect(nav.getByRole('button', { name: 'No icon' }).locator('svg[aria-hidden="true"]')).toBeVisible();
});
