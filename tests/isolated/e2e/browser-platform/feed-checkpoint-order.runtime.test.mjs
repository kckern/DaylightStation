import { expect, test } from '@playwright/test';

test.use({ serviceWorkers: 'block' });

test('rapid Reader visits keep the latest local visit while earlier checkpoint writes finish', async ({ page }) => {
  await page.routeWebSocket('**/*', () => {});
  const writes = [];
  await page.route('**/api/**', route => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/workspace/checkpoints/reader')) {
      writes.push(route);
      return;
    }
    const json = path.endsWith('/supervision/bootstrap') ? { enabled: false }
      : path.endsWith('/workspace') ? { preferencesStored: true }
      : path.endsWith('/reader/feeds') ? []
        : path.endsWith('/reader/stream') ? { items: [], exhausted: true } : {};
    return route.fulfill({ json });
  });
  await page.goto('/feed/reader');
  await expect.poll(() => writes.length).toBe(1);
  await page.getByRole('link', { name: 'Headlines', exact: true }).click();
  await page.getByRole('link', { name: 'Reader', exact: true }).click();
  const localVisit = () => page.evaluate(() => localStorage.getItem('feed:last-visit:reader'));
  await expect.poll(localVisit).not.toBe(writes[0].request().postDataJSON().visitedAt);
  const latest = await localVisit();
  expect(writes).toHaveLength(1);
  for (let index = 0; index < 2; index++) {
    await writes[index].fulfill({ json: { checkpoint: { visitedAt: '2020-01-01T00:00:00Z' } } });
    await expect.poll(() => writes.length).toBe(index + 2);
    expect(await localVisit()).toBe(latest);
  }
  expect(writes[2].request().postDataJSON().visitedAt).toBe(latest);
  const confirmed = '2026-11-19T21:31:01.000Z';
  await writes[2].fulfill({ json: { checkpoint: { visitedAt: confirmed } } });
  await expect.poll(localVisit).toBe(confirmed);
});

test('accepting an invite in another tab replaces the open Reader workspace and retires its checkpoint', async ({ page, context }) => {
  const token = name => 'header.' + Buffer.from(JSON.stringify({ sub: name })).toString('base64url') + '.signature';
  const workspaces = [];
  const writes = [];
  let amyWrite;
  await context.routeWebSocket('**/*', () => {});
  await context.route('**/api/**', route => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const owner = request.headers().authorization === 'Bearer ' + token('bob') ? 'bob' : 'amy';
    let json = {};
    if (path.endsWith('/supervision/bootstrap')) json = { enabled: false };
    if (path.endsWith('/workspace')) {
      workspaces.push(owner);
      json = { preferencesStored: true };
    }
    if (path.endsWith('/reader/feeds')) json = [];
    if (path.endsWith('/reader/stream')) {
      const id = owner + '-item';
      json = { items: [{ id, stateKey: id, title: owner + ' story', published: '2026-07-01' }], exhausted: true };
    }
    if (path.endsWith('/auth/invite/bob')) json = { username: 'bob' };
    if (path.endsWith('/invite/bob/accept')) json = { token: token('bob') };
    if (path.endsWith('/checkpoints/reader')) {
      writes.push({ owner, position: request.postDataJSON() });
      if (owner === 'amy') { amyWrite = route; return; }
    }
    return route.fulfill({ json });
  });
  await page.addInitScript(amy => { if (!localStorage.getItem('ds_token')) localStorage.setItem('ds_token', amy); }, token('amy'));
  await page.goto('/feed/reader');
  await expect(page.getByText('amy story', { exact: true })).toBeVisible();
  await expect.poll(() => Boolean(amyWrite)).toBe(true);
  const invite = await context.newPage();
  await invite.goto('/invite/bob');
  await invite.getByLabel('Password', { exact: true }).fill('test-password');
  await invite.getByLabel('Confirm Password', { exact: true }).fill('test-password');
  await invite.getByRole('button', { name: 'Create Account' }).click();
  await expect(invite).not.toHaveURL(/\/invite\//);
  await expect(page.getByText('bob story', { exact: true })).toBeVisible();
  await expect(page.getByText('amy story', { exact: true })).toHaveCount(0);
  expect(workspaces).toEqual(['amy', 'bob']);
  await expect.poll(() => writes.some(row => row.owner === 'bob')).toBe(true);
  const lastVisit = () => page.evaluate(() => localStorage.getItem('feed:last-visit:reader'));
  const bobVisit = await lastVisit();
  const completed = page.waitForEvent('requestfinished', request => request === amyWrite.request());
  await amyWrite.fulfill({ json: { checkpoint: { visitedAt: 'retired Amy visit' } } });
  await completed;
  expect(await lastVisit()).toBe(bobVisit);
  await page.getByRole('link', { name: 'Headlines', exact: true }).click();
  await expect.poll(() => writes.filter(row => row.owner === 'bob').map(row => row.position.itemId)).toEqual([null, 'bob-item']);
});
