import { expect, test } from '@playwright/test';

test.use({ serviceWorkers: 'block' });

async function enterSibling(page, path) {
  await page.evaluate(path => {
    history.pushState({ idx: (history.state?.idx ?? 0) + 1, key: 'sibling-fixture', usr: null }, '', path);
    dispatchEvent(new PopStateEvent('popstate', { state: history.state }));
  }, path);
}

for (const editor of [
  { resource: 'members', label: 'Display Name', identity: 'username', fieldValue: id => 'Name ' + id,
    record: id => ({ member: { username: id, display_name: 'Name ' + id, email: id + '@example.invalid', type: 'family_member' } }) },
  { resource: 'devices', label: 'fixtureField', identity: 'id', fieldValue: id => 'Field ' + id,
    record: id => ({ device: { id, type: 'linux-pc', os_control: { fixtureField: 'Field ' + id } } }) },
]) {
  for (const outcome of ['success', 'failure']) {
    test(editor.resource + ' keeps the current draft and save target after a previous read settles with ' + outcome, async ({ page }) => {
      const routeRoot = '/admin/household/' + editor.resource + '/';
      const apiRoot = '/api/v1' + routeRoot;
      let previousRead;
      let currentReads = 0;
      const writes = [];
      await page.routeWebSocket('**/*', () => {});
      await page.route('**/api/**', route => {
        const request = route.request();
        const path = new URL(request.url()).pathname;
        if (path.startsWith(apiRoot) && request.method() === 'PUT') {
          writes.push({ path, body: request.postDataJSON() });
          return route.fulfill({ json: { ok: true } });
        }
        if (path === apiRoot + 'alpha') {
          previousRead = route;
          return;
        }
        if (path === apiRoot + 'beta') {
          currentReads++;
          return route.fulfill({ json: editor.record('beta') });
        }
        return route.fulfill({ json: path.endsWith('/supervision/bootstrap') ? { enabled: false } : {} });
      });

      await page.goto(routeRoot + 'beta');
      const field = page.getByLabel(editor.label, { exact: true });
      await expect(field).toHaveValue(editor.fieldValue('beta'));
      // Seed a sibling entry on the same document so native Back changes the
      // entity parameter without visiting the list index or reloading the app.
      await enterSibling(page, routeRoot + 'alpha');
      await expect.poll(() => Boolean(previousRead)).toBe(true);
      await page.goBack();
      await expect(page).toHaveURL(new RegExp(routeRoot + 'beta$'));
      await expect.poll(() => currentReads).toBe(2);
      await expect(field).toHaveValue(editor.fieldValue('beta'));
      await field.fill('Beta draft');

      // The response can also be aborted when a future reader disposes Alpha.
      if (!previousRead.request().failure()) {
        const completed = page.waitForResponse(response => response.request() === previousRead.request());
        await previousRead.fulfill(outcome === 'success'
          ? { json: editor.record('alpha') }
          : { status: 503, json: { error: 'Previous record unavailable' } });
        await (await completed).finished();
      }
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));

      await expect(field).toHaveValue('Beta draft');
      await expect(page.getByRole('alert').filter({ hasText: /previous record unavailable|503/i })).toHaveCount(0);
      await page.getByTestId('config-save-button').click();
      await expect.poll(() => writes.length).toBe(1);
      expect(writes[0].path).toBe(apiRoot + 'beta');
      expect(writes[0].body[editor.identity]).toBe('beta');
      if (editor.resource === 'members') {
        expect(writes[0].body).toMatchObject({ display_name: 'Beta draft', email: 'beta@example.invalid' });
      } else {
        expect(writes[0].body.os_control.fixtureField).toBe('Beta draft');
      }
    });
  }

  test(editor.resource + ' hides the previous record and its save action when the new read fails', async ({ page }) => {
    const root = '/admin/household/' + editor.resource + '/';
    let pending;
    const writes = [];
    await page.routeWebSocket('**/*', () => {});
    await page.route('**/api/**', route => {
      const path = new URL(route.request().url()).pathname;
      if (route.request().method() === 'PUT') writes.push(path);
      if (path === '/api/v1' + root + 'alpha') return route.fulfill({ json: editor.record('alpha') });
      if (path === '/api/v1' + root + 'beta') { pending = route; return; }
      return route.fulfill({ json: path.endsWith('/supervision/bootstrap') ? { enabled: false } : {} });
    });
    await page.goto(root + 'alpha');
    const field = page.getByLabel(editor.label, { exact: true });
    await expect(field).toHaveValue(editor.fieldValue('alpha'));
    await enterSibling(page, root + 'beta');
    await expect.poll(() => Boolean(pending)).toBe(true);
    await pending.fulfill({ status: 404, json: { error: 'Beta unavailable' } });
    await expect(page.getByRole('alert')).toContainText(/Beta unavailable|404/i);
    await expect(field).toHaveCount(0);
    await expect(page.getByTestId('config-save-button')).toHaveCount(0);
    expect(writes).toEqual([]);
  });
}

