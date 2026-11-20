import { expect, test } from '@playwright/test';

test.use({ serviceWorkers: 'block', viewport: { width: 1440, height: 850 } });

const listRoute = '/admin/content/lists/menus/source-fixture';
const listPath = `/api/v1${listRoute}`;
const adminList = { name: 'source-fixture', sections: [
  { items: [{ uid: 'fixture', label: 'Catalog source', action: 'Play', input: 'plex:123' }] },
] };
const searchPath = '/api/v1/content/query/search';
const result = (id, title) => ({ id, title, source: 'plex', itemType: 'leaf', metadata: { type: 'movie' }, childCount: 0 });

test.beforeEach(async ({ page, baseURL }) => {
  const origin = new URL(baseURL).origin;
  await page.addInitScript(() => { window.EventSource = undefined; });
  await page.context().route('**/*', route => (
    new URL(route.request().url()).origin === origin ? route.fallback() : route.abort()
  ));
  await page.routeWebSocket('**/*', () => {});
});

test('Admin Content picker retires batch searches on typing and Escape', async ({ page }) => {
  const expansionPath = '/api/v1/list/plex/series%2Fone%3Aseason/expand';
  const expansionReads = [];
  let expansionRoute;
  const held = new Map();
  const canceled = [];
  const reads = [];
  page.on('requestfailed', request => {
    if (expansionRoute?.request() === request) canceled.push('container expansion');
    const text = new URL(request.url()).searchParams.get('text');
    if (held.get(text)?.request() === request) canceled.push(text);
  });
  await page.route('**/api/**', route => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.pathname === listPath) return route.fulfill({ json: adminList });
    if (url.pathname === expansionPath) {
      expansionReads.push([request.method(), request.postData()]);
      expansionRoute = route;
      return;
    }
    if (url.pathname === searchPath) {
      const text = url.searchParams.get('text');
      reads.push([request.method(), text, url.searchParams.get('take')]);
      if (text === 'Container query') {
        return route.fulfill({ json: { items: [{
          id: 'plex:series/one:season', title: 'Fixture series', source: 'plex', itemType: 'container', childCount: 1,
        }] } });
      }
      if (text !== 'New query') {
        held.set(text, route);
        return;
      }
      return route.fulfill({ json: { items: [result('plex:2', 'New result')] } });
    }
    if (url.pathname.endsWith('/content/sources')) return route.fulfill({ json: { sources: ['plex'] } });
    return route.fulfill({ json: url.pathname.endsWith('/supervision/bootstrap') ? { enabled: false } : {} });
  });

  await page.goto(listRoute);
  const row = page.getByTestId('item-row-0-0');
  await row.locator('.col-input .content-display').click();
  const editor = row.getByRole('textbox', { name: 'Search content...' });
  await editor.fill('Old query');
  await expect.poll(() => held.has('Old query')).toBe(true);
  await editor.fill('New query');
  const fresh = page.getByTestId('combobox-option-plex:2');
  await expect(fresh).toBeVisible();
  await expect.poll(() => canceled).toEqual(['Old query']);
  await held.get('Old query').fulfill({ json: { items: [result('plex:1', 'Old result')] } }).catch(() => {});
  await expect(fresh).toBeVisible();
  await expect(page.getByTestId('combobox-option-plex:1')).toHaveCount(0);
  await expect(editor).toHaveValue('New query');

  await editor.fill('Closing query');
  await expect.poll(() => held.has('Closing query')).toBe(true);
  await editor.press('Escape');
  await expect(page.getByRole('listbox')).toBeHidden();
  await expect.poll(() => canceled).toEqual(['Old query', 'Closing query']);
  await row.locator('.col-input .content-display').click();
  await editor.fill('Container query');
  await page.getByRole('button', { name: 'Browse into Fixture series', exact: true }).click();
  await expect.poll(() => expansionReads).toEqual([['GET', null]]);
  await editor.press('Escape');
  await expect.poll(() => canceled).toEqual(['Old query', 'Closing query', 'container expansion']);
  await expansionRoute.fulfill({ json: { items: [result('plex:stale', 'Stale child')] } }).catch(() => {});
  await expect(page.getByRole('listbox')).toBeHidden();
  expect(reads).toEqual([
    ['GET', 'Old query', '20'], ['GET', 'New query', '20'], ['GET', 'Closing query', '20'], ['GET', 'Container query', '20'],
  ]);
});

