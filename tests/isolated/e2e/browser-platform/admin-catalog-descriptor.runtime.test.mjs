import { expect, test } from '@playwright/test';

test.use({ serviceWorkers: 'block', viewport: { width: 1440, height: 850 } });

const folder = '/admin/content/lists/menus/catalog-fixture';
const descriptorPath = '/api/v1/info/plex/foo';
const descriptor = {
  id: 'plex:foo',
  source: 'plex',
  title: 'Catalog fixture title',
  thumbnail: '/catalog-fixture.png',
  capabilities: ['displayable'],
  metadata: { type: 'movie', summary: 'Catalog fixture summary' },
};

async function openFolder(page, serveDescriptor) {
  const requests = [];
  await page.routeWebSocket('**/*', () => {});
  await page.route('**/api/**', route => {
    const request = route.request();
    const { pathname } = new URL(request.url());
    const method = request.method();
    requests.push([method, pathname]);
    if (pathname === descriptorPath) return serveDescriptor(route);
    if (pathname === '/api/v1' + folder) {
      return route.fulfill({ json: {
        name: 'catalog-fixture',
        sections: [{ title: 'Tonight', items: [{ uid: 'sample', label: 'Fixture row', action: 'Play', input: 'plex:foo' }] }],
      } });
    }
    return route.fulfill({ json: pathname.endsWith('/supervision/bootstrap') ? { enabled: false } : {} });
  });
  await page.goto(folder);
  await expect(page.getByRole('button', { name: 'Actions for Fixture row' })).toBeVisible();
  return requests;
}

async function openItemDetails(page) {
  await page.getByRole('button', { name: 'Actions for Fixture row' }).press('Enter');
  await page.getByRole('menuitem', { name: 'More Info' }).press('Enter');
  const drawer = page.getByRole('dialog', { name: 'Item Details' });
  await expect(drawer).toBeVisible();
  return drawer;
}

async function expectDescriptorInListAndDrawer(page, drawer) {
  await expect(drawer.getByText(descriptor.title, { exact: true })).toBeVisible();
  await expect(drawer.getByText(descriptor.metadata.summary, { exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(drawer).toBeHidden();
  const row = page.getByTestId('item-row-0-0');
  await expect(row.getByText(descriptor.title, { exact: true })).toBeVisible();
  await expect(row.getByRole('alert').filter({ hasText: /Play needs a playable source/ })).toBeVisible();
}

test('Admin row and Item Details share one held descriptor read', async ({ page }) => {
  const started = Promise.withResolvers();
  const release = Promise.withResolvers();
  try {
    const requests = await openFolder(page, async route => {
      started.resolve();
      await release.promise;
      return route.fulfill({ json: descriptor });
    });
    await started.promise;
    const drawer = await openItemDetails(page);
    await expect(drawer.getByText(descriptor.title, { exact: true })).toHaveCount(0);
    release.resolve();
    await expectDescriptorInListAndDrawer(page, drawer);
    expect(requests.filter(([, path]) => path === descriptorPath)).toEqual([['GET', descriptorPath]]);
  } finally {
    release.resolve();
  }
});

test('Admin Item Details retries the descriptor with one GET and updates its row', async ({ page }) => {
  let available = false;
  const requests = await openFolder(page, route => available
    ? route.fulfill({ json: descriptor })
    : route.fulfill({ status: 422, json: { error: 'Fixture descriptor unavailable' } }));
  const drawer = await openItemDetails(page);
  const retry = drawer.getByRole('button', { name: 'Retry', exact: true });
  await expect(retry).toBeVisible();
  const beforeRetry = requests.length;
  available = true;
  await retry.press('Enter');
  await expectDescriptorInListAndDrawer(page, drawer);
  await page.getByRole('button', { name: 'Edit image for Fixture row' }).press('Enter');
  const imagePicker = page.getByRole('dialog', { name: 'Item Image' });
  await expect(imagePicker.locator('img[src="/catalog-fixture.png"]')).toBeVisible();
  expect(requests.slice(beforeRetry).filter(([, path]) => path === descriptorPath)).toEqual([['GET', descriptorPath]]);
  expect(requests.filter(([method]) => method !== 'GET')).toEqual([]);
});

test('Admin Item Details revalidates a warm descriptor on open', async ({ page }) => {
  let payload = descriptor;
  const requests = await openFolder(page, route => route.fulfill({ json: payload }));
  const row = page.getByTestId('item-row-0-0');
  await expect(row.getByText(descriptor.title, { exact: true })).toBeVisible();
  expect(requests.filter(([, path]) => path === descriptorPath)).toEqual([['GET', descriptorPath]]);

  payload = { ...descriptor, title: 'Updated catalog title', capabilities: ['playable'] };
  const drawer = await openItemDetails(page);
  await expect(drawer.getByText(payload.title, { exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(drawer).toBeHidden();
  await expect(row.getByText(payload.title, { exact: true })).toBeVisible();
  await expect(row.getByRole('alert').filter({ hasText: /Play needs a playable source/ })).toHaveCount(0);
  expect(requests.filter(([, path]) => path === descriptorPath)).toEqual([['GET', descriptorPath], ['GET', descriptorPath]]);
});

test('Admin content drag preview gives the descriptor title room to render', async ({ page }) => {
  await openFolder(page, route => route.fulfill({ json: descriptor }));
  const row = page.getByTestId('item-row-0-0');
  await expect(row.getByText(descriptor.title, { exact: true })).toBeVisible();
  const handle = row.locator('.col-content-drag');
  await handle.hover();
  const box = await handle.boundingBox();
  await page.mouse.down();
  try {
    await page.mouse.move(box.x + box.width / 2 + 12, box.y + box.height / 2 + 8);
    await expect(page.locator('.content-drag-overlay').getByText(descriptor.title, { exact: true })).toBeVisible();
  } finally {
    await page.mouse.up();
  }
});
