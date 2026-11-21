import { expect, test } from '@playwright/test';

test.use({ serviceWorkers: 'block', viewport: { width: 1440, height: 850 } });

const folder = '/admin/content/lists/menus/display-fixture';
const imageUrl = '/display-preview-fixture.svg';
const itemTitle = 'Canvas descriptor fixture';
const imageBody = '<svg xmlns="http://www.w3.org/2000/svg" width="160" height="90"><rect width="160" height="90" fill="teal"/></svg>';

for (const [label, localId] of [['a simple Canvas ID', 'map'], ['an encoded nested Canvas ID', 'family art/2026/sea glass']]) {
  test(`Admin Display preview shares the row descriptor for ${label}`, async ({ page }) => {
    const path = `/api/v1/info/canvas/${encodeURIComponent(localId)}`;
    const input = `canvas:${localId}`;
    const descriptorReads = [];
    const started = Promise.withResolvers();
    const release = Promise.withResolvers();

    await page.routeWebSocket('**/*', () => {});
    await page.route(`**${imageUrl}`, route => route.fulfill({ contentType: 'image/svg+xml', body: imageBody }));
    await page.route('**/api/**', async route => {
      const request = route.request();
      const { pathname } = new URL(request.url());
      if (decodeURIComponent(pathname) === `/api/v1/info/canvas/${localId}`) {
        descriptorReads.push([request.method(), pathname]);
        started.resolve();
        await release.promise;
        return route.fulfill({ json: {
          id: input, source: 'canvas', title: itemTitle, imageUrl, capabilities: ['displayable'],
        } });
      }
      if (pathname === '/api/v1' + folder) {
        return route.fulfill({ json: {
          name: 'display-fixture',
          sections: [{ title: 'Tonight', items: [{ uid: 'display', label: 'Wall art', action: 'Display', input }] }],
        } });
      }
      return route.fulfill({ json: pathname.endsWith('/supervision/bootstrap') ? { enabled: false } : {} });
    });

    try {
      await page.goto(folder);
      await started.promise;
      const row = page.getByTestId('item-row-0-0');
      const launch = row.getByRole('button', { name: 'Preview image' });
      const preview = page.getByRole('dialog', { name: 'Wall art' });
      const image = preview.getByRole('img', { name: itemTitle, exact: true });
      await launch.press('Enter');
      await expect(preview).toBeVisible();
      await expect(image).toHaveCount(0);
      release.resolve();

      await expect(image).toHaveAttribute('src', imageUrl);
      await expect.poll(() => image.evaluate(node => node.naturalWidth)).toBe(160);
      await page.keyboard.press('Escape');
      await expect(preview).toBeHidden();
      await expect(row.getByText(itemTitle, { exact: true })).toBeVisible();
      expect.soft(descriptorReads).toEqual([['GET', path]]);

      await launch.press('Enter');
      await expect(image).toHaveAttribute('src', imageUrl);
      expect(descriptorReads).toEqual([['GET', path]]);
    } finally {
      release.resolve();
    }
  });
}
