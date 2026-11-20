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

for (const draft of [null, 'row label', 'section title']) {
  const scenario = draft ? `label edit with a pending ${draft}` : 'section addition';
  test(`Admin retries only the list read after a committed ${scenario}`, async ({ page }) => {
    const path = `/api/v1${menuRoute}`;
    const saved = list('fixture-menu', ['First item', 'Second item']);
    saved.sections[0].title = 'Existing section';
    const followup = Promise.withResolvers();
    const writes = [];
    const errors = [];
    const release = Promise.withResolvers();
    let reads = 0;
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/api/**', async route => {
      const request = route.request();
      const url = new URL(request.url());
      if (url.pathname === path && request.method() === 'GET') {
        reads++;
        if (reads === 2) {
          await followup.promise;
          return route.fulfill({ status: 409, json: { error: 'Snapshot unavailable' } });
        }
        if (reads === 3) await release.promise;
        return route.fulfill({ json: saved });
      }
      if (url.pathname === path + '/sections' && request.method() === 'POST') {
        writes.push(request.postDataJSON());
        saved.sections.push({ ...writes[0], items: [] });
        return route.fulfill({ status: 201, json: { ok: true, sectionIndex: 1 } });
      }
      const row = saved.sections[0].items.findIndex((_, index) => url.pathname === `${path}/items/${index}`);
      if (row >= 0 && url.searchParams.get('section') === '0' && request.method() === 'PUT') {
        const payload = request.postDataJSON();
        writes.push(payload);
        Object.assign(saved.sections[0].items[row], payload);
        return route.fulfill({ json: { ok: true } });
      }
      if (url.pathname === path + '/sections/0' && request.method() === 'PUT') {
        const payload = request.postDataJSON();
        writes.push(payload);
        Object.assign(saved.sections[0], payload);
        return route.fulfill({ json: { ok: true } });
      }
      return route.fulfill({ json: url.pathname.endsWith('/supervision/bootstrap') ? { enabled: false } : {} });
    });
    await page.goto(menuRoute);
    const add = page.getByRole('button', { name: 'Add Section' });
    const label = page.getByTestId('item-row-0-0').locator('.col-label');
    await expect(label).toHaveText('First item');
    const region = page.getByRole('region', { name: 'List contents' });
    const draftCell = draft === 'row label' ? page.getByTestId('item-row-0-1').locator('.col-label') : region.locator('.section-header').first();
    try {
      if (draft) {
        await label.getByText('First item').click();
        const input = label.getByRole('textbox');
        await input.fill('Updated label');
        await input.press('Enter');
        await expect.poll(() => reads).toBe(2);
        await draftCell.getByText(draft === 'row label' ? 'Second item' : 'Existing section', { exact: true }).click();
        await draftCell.getByRole('textbox').fill('Unsubmitted draft');
      } else {
        await add.press('Enter');
      }
      followup.resolve();
      const alert = region.getByRole('alert');
      await expect(alert).toContainText('Change saved');
      await expect(alert).toContainText('Snapshot unavailable');
      await expect(page.getByText('Could not save change', { exact: true })).toHaveCount(0);
      await expect(region.locator('button').filter({ hasText: 'Add Section' })).toBeDisabled();
      await alert.getByRole('button', { name: 'Retry' }).press('Enter');
      await expect.poll(() => reads).toBe(3);
      await expect(region).toHaveAttribute('aria-busy', 'true');
      await expect(region).toBeFocused();
      await expect(region.locator('button').filter({ hasText: 'Add Section' })).toBeDisabled();
    } finally {
      followup.resolve();
      release.resolve();
    }
    await expect(region.getByRole('alert')).toHaveCount(0);
    await expect(add).toBeEnabled();
    await expect(region).toBeFocused();
    if (draft) {
      await expect(label).toHaveText('Updated label');
      const input = draftCell.getByRole('textbox');
      await expect(input).toHaveValue('Unsubmitted draft');
      expect(writes).toEqual([{ label: 'Updated label' }]);
      // A deliberate blur still saves the recovered draft.
      await input.focus();
      await input.press('Tab');
      await expect.poll(() => writes).toEqual([{ label: 'Updated label' }, {
        [draft === 'row label' ? 'label' : 'title']: 'Unsubmitted draft',
      }]);
    } else {
      await expect(region.getByText('Section 2', { exact: true })).toBeVisible();
      expect(writes).toEqual([{ title: 'Section 2' }]);
    }
    expect(errors).toEqual([]);
  });
}
