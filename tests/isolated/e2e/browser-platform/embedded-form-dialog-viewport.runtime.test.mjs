import { expect, test } from '@playwright/test';

test.use({ viewport: { width: 390, height: 850 }, hasTouch: true, serviceWorkers: 'block' });

const catalogIndex = '/admin/content/lists/menus';
const folder = `${catalogIndex}/family-picks`;
const apiIndex = `/api/v1${catalogIndex}`;
const apiFolder = `/api/v1${folder}`;
const imageUrl = 'https://fixture.invalid/image.png';

const catalogForms = [
  { title: 'Create New Menu', route: catalogIndex, open: 'New Menu', field: 'Menu Name', action: 'Create',
    method: 'POST', path: apiIndex, key: 'name', value: 'fixture-menu' },
  { title: 'List Settings', route: folder, open: 'List actions', menu: 'Menu Settings', field: 'Title', action: 'Save Settings',
    method: 'PUT', path: `${apiFolder}/settings`, key: 'title', value: 'Fixture Menu' },
  { title: 'Section Settings: Tonight', route: folder, open: 'Section actions for Tonight', menu: 'Section Settings', field: 'Title', action: 'Save Section',
    method: 'PUT', path: `${apiFolder}/sections/0`, key: 'title', value: 'Fixture Section' },
  { title: 'Edit Item', route: folder, open: /^Edit settings for Show to watch/, field: 'Label', action: 'Save Changes',
    method: 'PUT', path: `${apiFolder}/items/0`, key: 'label', value: 'Fixture Item' },
  { title: 'Item Image', route: folder, open: 'Edit image for Show to watch', placeholder: 'Paste image URL...', action: 'Set',
    method: 'PUT', path: `${apiFolder}/items/0`, key: 'image', value: imageUrl },
];

async function tapAboveKeyboard(page, action) {
  await action.click({ trial: true });
  await page.evaluate(() => {
    const viewport = window.visualViewport;
    for (const [key, value] of Object.entries({ height: 330, offsetTop: 30 })) {
      Object.defineProperty(viewport, key, { configurable: true, value });
    }
    viewport.dispatchEvent(new Event('resize'));
  });
  await action.evaluate(element => element.scrollIntoView({ block: 'nearest' }));
  await expect.poll(() => action.evaluate(element => {
    const { top, bottom } = element.getBoundingClientRect();
    const { offsetTop, height } = window.visualViewport;
    return Math.max(offsetTop - top, bottom - offsetTop - height);
  }), { message: 'the action fits inside the keyboard viewport' }).toBeLessThanOrEqual(1);
  await action.tap();
}

for (const fixture of catalogForms) {
  test(`Admin ${fixture.title} keeps its action reachable above the keyboard`, async ({ page }) => {
    const writes = [];
    let item = { uid: 'tonight-item', label: 'Show to watch', shuffle: true, action: 'Play', input: 'plex:123' };
    await page.routeWebSocket('**/*', () => {});
    await page.route('https://fixture.invalid/**', route => route.abort());
    await page.route('**/api/**', route => {
      const request = route.request();
      const { pathname } = new URL(request.url());
      if (pathname === fixture.path && request.method() === fixture.method) {
        const data = request.postDataJSON();
        writes.push(data);
        if (pathname.endsWith('/items/0')) item = { ...item, ...data };
        return route.fulfill({ json: data });
      }
      if (pathname === apiIndex) return route.fulfill({ json: { lists: [{ name: 'family-picks', active: true }] } });
      if (pathname === apiFolder) return route.fulfill({ json: { name: 'family-picks', sections: [{ title: 'Tonight', items: [item] }] } });
      return route.fulfill({ json: pathname.endsWith('/supervision/bootstrap') ? { enabled: false } : {} });
    });

    await page.goto(fixture.route);
    await page.getByRole('button', { name: fixture.open, exact: true }).click();
    if (fixture.menu) await page.getByRole('menuitem', { name: fixture.menu, exact: true }).click();
    const dialog = page.getByRole('dialog', { name: fixture.title, exact: true });
    if (fixture.placeholder) await dialog.getByRole('tab', { name: 'URL', exact: true }).click();
    const field = fixture.placeholder ? dialog.getByPlaceholder(fixture.placeholder) : dialog.getByLabel(fixture.field);
    await field.fill(fixture.value);
    await expect(field).toBeFocused();
    await tapAboveKeyboard(page, dialog.getByRole('button', { name: fixture.action, exact: true }));
    await expect.poll(() => writes).toEqual([expect.objectContaining({ [fixture.key]: fixture.value })]);
    if (fixture.placeholder) {
      await expect(dialog.locator('img')).toHaveAttribute('src', imageUrl);
      await dialog.getByRole('button', { name: 'Done', exact: true }).click();
    }
    await expect(dialog).toBeHidden();
  });
}

for (const fixture of [
  { name: 'Rename this device', route: '/media', prefix: 'settings-rename', opener: 'settings-rename-device', settings: true },
  { name: 'Screen Admin Rename', route: '/media?view=screens', prefix: 'screen-admin-rename', opener: 'screen-admin-rename-fleet:lounge' },
]) {
  test(`Media ${fixture.name} keeps Save reachable above the keyboard`, async ({ page }) => {
    const writes = [];
    let screen = { id: 'fleet:lounge', name: 'Den TV', room: 'Den' };
    await page.addInitScript(() => localStorage.setItem('media-app.first-use-done', 'done'));
    await page.routeWebSocket('**/*', () => {});
    await page.route('**/api/**', route => {
      const request = route.request();
      const pathname = decodeURIComponent(new URL(request.url()).pathname);
      if (pathname === '/api/v1/media/screens') return route.fulfill({ json: { screens: [screen] } });
      if (pathname.startsWith('/api/v1/media/screens/') && request.method() === 'PATCH') {
        const data = request.postDataJSON();
        writes.push(data);
        const saved = { ...screen, id: pathname.split('/').at(-1), ...data };
        if (!fixture.settings) screen = saved;
        return route.fulfill({ json: { screen: saved, routines: [] } });
      }
      return route.fulfill({ json: pathname.endsWith('/supervision/bootstrap') ? { enabled: false } : {} });
    });

    await page.goto(fixture.route);
    if (fixture.settings) await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await page.getByTestId(fixture.opener).click();
    const field = page.getByTestId(`${fixture.prefix}-name`);
    const name = 'Fixture Display';
    await field.fill(name);
    await expect(field).toBeFocused();
    await tapAboveKeyboard(page, page.getByTestId(`${fixture.prefix}-save`));
    await expect(page.getByTestId(`${fixture.prefix}-dialog`)).toBeHidden();
    expect(writes).toEqual([{ name }]);
    await expect(page).toHaveURL(new URL(fixture.route, page.url()).href);
  });
}