for (const leave of [false, true]) {
  test('device delete completion ' + (leave ? 'keeps the replacement editor open' : 'returns the current editor to the index'), async ({ page }) => {
    const root = '/admin/household/devices';
    const api = '/api/v1' + root;
    let pendingDelete;
    const deletes = [];
    await page.routeWebSocket('**/*', () => {});
    await page.route('**/api/**', route => {
      const path = new URL(route.request().url()).pathname;
      if (route.request().method() === 'DELETE') {
        deletes.push(path);
        pendingDelete = route;
        return;
      }
      if (path.startsWith(api + '/')) {
        const id = path.slice(api.length + 1);
        return route.fulfill({ json: { device: { id, type: 'linux-pc', os_control: { fixtureField: id } } } });
      }
      if (path === api) return route.fulfill({ json: { devices: [] } });
      return route.fulfill({ json: path.endsWith('/supervision/bootstrap') ? { enabled: false } : {} });
    });
    await page.goto(root + '/alpha');
    await page.getByRole('button', { name: 'Delete', exact: true }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Delete', exact: true }).click();
    await expect.poll(() => Boolean(pendingDelete)).toBe(true);
    if (leave) {
      await enterSibling(page, root + '/beta');
      await expect(page.getByLabel('fixtureField')).toHaveValue('beta');
    }
    const completion = page.waitForResponse(response => response.request() === pendingDelete.request());
    await pendingDelete.fulfill({ json: { ok: true } });
    await (await completion).finished();
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await expect(page).toHaveURL(new RegExp(root + (leave ? '/beta' : '') + '$'));
    if (leave) await expect(page.getByLabel('fixtureField')).toHaveValue('beta');
    expect(deletes).toEqual([api + '/alpha']);
  });
}

test('a previous member’s successful invite stays out of the current member’s Auth tab', async ({ page }) => {
  const root = '/admin/household/members/';
  let pending;
  const invited = [];
  await page.routeWebSocket('**/*', () => {});
  await page.route('**/api/**', route => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/v1/auth/invite') {
      invited.push(route.request().postDataJSON());
      pending = route;
      return;
    }
    if (path.startsWith('/api/v1' + root)) {
      const username = path.split('/').pop();
      return route.fulfill({ json: { member: { username, display_name: username } } });
    }
    return route.fulfill({ json: path.endsWith('/supervision/bootstrap') ? { enabled: false } : {} });
  });
  await page.goto(root + 'alpha');
  await page.getByRole('tab', { name: 'Auth' }).click();
  await page.getByRole('button', { name: 'Generate Invite Link' }).click();
  await expect.poll(() => Boolean(pending)).toBe(true);
  await enterSibling(page, root + 'beta');
  await expect(page.locator('.ds-action-bar')).toContainText('beta');
  await page.getByRole('tab', { name: 'Auth' }).click();
  const completion = page.waitForResponse(response => response.request() === pending.request());
  await pending.fulfill({ json: { inviteUrl: '/invite/alpha-fixture' } });
  await (await completion).finished();
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await expect(page.getByLabel('Invite URL')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Generate Invite Link' })).toBeEnabled();
  expect(invited).toEqual([{ username: 'alpha' }]);
});
