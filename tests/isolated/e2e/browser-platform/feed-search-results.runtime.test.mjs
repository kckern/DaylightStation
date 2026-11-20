import { expect, test } from '@playwright/test';

test.use({ serviceWorkers: 'block', viewport: { width: 390, height: 850 } });

for (const cursor of [null, 'page-two']) {
  test(`Feed Search cancels a stalled ${cursor ? 'continuation' : 'first page'} and retries its exact GET`, async ({ page }) => {
    await page.clock.install();
    const reads = [];
    let stalled;
    let canceled = false;
    page.on('requestfailed', request => { if (request === stalled) canceled = true; });
    await page.routeWebSocket('**/*', () => {});
    await page.route('**/api/**', route => {
      const request = route.request();
      const { pathname, searchParams } = new URL(request.url());
      if (pathname.endsWith('/supervision/bootstrap')) return route.fulfill({ json: { enabled: false } });
      if (pathname !== '/api/v1/feed/search') return route.fulfill({ json: {} });
      const requestedCursor = searchParams.get('cursor');
      reads.push([request.method(), searchParams.get('q'), searchParams.get('state'), requestedCursor]);
      if (requestedCursor === cursor && !stalled) {
        stalled = request;
        return;
      }
      if (cursor && !requestedCursor) return route.fulfill({ json: {
        items: [{ id: 'first', title: 'Retained bird' }], nextCursor: cursor, total: 2,
      } });
      return route.fulfill({ json: { items: [{ id: 'recovered', title: 'Recovered bird' }], total: cursor ? 2 : 1 } });
    });

    await page.goto('/feed/search?q=birds&state=saved');
    const retained = page.getByRole('heading', { name: 'Retained bird' });
    if (cursor) {
      await expect(retained).toBeVisible();
      await page.getByRole('button', { name: /Load more/ }).press('Enter');
    }
    await expect.poll(() => Boolean(stalled)).toBe(true);
    await page.clock.fastForward(10_000);
    const failure = page.getByRole('alert').filter({ hasText: 'Search could not be completed.' });
    await expect(failure).toBeVisible();
    await expect.poll(() => canceled).toBe(true);
    if (cursor) await expect(retained).toBeVisible();
    const prefix = cursor ? [['GET', 'birds', 'saved', null]] : [];
    const failedRead = ['GET', 'birds', 'saved', cursor];
    expect(reads).toEqual([...prefix, failedRead]);
    await page.getByRole('button', { name: 'Retry', exact: true }).press('Enter');
    const recovered = page.getByRole('heading', { name: 'Recovered bird' });
    await expect(recovered).toBeVisible();
    if (cursor) await expect(recovered).toBeFocused();
    expect(reads).toEqual([...prefix, failedRead, failedRead]);
  });
}

