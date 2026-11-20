import { expect, test } from '@playwright/test';

test.use({ serviceWorkers: 'block' });

const token = owner => 'header.' + Buffer.from(JSON.stringify({ sub: owner })).toString('base64url') + '.signature';
const format = 'daylight.feed-export/v1';

async function installPortableDataFixture(page, context) {
  const exports = [];
  const imports = [];
  const workspaces = [];
  let heldExport;
  await context.routeWebSocket('**/*', () => {});
  await context.route('**/api/**', route => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const owner = request.headers().authorization === 'Bearer ' + token('bob') ? 'bob' : 'amy';
    if (path.endsWith('/supervision/bootstrap')) return route.fulfill({ json: { enabled: false } });
    if (path.endsWith('/auth/invite/bob')) return route.fulfill({ json: { username: 'bob' } });
    if (path.endsWith('/invite/bob/accept')) return route.fulfill({ json: { token: token('bob') } });
    if (path.endsWith('/workspace')) {
      workspaces.push(owner);
      return route.fulfill({ json: { preferencesStored: true } });
    }
    if (path.endsWith('/reader/feeds')) return route.fulfill({ json: [] });
    if (path.endsWith('/reader/stream')) {
      return route.fulfill({ json: { items: [{ id: owner, title: owner + ' story', published: '2026-07-01' }], exhausted: true } });
    }
    if (path.endsWith('/data/export')) {
      exports.push(owner);
      if (owner === 'amy') {
        heldExport = route;
        return;
      }
      return route.fulfill({ json: { format, owner } });
    }
    if (path.endsWith('/data/import')) {
      imports.push({ owner, file: request.postDataJSON() });
      return route.fulfill({ json: { imported: { items: 1 } } });
    }
    return route.fulfill({ json: {} });
  });
  await page.addInitScript(amy => {
    if (!localStorage.getItem('ds_token')) localStorage.setItem('ds_token', amy);
  }, token('amy'));

  const switchAccount = async () => {
    const invite = await context.newPage();
    await invite.goto('/invite/bob');
    await invite.getByLabel('Password', { exact: true }).fill('test-password');
    await invite.getByLabel('Confirm Password', { exact: true }).fill('test-password');
    await invite.getByRole('button', { name: 'Create Account' }).click();
    await expect(invite).not.toHaveURL(/\/invite\//);
    await expect(page.getByText('bob story', { exact: true })).toBeVisible();
    await invite.close();
  };
  const openSettings = () => page.getByLabel('Reading appearance').click();
  return { exports, imports, workspaces, heldExport: () => heldExport, switchAccount, openSettings };
}

test('Feed retires an old account export and still downloads the current account file', async ({ page, context }) => {
  const fixture = await installPortableDataFixture(page, context);
  const downloads = [];
  const failed = [];
  page.on('download', download => downloads.push(download));
  page.on('requestfailed', request => failed.push(request));
  await page.goto('/feed/reader');
  await expect(page.getByText('amy story', { exact: true })).toBeVisible();
  await fixture.openSettings();
  await page.getByRole('button', { name: 'Export', exact: true }).click();
  await expect.poll(() => Boolean(fixture.heldExport())).toBe(true);

  await fixture.switchAccount();
  const old = fixture.heldExport();
  if (!failed.includes(old.request())) {
    const finished = page.waitForEvent('requestfinished', request => request === old.request());
    await old.fulfill({ json: { format, owner: 'amy' } });
    await finished;
  }
  await fixture.openSettings();
  const downloaded = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export', exact: true }).click();
  const current = await downloaded;
  await expect(page.getByRole('status').getByText('Export downloaded.', { exact: true })).toBeVisible();
  const stream = await current.createReadStream();
  const content = [];
  for await (const chunk of stream) content.push(chunk);
  expect(JSON.parse(Buffer.concat(content).toString())).toEqual({ format, owner: 'bob' });
  expect(downloads).toEqual([current]);
  expect(current.suggestedFilename()).toMatch(/^daylight-feed-\d{4}-\d{2}-\d{2}\.json$/);
  expect(failed).toContain(old.request());
  expect(fixture.exports).toEqual(['amy', 'bob']);
});

test('Feed discards a file parsed after account replacement without sending it as the new owner', async ({ page, context }) => {
  const fixture = await installPortableDataFixture(page, context);
  await page.addInitScript(() => {
    const original = File.prototype.text;
    File.prototype.text = function () {
      if (this.name !== 'held-feed.json') return original.call(this);
      return new Promise(resolve => {
        window.releasePortableFile = async () => resolve(await original.call(this));
      });
    };
  });
  await page.goto('/feed/reader');
  await expect(page.getByText('amy story', { exact: true })).toBeVisible();
  await fixture.openSettings();
  const input = page.locator('.feed-data-controls input[type="file"]');
  const upload = (name, owner) => input.setInputFiles({
    name, mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ format, owner })),
  });
  await upload('held-feed.json', 'amy');
  await expect.poll(() => page.evaluate(() => typeof window.releasePortableFile)).toBe('function');
  await fixture.switchAccount();
  await page.evaluate(async () => {
    await window.releasePortableFile();
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  });
  await fixture.openSettings();
  await upload('current-feed.json', 'bob');
  await expect(page.getByRole('status').getByText('Imported 1 items, 0 states, and 0 notes.', { exact: true })).toBeVisible();
  await expect.poll(() => fixture.workspaces).toEqual(['amy', 'bob', 'bob']);
  expect(fixture.imports).toEqual([{ owner: 'bob', file: { format, owner: 'bob' } }]);
});
