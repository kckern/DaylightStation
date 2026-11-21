import { expect, test } from '@playwright/test';

const index = '/admin/content/lists/menus';
const folder = index + '/family-picks';

test.use({ serviceWorkers: 'block', viewport: { width: 1440, height: 850 } });

async function openList(page) {
  const writes = [];
  const apiFolder = '/api/v1' + folder;
  let items = [
    { uid: 'tonight-item', label: 'Show to watch', action: 'Play', input: 'plex:123' },
    { uid: 'another-item', label: 'Second show', action: 'Play', input: 'plex:456' },
  ];
  await page.routeWebSocket('**/*', () => {});
  await page.route('**/api/**', route => {
    const request = route.request();
    const { pathname: path, searchParams } = new URL(request.url());
    if (!path.startsWith('/api/')) return route.fallback();
    const method = request.method();
    const section = searchParams.get('section');
    if (method !== 'GET') writes.push({ method, path, section, body: request.postDataJSON() });
    if (path.endsWith('/supervision/bootstrap')) return route.fulfill({ json: { enabled: false } });
    if (path === '/api/v1' + index) {
      return route.fulfill({ json: { lists: [{ name: 'family-picks', active: true }] } });
    }
    if (path === apiFolder + '/items/1' && method === 'DELETE' && section === '0') {
      items = items.slice(0, 1);
      return route.fulfill({ json: {} });
    }
    if (path === apiFolder) {
      if (method === 'PUT' && section === '0') items = request.postDataJSON().items;
      return route.fulfill({ json: {
        name: 'family-picks',
        sections: [{ title: 'Tonight', items }],
      } });
    }
    if (path.startsWith('/api/v1/info/plex/')) {
      const localId = path.split('/').at(-1);
      return route.fulfill({ json: { id: 'plex:' + localId, source: 'plex', title: 'Details for ' + localId, metadata: {} } });
    }
    return route.fulfill({ json: {} });
  });

  await page.goto(index);
  await page.getByRole('link', { name: /Family Picks/ }).click();
  await expect(page).toHaveURL(new RegExp(folder + '$'));
  return writes;
}

test('Admin row actions return focus to the selected row after Escape and Item Details', async ({ page }) => {
  const writes = await openList(page);
  const trigger = page.getByRole('button', { name: 'Actions for Second show', exact: true });
  const menu = page.getByRole('menu', { name: 'Actions for Second show', exact: true });
  // Send Escape at the DOM mount boundary, before a deferred autofocus can run.
  await trigger.evaluate(button => new Promise(resolve => {
    const observer = new MutationObserver(() => {
      const popup = document.getElementById(button.getAttribute('aria-controls'));
      if (!popup || popup.getClientRects().length === 0) return;
      observer.disconnect();
      document.activeElement.dispatchEvent(new KeyboardEvent('keydown', {
        key: 'Escape', bubbles: true, cancelable: true, composed: true,
      }));
      resolve();
    });
    observer.observe(document.body, { childList: true, subtree: true });
    button.focus();
    button.click();
  }));
  await expect(trigger).toHaveAttribute('aria-expanded', 'false');
  await expect(menu).toBeHidden();
  await expect(trigger).toBeFocused();

  await trigger.press('Enter');
  const information = menu.getByRole('menuitem', { name: 'More Info', exact: true });
  await expect(information).toBeFocused();
  await page.keyboard.press('Enter');
  const details = page.getByRole('dialog', { name: 'Item Details', exact: true });
  await expect(details.getByText('Details for 456', { exact: true })).toBeVisible();
  await expect(details.locator(':focus')).toHaveCount(1);
  await expect(menu).toBeHidden();
  await page.keyboard.press('Escape');
  await expect(details).toBeHidden();
  await expect(trigger).toBeFocused();
  await expect(page).toHaveURL(new RegExp(folder + '$'));

  await page.getByRole('main').getByRole('button', { name: 'Back', exact: true }).press('Enter');
  await expect(page).toHaveURL(new RegExp(index + '$'));
  expect(writes).toEqual([]);
});

test('Admin row actions follow native Tab order and Delete writes only the chosen row', async ({ page }) => {
  const writes = await openList(page);
  const trigger = page.getByRole('button', { name: 'Actions for Second show', exact: true });
  const menu = page.getByRole('menu', { name: 'Actions for Second show', exact: true });
  const information = menu.getByRole('menuitem', { name: 'More Info', exact: true });
  for (const key of ['Tab', 'Shift+Tab']) {
    await trigger.focus();
    await page.keyboard.press(key);
    const neighbor = await page.evaluateHandle(() => document.activeElement);
    await trigger.press('Enter');
    await expect(information).toBeFocused();
    await page.keyboard.press(key);
    await expect(menu).toBeHidden();
    await expect.poll(() => neighbor.evaluate(element => document.activeElement === element)).toBe(true);
    await neighbor.dispose();
  }
  expect(writes).toEqual([]);
  await trigger.press('Enter');
  await expect(information).toBeFocused();
  await page.keyboard.press('ArrowUp');
  await expect(menu.getByRole('menuitem', { name: 'Delete', exact: true })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(trigger).toBeHidden();
  await expect(page.getByRole('button', { name: 'Actions for Show to watch', exact: true })).toBeVisible();
  await expect(page.getByText('Removed “Second show”', { exact: true })).toBeVisible();
  expect(writes).toEqual([{ method: 'DELETE', path: '/api/v1' + folder + '/items/1', section: '0', body: {} }]);
});

test('Admin sortable handle retains keyboard drag and right-click reorder', async ({ page }) => {
  const writes = await openList(page);
  const firstRow = page.getByTestId('item-row-0-0');
  const secondRow = page.getByTestId('item-row-0-1');
  const handle = firstRow.locator('.drag-handle');
  const top = page.getByRole('menuitem', { name: 'Move to Top', exact: true });
  const bottom = page.getByRole('menuitem', { name: 'Move to Bottom', exact: true });
  await handle.press('Space');
  await expect(handle).toHaveAttribute('aria-pressed', 'true');
  await expect(bottom).toBeHidden();
  await page.keyboard.press('Escape');
  await expect(handle).not.toHaveAttribute('aria-pressed', 'true');
  expect(writes).toEqual([]);

  await handle.click({ button: 'right' });
  await expect(top).toBeDisabled();
  await bottom.click();
  await expect(secondRow.getByRole('button', { name: 'Actions for Show to watch', exact: true })).toBeVisible();
  await expect(firstRow.getByRole('button', { name: 'Actions for Second show', exact: true })).toBeVisible();
  expect(writes.map(({ method, path, section, body }) => [method, path, section, body.items.map(item => item.uid)]))
    .toEqual([['PUT', '/api/v1' + folder, '0', ['another-item', 'tonight-item']]]);
});
