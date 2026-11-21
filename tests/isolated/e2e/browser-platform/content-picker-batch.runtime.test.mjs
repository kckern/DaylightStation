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

for (const reducedMotion of ['reduce', 'no-preference']) {
  test(`Admin picker honors ${reducedMotion} when revealing the keyboard highlight`, async ({ page }) => {
    await page.emulateMedia({ reducedMotion });
    await page.addInitScript(() => {
      window.catalogWrapFlashes = [];
      document.addEventListener('animationstart', event => {
        if (event.animationName === 'ccb-wrap-flash') window.catalogWrapFlashes.push(event.target.dataset.testid);
      });
    });
    await page.route('**/api/**', route => {
      const { pathname } = new URL(route.request().url());
      if (pathname === listPath) return route.fulfill({ json: adminList });
      if (pathname === searchPath) {
        return route.fulfill({ json: { items: Array.from({ length: 16 }, (_, i) =>
          result(`plex:${i + 1}`, `Keyboard result ${i + 1}`)) } });
      }
      return route.fulfill({ json: pathname.endsWith('/supervision/bootstrap') ? { enabled: false } : {} });
    });

    await page.goto(listRoute);
    const row = page.getByTestId('item-row-0-0');
    await row.locator('.col-input .content-display').click();
    const editor = row.getByRole('textbox', { name: 'Search content...' });
    await editor.fill('keyboard results');
    const first = page.getByTestId('combobox-option-plex:1');
    const second = page.getByTestId('combobox-option-plex:2');
    const last = page.getByTestId('combobox-option-plex:16');
    const viewport = page.locator('.content-combobox-scroll .mantine-ScrollArea-viewport');
    await expect(first).toBeVisible();

    await editor.press('ArrowDown');
    await expect(first).toHaveAttribute('data-highlighted', 'true');
    await editor.press('ArrowUp');
    await expect(last).toHaveAttribute('data-highlighted', 'true');
    await expect(last).toBeInViewport();
    const flash = reducedMotion === 'reduce' ? 'none' : 'ccb-wrap-flash';
    await expect(last).toHaveCSS('animation-name', flash);
    const painted = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await painted();
    await editor.press('ArrowDown');
    await expect(first).toHaveAttribute('data-highlighted', 'true');
    await expect(first).toBeInViewport();
    await expect(first).toHaveCSS('animation-name', flash);
    await expect(last).toHaveCSS('animation-name', 'none');
    await painted();
    const flashes = await page.evaluate(() => window.catalogWrapFlashes);
    expect(flashes).toEqual(reducedMotion === 'reduce' ? [] : ['combobox-option-plex:16', 'combobox-option-plex:1']);
    await expect(first).not.toHaveClass(/wrap-flash/);

    await page.clock.install({ time: new Date('2026-11-20T17:00:00Z') });
    await page.clock.pauseAt(new Date('2026-11-20T17:00:01Z'));
    const scrollTop = () => viewport.evaluate(element => element.scrollTop);
    const bottom = await viewport.evaluate(element => {
      element.scrollTop = element.scrollHeight;
      return element.scrollTop;
    });
    expect(bottom).toBeGreaterThan(0);
    await editor.press('ArrowDown');
    await expect(second).toHaveAttribute('data-highlighted', 'true');
    if (reducedMotion === 'no-preference') {
      expect(await scrollTop()).toBe(bottom);
      await page.clock.runFor(32);
      const duringScroll = await scrollTop();
      expect(duringScroll).toBeGreaterThan(0);
      expect(duringScroll).toBeLessThan(bottom);
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await page.clock.runFor(17);
    }
    await expect.poll(scrollTop).toBe(0);
    await expect(second).toBeInViewport();
  });
}

