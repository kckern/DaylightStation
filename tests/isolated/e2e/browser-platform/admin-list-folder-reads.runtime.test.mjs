import { expect, test } from '@playwright/test';

test.use({ serviceWorkers: 'block', viewport: { width: 1440, height: 850 } });

const root = '/admin/content/lists';
const menuRoute = `${root}/menus/fixture-menu`;
const programRoute = `${root}/programs/fixture-program`;
const list = (name, labels) => ({ name, sections: [{
  items: labels.map((label, index) => ({ uid: `item-${index}`, label, action: 'Play', input: `plex:${index + 1}` })),
}] });

test.beforeEach(async ({ page, baseURL }) => {
  const origin = new URL(baseURL).origin;
  await page.context().route('**/*', route => (
    new URL(route.request().url()).origin === origin ? route.fallback() : route.abort()
  ));
  await page.routeWebSocket('**/*', () => {});
});

test('Admin Menu editor keeps the newest snapshot across overlapping item saves', async ({ page }) => {
  const path = `/api/v1${menuRoute}`;
  const labels = ['First item', 'Second item'];
  const writes = [];
  let reads = 0;
  let held;
  let retired = false;
  page.on('requestfailed', request => { if (request === held?.request()) retired = true; });
  await page.route('**/api/**', route => {
    const request = route.request();
    const pathname = new URL(request.url()).pathname;
    if (pathname === path && request.method() === 'GET') {
      if (++reads === 2) { held = route; return; }
      return route.fulfill({ json: list('fixture-menu', labels) });
    }
    if (pathname.startsWith(`${path}/items/`) && request.method() === 'PUT') {
      const index = Number(pathname.split('/').at(-1));
      const { label } = request.postDataJSON();
      labels[index] = label;
      writes.push([index, label]);
      return route.fulfill({ json: {} });
    }
    return route.fulfill({ json: pathname.endsWith('/supervision/bootstrap') ? { enabled: false } : {} });
  });

  await page.goto(menuRoute);
  const labelAt = index => page.getByTestId(`item-row-0-${index}`).locator('.col-label');
  const edit = async (index, text) => {
    const cell = labelAt(index);
    await cell.getByText(labels[index], { exact: true }).click();
    const input = cell.getByRole('textbox');
    await input.fill(text);
    await input.press('Enter');
  };
  await edit(0, 'Updated first');
  await expect.poll(() => Boolean(held)).toBe(true);
  await edit(1, 'Updated second');
  await expect(labelAt(1)).toHaveText('Updated second');
  await expect.poll(() => retired).toBe(true);
  await held.fulfill({ json: list('fixture-menu', ['Updated first', 'Second item']) }).catch(() => {});
  await expect(labelAt(1)).toHaveText('Updated second');
  expect(writes).toEqual([[0, 'Updated first'], [1, 'Updated second']]);
  expect(reads).toBe(3);
});

test('Admin Program editor retires its pending detail read when leaving', async ({ page }) => {
  const path = `/api/v1${programRoute}`;
  let held;
  let retired = false;
  page.on('requestfailed', request => { if (request === held?.request()) retired = true; });
  await page.route('**/api/**', route => {
    const pathname = new URL(route.request().url()).pathname;
    if (pathname === path && route.request().method() === 'GET') { held = route; return; }
    if (pathname === `/api/v1${root}/menus`) return route.fulfill({ json: { lists: [{ name: 'fixture-menu' }] } });
    return route.fulfill({ json: pathname.endsWith('/supervision/bootstrap') ? { enabled: false } : {} });
  });
  await page.goto(programRoute);
  await expect.poll(() => Boolean(held)).toBe(true);
  await page.getByRole('navigation', { name: 'Primary' }).getByRole('link', { name: 'Menus', exact: true }).click();
  await expect(page).toHaveURL(`${root}/menus`);
  await expect(page.getByRole('link', { name: /Fixture Menu/ })).toBeVisible();
  await expect.poll(() => retired).toBe(true);
});