test('Admin dismisses pending picker pagination and can page on reopening', async ({ page }) => {
  const siblingsPath = '/api/v1/siblings/plex/123';
  const pageReads = [];
  const canceled = [];
  let pendingPage;
  page.on('requestfailed', request => {
    if (request === pendingPage?.request()) canceled.push(request.url());
  });
  await page.route('**/api/**', route => {
    const request = route.request();
    const { pathname, search } = new URL(request.url());
    if (pathname === listPath) return route.fulfill({ json: adminList });
    if (pathname === siblingsPath && !search) {
      return route.fulfill({ json: {
        items: Array.from({ length: 21 }, (_, i) => result(`plex:${123 + i}`, `Title ${i + 1}`)),
        pagination: { offset: 0, window: 21, total: 22, hasBefore: false, hasAfter: true },
        referenceIndex: 0,
      } });
    }
    if (pathname === siblingsPath) {
      pageReads.push([request.method(), search, request.postData()]);
      if (pageReads.length === 1) {
        pendingPage = route;
        return;
      }
      return route.fulfill({ json: { items: [result('plex:144', 'Current additional title')] } });
    }
    if (pathname.endsWith('/content/sources')) return route.fulfill({ json: { sources: ['plex'] } });
    return route.fulfill({ json: pathname.endsWith('/supervision/bootstrap') ? { enabled: false } : {} });
  });

  await page.goto(listRoute);
  const row = page.getByTestId('item-row-0-0');
  const editor = row.getByRole('textbox', { name: 'Search content...' });
  const display = row.locator('.col-input .content-display');
  const lastTitle = page.getByTestId('combobox-option-plex:143');
  const pageRequest = ['GET', '?offset=21&limit=21', null];

  await display.click();
  await lastTitle.scrollIntoViewIfNeeded();
  await expect.poll(() => pageReads).toEqual([pageRequest]);
  await editor.press('Escape');
  await expect.poll(() => canceled).toEqual([pendingPage.request().url()]);
  await pendingPage.fulfill({ json: { items: [result('plex:old', 'Retired additional title')] } }).catch(() => {});
  await expect(page.getByRole('listbox')).toBeHidden();

  await display.click();
  await lastTitle.scrollIntoViewIfNeeded();
  await expect(page.getByTestId('combobox-option-plex:144')).toBeVisible();
  await expect(page.getByTestId('combobox-option-plex:old')).toHaveCount(0);
  expect(pageReads).toEqual([pageRequest, pageRequest]);
});

test('Media Content picker retires a prior scope and does not search again when Escape resets the scope', async ({ page }) => {
  const reads = [];
  const canceled = [];
  const held = new Map();
  await page.clock.install();
  page.on('requestfailed', request => {
    const text = new URL(request.url()).searchParams.get('text');
    if (held.get(text)?.request() === request) canceled.push(text);
  });
  await page.route('**/api/**', route => {
    const url = new URL(route.request().url());
    if (url.pathname === '/api/v1/media/config') return route.fulfill({ json: { browse: [], searchScopes: [
      { key: 'all', label: 'All', params: '' }, { key: 'plex', label: 'Plex', params: 'source=plex' },
    ] } });
    if (url.pathname === searchPath) {
      const text = url.searchParams.get('text');
      const scope = url.searchParams.get('source');
      reads.push([text, scope]);
      if (text === 'Shared query' && scope === 'plex') {
        return route.fulfill({ json: { items: [result('plex:4', 'Scoped result')] } });
      }
      held.set(text, route);
      return;
    }
    return route.fulfill({ json: url.pathname.endsWith('/supervision/bootstrap') ? { enabled: false } : {} });
  });
  await page.goto('/media');
  await page.getByTestId('app-nav-browse').click();
  const editor = page.getByRole('textbox', { name: 'Search media…', exact: true });
  await editor.fill('Shared query');
  await expect.poll(() => held.has('Shared query')).toBe(true);
  await page.getByTestId('scope-chip-plex').click();
  await expect(page.getByTestId('combobox-option-plex:4')).toBeVisible();
  await expect.poll(() => canceled).toEqual(['Shared query']);

  await editor.fill('Closing media');
  await expect.poll(() => held.has('Closing media')).toBe(true);
  await editor.press('Escape');
  await expect(page.getByRole('listbox')).toBeHidden();
  await expect(page.getByTestId('scope-chip-all')).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(() => canceled).toEqual(['Shared query', 'Closing media']);
  await page.clock.fastForward(500);
  expect(reads).toEqual([['Shared query', null], ['Shared query', 'plex'], ['Closing media', 'plex']]);
});