test('Admin picker reveals a late-layout item and clears a canceled wrap animation', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  const tracks = (first, count) => Array.from({ length: count }, (_, index) =>
    result('plex:' + (first + index), 'Track ' + (first + index))
  );
  await page.route('**/api/**', route => {
    const { pathname } = new URL(route.request().url());
    if (pathname === listPath) {
      const [section] = adminList.sections;
      return route.fulfill({ json: { ...adminList, sections: [{ items: [{ ...section.items[0], input: 'plex:71' }] }] } });
    }
    if (pathname === '/api/v1/siblings/plex/71') {
      return route.fulfill({ json: { items: tracks(61, 21), referenceIndex: 10 } });
    }
    if (pathname === searchPath) return route.fulfill({ json: { items: tracks(1, 16) } });
    return route.fulfill({ json: pathname.endsWith('/supervision/bootstrap') ? { enabled: false } : {} });
  });

  await page.goto(listRoute);
  const row = page.getByTestId('item-row-0-0');
  const opener = row.locator('.col-input .content-display');
  await expect(opener).toBeVisible();
  await page.evaluate(() => {
    const selector = '[data-testid="combobox-option-plex:71"]';
    const style = document.createElement('style');
    style.textContent = selector + '{display:none !important}';
    document.head.append(style);
    window.hiddenPickerHeights = [];
    const watcher = new MutationObserver(() => {
      const option = document.querySelector(selector);
      if (!option) return;
      watcher.disconnect();
      function sample() {
        window.hiddenPickerHeights.push(option.offsetHeight);
        if (window.hiddenPickerHeights.length === 3) style.remove();
        else requestAnimationFrame(sample);
      }
      requestAnimationFrame(sample);
    });
    watcher.observe(document.body, { childList: true, subtree: true });
  });
  await opener.click();
  await expect.poll(() => page.evaluate(() => window.hiddenPickerHeights)).toEqual([0, 0, 0]);
  await expect(page.getByTestId('combobox-option-plex:71')).toBeInViewport();
  const viewport = page.locator('.content-combobox-scroll .mantine-ScrollArea-viewport');
  expect(await viewport.evaluate(element => element.scrollTop)).toBeGreaterThan(80);

  await page.evaluate(() => {
    window.pickerWrapEvents = [];
    document.addEventListener('animationstart', event => {
      if (event.animationName !== 'ccb-wrap-flash') return;
      window.pickerWrapEvents.push('animationstart');
      event.target.getAnimations().find(animation => animation.animationName === event.animationName)?.cancel();
    });
    for (const type of ['animationcancel', 'animationend']) {
      document.addEventListener(type, event => {
        if (event.animationName === 'ccb-wrap-flash') window.pickerWrapEvents.push(type);
      });
    }
  });
  const editor = row.getByRole('textbox', { name: 'Search content...' });
  await editor.fill('keyboard results');
  const first = page.getByTestId('combobox-option-plex:1');
  const last = page.getByTestId('combobox-option-plex:16');
  await expect(first).toBeVisible();
  await editor.press('ArrowDown');
  await expect(first).toHaveAttribute('data-highlighted', 'true');
  await editor.press('ArrowUp');
  await expect.poll(() => page.evaluate(() => window.pickerWrapEvents)).toEqual(['animationstart', 'animationcancel']);
  await expect(last).not.toHaveClass(/wrap-flash/);
  await expect(last).toHaveAttribute('data-highlighted', 'true');
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

for (const width of [390, 1440]) {
  test(`Admin keeps the latest viewport when a previous picker page arrives at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 850 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const siblingsPath = '/api/v1/siblings/plex/71';
    const previousPage = '?offset=19&limit=21';
    const olderPage = '?offset=0&limit=19';
    const pageReads = [];
    const held = Promise.withResolvers();
    const refused = Promise.withResolvers();
    const tracks = first => Array.from({ length: 21 }, (_, index) => result(`plex:${first + index}`, `Track ${first + index}`));
    await page.route('**/api/**', route => {
      const request = route.request();
      const { pathname, search } = new URL(request.url());
      if (pathname === listPath) {
        const [section] = adminList.sections;
        return route.fulfill({ json: { ...adminList, sections: [{ items: [{ ...section.items[0], input: 'plex:71' }] }] } });
      }
      if (pathname === siblingsPath && !search) {
        return route.fulfill({ json: {
          items: tracks(61), referenceIndex: 10,
          pagination: { offset: 40, window: 21, total: 61, hasBefore: true, hasAfter: false },
        } });
      }
      if (pathname === siblingsPath) {
        pageReads.push([request.method(), search]);
        if (search === previousPage && pageReads.length === 1) {
          held.resolve(route);
          return;
        }
        if (search === olderPage && pageReads.length === 2) {
          refused.resolve(route);
          return;
        }
      }
      return route.fulfill({ json: pathname.endsWith('/supervision/bootstrap') ? { enabled: false } : {} });
    });

    await page.goto(listRoute);
    const row = page.getByTestId('item-row-0-0');
    const editor = row.getByRole('textbox', { name: 'Search content...' });
    await row.locator('.col-input .content-display').click();
    const viewport = page.locator('.content-combobox-scroll .mantine-ScrollArea-viewport');
    const scrollTop = () => viewport.evaluate(element => element.scrollTop);
    const current = page.getByTestId('combobox-option-plex:71');
    const anchor = page.getByTestId('combobox-option-plex:72');
    const anchorTop = (option = anchor) => option.evaluate(element =>
      element.getBoundingClientRect().top - element.closest('.mantine-ScrollArea-viewport').getBoundingClientRect().top);
    await expect(current).toBeInViewport();
    await expect.poll(scrollTop).toBeGreaterThan(80);

    const first = page.getByTestId('combobox-option-plex:61');
    const pageLoader = page.getByRole('status', { name: 'Loading more items' });
    const beforeLoading = await first.evaluate(element => {
      const viewport = element.closest('.mantine-ScrollArea-viewport');
      viewport.scrollTop = 20;
      return element.getBoundingClientRect().top - viewport.getBoundingClientRect().top;
    });
    await expect.poll(() => pageReads).toEqual([['GET', previousPage]]);
    await expect(pageLoader).toBeVisible();
    await expect.poll(async () => Math.abs(await anchorTop(first) - beforeLoading)).toBeLessThan(1);
    const previous = await held.promise;
    const bottom = await viewport.evaluate(element => {
      element.scrollTop = element.scrollHeight;
      return element.scrollTop;
    });
    await editor.press('ArrowDown');
    await expect(anchor).toHaveAttribute('data-highlighted', 'true');
    await expect.poll(scrollTop, { message: 'Arrow navigation should reveal the row while the page is pending' }).toBeLessThan(bottom);

    const before = await anchorTop();
    await previous.fulfill({ json: { items: tracks(40) } });
    await expect(page.getByTestId('combobox-option-plex:40')).toBeAttached();
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(resolve)))));
    await expect.poll(async () => Math.abs(await anchorTop() - before)).toBeLessThan(1);
    await expect(anchor).toHaveAttribute('data-highlighted', 'true');
    expect(pageReads).toEqual([['GET', previousPage]]);

    await viewport.evaluate(element => { element.scrollTop = 20; });
    await expect.poll(() => pageReads).toEqual([['GET', previousPage], ['GET', olderPage]]);
    const failure = await refused.promise;
    await expect(pageLoader).toBeAttached();
    await viewport.evaluate(element => { element.scrollTop = 430; });
    const visibleBeforeFailure = page.getByTestId('combobox-option-plex:50');
    await expect(visibleBeforeFailure).toBeInViewport();
    const beforeFailure = await anchorTop(visibleBeforeFailure);
    await failure.fulfill({ status: 503, json: {} });
    await expect(pageLoader).toBeHidden();
    await expect.poll(async () => Math.abs(await anchorTop(visibleBeforeFailure) - beforeFailure)).toBeLessThan(1);
    expect(pageReads).toEqual([['GET', previousPage], ['GET', olderPage]]);
  });
}

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