test('Feed Search retires the old query and cursor during a failed replacement', async ({ page }) => {
  const replacement = Promise.withResolvers();
  const retryRead = Promise.withResolvers();
  const queries = [];
  const item = (id, title) => ({ id, stateKey: id, title });
  await page.routeWebSocket('**/*', () => {});
  await page.route('**/api/**', async route => {
    const { pathname, searchParams } = new URL(route.request().url());
    if (pathname.endsWith('/supervision/bootstrap')) return route.fulfill({ json: { enabled: false } });
    if (pathname !== '/api/v1/feed/search') return route.fulfill({ json: {} });
    const query = searchParams.get('q');
    const cursor = searchParams.get('cursor');
    queries.push([query, cursor]);
    if (query === 'birds') return route.fulfill({ json: { items: [item('bird', 'Bird match')], total: 2, nextCursor: 'bird-next' } });
    if (queries.length === 2) {
      await replacement.promise;
      return route.fulfill({ status: 500, json: { error: 'Unavailable' } });
    }
    await retryRead.promise;
    return route.fulfill({ json: { items: [item('fish', 'Fish match')], total: 1 } });
  });

  await page.goto('/feed/search?q=birds');
  await expect(page.getByRole('heading', { name: 'Bird match' })).toBeVisible();
  const more = page.getByRole('button', { name: /Load more/ });
  await expect(more).toBeEnabled();
  const search = page.getByRole('textbox', { name: 'Search feed history' });
  await search.fill('fish');
  await search.press('Enter');

  try {
    await expect(page.getByRole('status').filter({ hasText: 'Searching…' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Bird match' })).toHaveCount(0);
    await expect(more).toHaveCount(0);
  } finally {
    replacement.resolve();
  }
  const error = page.getByRole('alert').filter({ hasText: 'Search could not be completed.' });
  await expect(error).toBeVisible();
  await expect(more).toHaveCount(0);
  const region = page.getByRole('region', { name: 'Search your feed' });
  try {
    await error.getByRole('button', { name: 'Retry' }).press('Enter');
    await expect.poll(() => queries).toHaveLength(3);
    await expect(region).toBeFocused();
    await expect(region).toHaveAttribute('aria-busy', 'true');
    await page.keyboard.press('Tab');
    await expect(search).toBeFocused();
  } finally {
    retryRead.resolve();
  }
  await expect(page.getByRole('heading', { name: 'Fish match' })).toBeVisible();
  await expect(search).toBeFocused();
  expect(queries).toEqual([['birds', null], ['fish', null], ['fish', null]]);
});

for (const keepFocus of [true, false]) {
  test(`Feed Search retries a failed third page ${keepFocus ? 'with pagination focus' : 'after moving focus'}`, async ({ page }) => {
    const queries = [];
    const retry = Promise.withResolvers();
    let thirdPageAttempts = 0;
    const result = (id, title, nextCursor) => ({ items: [{ id, title }], total: 3, nextCursor });
    await page.routeWebSocket('**/*', () => {});
    await page.route('**/api/**', async route => {
      const { pathname, searchParams } = new URL(route.request().url());
      if (!pathname.startsWith('/api/')) return route.fallback();
      if (pathname.endsWith('/supervision/bootstrap')) return route.fulfill({ json: { enabled: false } });
      if (pathname !== '/api/v1/feed/search') return route.fulfill({ json: {} });
      const cursor = searchParams.get('cursor');
      queries.push([searchParams.get('q'), searchParams.get('source'), searchParams.get('state'), cursor]);
      if (cursor === 'page-two') return route.fulfill({ json: result('two', 'Second bird', 'page-three') });
      if (cursor === 'page-three') {
        if (++thirdPageAttempts === 1) return route.fulfill({ status: 500, json: { error: 'Unavailable' } });
        await retry.promise;
        return route.fulfill({ json: result('three', 'Third bird', null) });
      }
      return route.fulfill({ json: result('one', 'First bird', 'page-two') });
    });

    await page.goto('/feed/search?q=birds&source=fixture&state=saved');
    const row = name => page.getByRole('heading', { name, exact: true });
    const more = page.getByRole('button', { name: /Load more/ });
    const search = page.getByRole('textbox', { name: 'Search feed history' });
    await expect(row('First bird')).toBeVisible();
    await more.press('Enter');
    await expect(row('Second bird')).toBeVisible();
    await expect(more).toBeFocused();
    await page.keyboard.press('Enter');
    const error = page.getByRole('alert').filter({ hasText: 'Search could not be completed.' });
    await expect(error).toBeVisible();
    await expect(row('First bird')).toBeVisible();
    await expect(row('Second bird')).toBeVisible();
    const otherContinuation = await more.count();
    try {
      await expect(page.getByRole('button', { name: 'Retry', exact: true })).toBeFocused();
      await page.keyboard.press('Enter');
      await expect.poll(() => queries).toEqual([
        ['birds', 'fixture', 'saved', null],
        ['birds', 'fixture', 'saved', 'page-two'],
        ['birds', 'fixture', 'saved', 'page-three'],
        ['birds', 'fixture', 'saved', 'page-three'],
      ]);
      expect(otherContinuation).toBe(0);
      const loading = page.getByRole('button', { name: 'Loading…', exact: true });
      await expect(loading).toBeDisabled();
      await expect(loading).toBeFocused();
      await page.keyboard.press('Enter');
      if (!keepFocus) await search.focus();
      await expect(row('First bird')).toBeVisible();
      await expect(row('Second bird')).toBeVisible();
    } finally {
      retry.resolve();
    }
    await expect(row('Third bird')).toBeVisible();
    await expect(more).toHaveCount(0);
    await expect(keepFocus ? row('Third bird') : search).toBeFocused();
    expect(queries).toHaveLength(4);
  });
}

test('two Feed Search tabs reconcile a queued change across their loaded filtered pages', async ({ page, context }) => {
  const sibling = await context.newPage();
  const pages = [page, sibling];
  const releaseReplay = Promise.withResolvers();
  const releasePeerRead = Promise.withResolvers();
  const writes = [];
  const requests = new Map();
  const searchUrl = '/feed/search?q=birds&source=fixture&state=saved';
  const item = (id, title) => ({ id, stateKey: id, title, source: 'fixture', state: { isSaved: true, isRead: false } });
  const shared = item('shared', 'Shared saved bird');
  const first = item('first', 'First stable bird');
  const focused = item('focused', 'Focused second-page bird');
  const last = item('last', 'Last second-page bird');
  const replacement = item('replacement', 'New boundary bird');
  let unsaved = false;
  const row = (tab, name) => tab.getByRole('article').filter({ has: tab.getByRole('heading', { name, exact: true }) });
  const pending = tab => tab.getByRole('button', { name: 'Retry 1 pending change' });

  for (const tab of pages) {
    const reads = [];
    requests.set(tab, reads);
    await tab.routeWebSocket('**/*', () => {});
    await tab.route('**/api/**', async route => {
      const request = route.request();
      const { pathname, searchParams } = new URL(request.url());
      if (pathname.endsWith('/feed/items/state')) {
        const body = request.postDataJSON();
        writes.push(body);
        if (body.action === 'unsave') {
          await releaseReplay.promise;
          unsaved = true;
          return route.fulfill({ json: { items: [{ id: shared.id, state: { isSaved: false, isRead: false } }] } });
        }
        return route.fulfill({ json: { items: [{ id: focused.id, state: { isSaved: true, isRead: true } }] } });
      }
      if (pathname.endsWith('/feed/search')) {
        const cursor = searchParams.get('cursor');
        reads.push([searchParams.get('q'), searchParams.get('source'), searchParams.get('state'), cursor]);
        const items = unsaved ? (cursor ? [last, replacement] : [first, focused]) : (cursor ? [focused, last] : [shared, first]);
        if (tab === sibling && unsaved && !cursor) await releasePeerRead.promise;
        return route.fulfill({ json: { items, total: unsaved ? 5 : 6, nextCursor: cursor ? 'page-three' : 'page-two' } });
      }
      const json = pathname.endsWith('/supervision/bootstrap') ? { enabled: false }
        : pathname.endsWith('/items/state/summary') ? { pendingSync: 0 }
          : pathname.endsWith('/feed/workspace') ? { preferencesStored: true } : {};
      return route.fulfill({ json });
    });
    await tab.goto(searchUrl);
    await expect(row(tab, shared.title)).toBeVisible();
    await tab.getByRole('button', { name: /Load more/ }).press('Enter');
    await expect(row(tab, focused.title)).toBeVisible();
    await tab.evaluate(() => Object.defineProperty(navigator, 'onLine', { configurable: true, value: false }));
  }

  try {
    await page.bringToFront();
    await row(page, shared.title).getByRole('button', { name: 'Saved', exact: true }).click();
    await expect(pending(page)).toBeVisible();
    await page.evaluate(() => {
      delete navigator.onLine;
      window.dispatchEvent(new Event('online'));
    });
    await expect.poll(() => writes).toEqual([{ action: 'unsave', itemIds: ['shared'] }]);
    await sibling.bringToFront();
    await expect(pending(sibling)).toBeVisible();
    await expect(row(sibling, shared.title).getByRole('button', { name: 'Save', exact: true })).toBeVisible();
    await expect(row(sibling, shared.title).getByText(/sync pending/)).toBeVisible();
    await sibling.evaluate(() => { delete navigator.onLine; });
    releaseReplay.resolve();
    await expect.poll(() => requests.get(sibling).length).toBe(3);
    await row(sibling, focused.title).getByRole('button', { name: 'Mark read', exact: true }).click();
    await expect(row(sibling, focused.title).getByRole('button', { name: 'Mark unread', exact: true })).toBeFocused();
  } finally {
    releaseReplay.resolve();
    releasePeerRead.resolve();
  }

  for (const tab of pages) {
    await expect(pending(tab)).toHaveCount(0);
    await expect(row(tab, shared.title)).toHaveCount(0);
    await expect(row(tab, replacement.title)).toBeVisible();
    await expect(tab.getByRole('button', { name: 'Load more (4 of 5)' })).toBeEnabled();
    await expect(tab).toHaveURL(new RegExp(searchUrl.replace('?', '\\?') + '$'));
    expect(requests.get(tab)).toEqual([
      ['birds', 'fixture', 'saved', null], ['birds', 'fixture', 'saved', 'page-two'],
      ['birds', 'fixture', 'saved', null], ['birds', 'fixture', 'saved', 'page-two'],
    ]);
  }
  await expect(row(sibling, focused.title).getByRole('button', { name: 'Mark unread', exact: true })).toBeFocused();
  expect(writes).toEqual([{ action: 'unsave', itemIds: ['shared'] }, { action: 'read', itemIds: ['focused'] }]);
});

for (const stalled of [false, true]) {
  test(`Feed Search ${stalled ? 'times out a stalled refresh and cancels its retry on a new query' : 'retries reconciliation with a GET and cancels it on a new query'}`, async ({ page }) => {
    const retryResponse = Promise.withResolvers();
    const stalledResponse = Promise.withResolvers();
    const calls = [];
    const writes = [];
    const bird = { id: 'bird', title: 'Saved bird' };
    let birdReads = 0;
    let stalledCancelled = false;
    let retryCancelled = false;
    let stalledRequest;
    let retryRequest;
    page.on('requestfailed', request => {
      if (request === stalledRequest) stalledCancelled = true;
      if (request === retryRequest) retryCancelled = true;
    });
    await page.routeWebSocket('**/*', () => {});
    await page.route('**/api/**', async route => {
      const request = route.request();
      const { pathname, searchParams } = new URL(request.url());
      if (pathname.endsWith('/feed/items/state')) {
        writes.push(request.postDataJSON());
        return route.fulfill({ json: { items: [{ id: bird.id, state: { isSaved: true } }] } });
      }
      if (pathname.endsWith('/feed/search')) {
        const query = searchParams.get('q');
        calls.push([request.method(), query, searchParams.get('cursor')]);
        if (query === 'fish') return route.fulfill({ json: { items: [{ id: 'fish', title: 'Current fish' }], total: 1 } });
        if (++birdReads === 2) {
          if (stalled) {
            stalledRequest = request;
            await stalledResponse.promise;
          }
          return route.fulfill({ status: 503, json: { error: 'Unavailable' } });
        }
        if (birdReads === 3) {
          retryRequest = request;
          await retryResponse.promise;
          return route.fulfill({ json: { items: [{ id: 'obsolete', title: 'Obsolete bird' }], total: 1 } });
        }
        return route.fulfill({ json: { items: [bird], total: 2, nextCursor: 'bird-next' } });
      }
      const json = pathname.endsWith('/supervision/bootstrap') ? { enabled: false }
        : pathname.endsWith('/items/state/summary') ? { pendingSync: 0 }
          : pathname.endsWith('/feed/workspace') ? { preferencesStored: true } : {};
      return route.fulfill({ json });
    });

    try {
      if (stalled) await page.clock.install();
      await page.goto('/feed/search?q=birds');
      const heading = page.getByRole('heading', { name: bird.title, exact: true });
      await expect(heading).toBeVisible();
      await page.evaluate(() => Object.defineProperty(navigator, 'onLine', { configurable: true, value: false }));
      await page.getByRole('button', { name: 'Save', exact: true }).click();
      await expect(page.getByRole('button', { name: 'Retry 1 pending change' })).toBeVisible();
      await page.evaluate(() => {
        delete navigator.onLine;
        window.dispatchEvent(new Event('online'));
      });
      if (stalled) {
        await expect.poll(() => birdReads).toBe(2);
        await page.clock.fastForward(10_000);
      }
      const retry = page.getByRole('button', { name: 'Retry refresh', exact: true });
      await expect(retry).toBeVisible();
      if (stalled) await expect.poll(() => stalledCancelled).toBe(true);
      await expect(heading).toBeVisible();
      await expect(page.getByRole('button', { name: 'Saved', exact: true })).toBeVisible();
      await expect(page.getByRole('button', { name: /Load more/ })).toBeDisabled();
      await retry.click();
      await expect.poll(() => birdReads).toBe(3);

      const search = page.getByRole('textbox', { name: 'Search feed history' });
      await search.fill('fish');
      await search.press('Enter');
      await expect(page.getByRole('heading', { name: 'Current fish' })).toBeVisible();
      await expect.poll(() => retryCancelled).toBe(true);
      await expect(retry).toHaveCount(0);
    } finally {
      stalledResponse.resolve();
      retryResponse.resolve();
    }
    await expect(page.getByRole('heading', { name: 'Obsolete bird' })).toHaveCount(0);
    expect(calls).toEqual([['GET', 'birds', null], ['GET', 'birds', null], ['GET', 'birds', null], ['GET', 'fish', null]]);
    expect(writes).toEqual([{ action: 'save', itemIds: ['bird'] }]);
  });
}

test('Feed Search retries its failed initial read once after replay has settled', async ({ page }) => {
  const initial = Promise.withResolvers();
  const replay = Promise.withResolvers();
  const reads = [];
  const writes = [];
  await page.addInitScript(() => localStorage.setItem('feed:pending-mutations:household', JSON.stringify([
    { id: 'queued-save', action: 'save', itemIds: ['bird'], createdAt: '2026-01-01T00:00:00.000Z' },
  ])));
  await page.routeWebSocket('**/*', () => {});
  await page.route('**/api/**', async route => {
    const request = route.request();
    const { pathname, searchParams } = new URL(request.url());
    if (pathname.endsWith('/feed/items/state')) {
      writes.push(request.postDataJSON());
      await replay.promise;
      return route.fulfill({ json: { items: [{ id: 'bird', state: { isSaved: true } }] } });
    }
    if (pathname.endsWith('/feed/search')) {
      if (reads.push([request.method(), searchParams.get('q'), searchParams.get('cursor')]) === 1) {
        await initial.promise;
        return route.fulfill({ status: 503, json: { error: 'Unavailable' } });
      }
      return route.fulfill({ json: { items: [{ id: 'bird', title: 'Recovered bird', state: { isSaved: true } }], total: 1 } });
    }
    const json = pathname.endsWith('/supervision/bootstrap') ? { enabled: false }
      : pathname.endsWith('/items/state/summary') ? { pendingSync: 0 }
        : pathname.endsWith('/feed/workspace') ? { preferencesStored: true } : {};
    return route.fulfill({ json });
  });

  try {
    await page.goto('/feed/search?q=birds');
    await expect.poll(() => reads.length).toBe(1);
    await expect.poll(() => writes.length).toBe(1);
    const pending = page.getByRole('button', { name: 'Retry 1 pending change' });
    await expect(pending).toBeVisible();
    replay.resolve();
    await expect(pending).toHaveCount(0);
    initial.resolve();
    await page.getByRole('button', { name: 'Retry', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Recovered bird', exact: true })).toBeVisible();
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  } finally {
    initial.resolve();
    replay.resolve();
  }
  expect(reads).toEqual([['GET', 'birds', null], ['GET', 'birds', null]]);
  expect(writes).toEqual([{ action: 'save', itemIds: ['bird'] }]);
});
