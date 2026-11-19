import { expect, test } from '@playwright/test';

test.use({ viewport: { width: 1440, height: 850 }, serviceWorkers: 'block' });

const lounge = { id: 'fleet:lounge', name: 'Lounge TV', room: 'Den', kind: 'screen' };
const tablet = { id: 'browser:tablet', name: 'Kitchen Tablet', kind: 'browser' };

async function openScreenAdmin(page, baseURL) {
  const origin = new URL(baseURL).origin;
  await page.context().route('**/*', route => (
    new URL(route.request().url()).origin === origin ? route.fallback() : route.abort()
  ));
  await page.addInitScript(() => localStorage.setItem('media-app.first-use-done', 'done'));
  await page.routeWebSocket('**/*', () => {});
  const writes = [];
  const lookups = [];
  const aborted = [];
  page.on('requestfailed', request => {
    if (lookups.some(lookup => lookup.request === request)) aborted.push(request);
  });
  await page.route('**/api/**', async route => {
    const request = route.request();
    const path = decodeURIComponent(new URL(request.url()).pathname);
    if (path.endsWith('/supervision/bootstrap')) return route.fulfill({ json: { enabled: false } });
    if (path === '/api/v1/media/screens') return route.fulfill({ json: { screens: [lounge, tablet] } });
    if (path.startsWith('/api/v1/media/screens/') && request.method() !== 'GET') {
      writes.push({ path, method: request.method() });
    }
    if (path.startsWith('/api/v1/media/screens/') && path.endsWith('/routines')) {
      const reply = Promise.withResolvers();
      lookups.push({ path, receive: reply.resolve, request });
      const items = await reply.promise;
      if (aborted.includes(request)) return;
      return route.fulfill({ json: { items } });
    }
    return route.fulfill({ json: {} });
  });
  await page.goto('/media?view=screens');
  return { aborted, lookups, writes };
}

async function deliver(page, lookup, items) {
  const arrived = page.waitForResponse(response => response.request() === lookup.request);
  lookup.receive(items);
  await (await arrived).finished();
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}

test('Media Screen Admin ignores routine lookups from closed or reopened retire dialogs', async ({ page, baseURL }) => {
  const { aborted, lookups, writes } = await openScreenAdmin(page, baseURL);
  const opener = page.getByTestId(`screen-admin-retire-${lounge.id}`);
  const dialog = page.getByRole('dialog', { name: `Retire ${lounge.name}?` });
  await opener.press('Enter');
  await expect(dialog).toBeVisible();
  await expect.poll(() => lookups.length).toBe(1);
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(opener).toBeFocused();
  await expect.poll(() => aborted).toContain(lookups[0].request);

  await opener.press('Enter');
  await expect.poll(() => lookups.length).toBe(2);
  lookups[0].receive([{ id: 'previous', name: 'Previous visit routine' }]);
  await expect(dialog.getByRole('button', { name: 'Checking routines…' })).toBeVisible();
  await expect(dialog.getByText('Previous visit routine')).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect.poll(() => aborted).toContain(lookups[1].request);
  lookups[1].receive([{ id: 'closed', name: 'Closed visit routine' }]);
  await expect(dialog).toHaveCount(0);

  await opener.press('Enter');
  await expect.poll(() => lookups.length).toBe(3);
  await deliver(page, lookups[2], [{ id: 'current', name: 'Current visit routine' }]);
  await expect(dialog.getByText('Current visit routine')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(page).toHaveURL(/view=screens/);
  expect(writes).toEqual([]);
});

test('Media Screen Admin keeps merge routines scoped to the current visit and target selection', async ({ page, baseURL }) => {
  const { aborted, lookups, writes } = await openScreenAdmin(page, baseURL);
  const opener = page.getByTestId(`screen-admin-merge-${tablet.id}`);
  const dialog = page.getByRole('dialog', { name: `Merge ${tablet.name}` });
  const target = dialog.getByRole('radio', { name: `${lounge.name} · ${lounge.room}`, exact: true });
  await opener.press('Enter');
  await target.check();
  await expect.poll(() => lookups.length).toBe(2);
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(opener).toBeFocused();
  await expect.poll(() => aborted).toEqual(expect.arrayContaining(lookups.map(lookup => lookup.request)));

  await opener.press('Enter');
  await target.check();
  await expect.poll(() => lookups.length).toBe(4);
  for (const lookup of lookups.slice(2)) {
    await deliver(page, lookup, [{ id: lookup.path, name: 'Current merge routine' }]);
  }
  await expect(dialog.getByText('Current merge routine')).toHaveCount(2);
  for (const lookup of lookups.slice(0, 2)) {
    lookup.receive([{ id: lookup.path, name: 'Previous merge routine' }]);
  }
  await expect(dialog.getByText('Previous merge routine')).toHaveCount(0);
  await expect(dialog.getByText('Current merge routine')).toHaveCount(2);
  expect(writes).toEqual([]);
});
