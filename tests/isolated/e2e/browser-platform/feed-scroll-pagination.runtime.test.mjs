import { test, expect } from '@playwright/test';

test.use({ serviceWorkers: 'block', viewport: { width: 390, height: 850 } });

const sessions = '/api/v1/feed/scroll/sessions';

function itemsFor(source, title, length = 15) {
  return Array.from({ length }, (_, index) => ({
    id: `${source}:${index + 1}`,
    title: `${title} ${index + 1}`,
    source,
    contentType: 'article',
    state: { isRead: false },
  }));
}

async function mockFeedStartup(page, workspace = {}) {
  await page.routeWebSocket('**/ws', () => {});
  await page.route('**/api/**', route => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/supervision/bootstrap')) return route.fulfill({ json: { enabled: false } });
    if (path.endsWith('/headlines/pages')) return route.fulfill({ json: [] });
    if (path.endsWith('/items/state/summary')) return route.fulfill({ json: { pendingSync: 0 } });
    if (path.endsWith('/feed/workspace')) return route.fulfill({ json: { preferencesStored: true, ...workspace } });
    return route.fulfill({ json: {} });
  });
}

test('changing the Feed Scroll filter retires the previous session’s pending page', async ({ page }) => {
  await mockFeedStartup(page);

  const oldItems = itemsFor('reddit', 'Previous filter item');
  const libraryItems = itemsFor('goodreads', 'Library item');
  const obsolete = { ...oldItems[0], id: 'reddit:next', title: 'Obsolete appended item' };
  const nextLibrary = { ...libraryItems[0], id: 'goodreads:next', title: 'Next Library item' };
  await page.route(`**${sessions}`, route => {
    const filter = route.request().postDataJSON().filter;
    return route.fulfill({ json: {
      items: filter === 'library' ? libraryItems : oldItems,
      sessionId: filter === 'library' ? 'library' : 'original',
      hasMore: true,
    } });
  });

  let releaseOriginal;
  const heldOriginal = new Promise(resolve => { releaseOriginal = resolve; });
  let originalCursor;
  let originalCancelled = false;
  page.on('requestfailed', request => {
    if (new URL(request.url()).pathname === `${sessions}/original`) originalCancelled = true;
  });
  await page.route(`**${sessions}/original?**`, async route => {
    originalCursor = new URL(route.request().url()).searchParams.get('cursor');
    await heldOriginal;
    await route.fulfill({ json: { items: [obsolete], sessionId: 'original', hasMore: false } });
  });
  let releaseLibrary;
  const heldLibrary = new Promise(resolve => { releaseLibrary = resolve; });
  let libraryCursor;
  await page.route(`**${sessions}/library?**`, async route => {
    libraryCursor = new URL(route.request().url()).searchParams.get('cursor');
    await heldLibrary;
    return route.fulfill({ json: { items: [nextLibrary], sessionId: 'library', hasMore: false } });
  });

  try {
    await page.goto('/feed/scroll');
    await expect(page.getByRole('button', { name: 'Open: Previous filter item 1', exact: true })).toBeAttached();
    await page.locator('.scroll-sentinel').scrollIntoViewIfNeeded();
    await expect.poll(() => originalCursor).toBe('reddit:15');

    await page.getByRole('button', { name: 'Library', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Library', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByRole('button', { name: 'Open: Library item 1', exact: true })).toBeAttached();
    await expect.poll(() => originalCancelled).toBe(true);
    releaseOriginal();

    await page.locator('.scroll-sentinel').scrollIntoViewIfNeeded({ timeout: 5000 });
    await expect.poll(() => libraryCursor).toBe('goodreads:15');
    releaseLibrary();
    await expect(page.getByRole('button', { name: 'Open: Next Library item' })).toBeAttached();
    await expect(page.getByRole('button', { name: 'Open: Obsolete appended item' })).toHaveCount(0);
  } finally {
    releaseOriginal();
    releaseLibrary();
  }
});

for (const visit of ['early default departure', 'filtered departure']) {
  test(`Feed Scroll preserves the default reading checkpoint on ${visit}`, async ({ page }) => {
    const checkpoint = { itemId: 'default-story', scrollOffset: 1700, visitedAt: '2026-10-01T12:00:00.000Z' };
    await mockFeedStartup(page, { checkpoints: { scroll: checkpoint } });
    const writes = [];
    const initialStarted = Promise.withResolvers();
    const releaseInitial = Promise.withResolvers();
    await page.route('**/api/v1/feed/workspace/checkpoints/scroll', async route => {
      const body = route.request().postDataJSON();
      writes.push(body);
      return route.fulfill({ json: { checkpoint: body } });
    });
    await page.route(`**${sessions}`, async route => {
      const filter = route.request().postDataJSON().filter;
      if (visit === 'early default departure') {
        initialStarted.resolve();
        await releaseInitial.promise;
      }
      return route.fulfill({ json: {
        items: itemsFor(filter === 'library' ? 'goodreads' : 'reddit', 'Checkpoint fixture'),
        sessionId: filter === 'library' ? 'checkpoint-library' : 'checkpoint-default', hasMore: false,
      } });
    });

    await page.goto(visit === 'early default departure' ? '/feed/scroll' : '/feed/scroll?filter=library');
    if (visit === 'early default departure') await initialStarted.promise;
    else await expect(page.getByRole('button', { name: 'Open: Checkpoint fixture 1', exact: true })).toBeAttached();
    await page.getByRole('link', { name: 'Headlines', exact: true }).click();
    await expect(page).toHaveURL(/\/feed\/headlines\//);
    releaseInitial.resolve();

    if (visit === 'early default departure') {
      await expect.poll(() => writes.length).toBeGreaterThanOrEqual(2);
      for (const write of writes) expect(write).toMatchObject({ itemId: checkpoint.itemId, scrollOffset: checkpoint.scrollOffset });
    } else {
      await expect.poll(() => writes.length).toBe(0);
    }
  });
}

test('Feed Scroll restores its latest default position after a filtered Back round trip', async ({ page }) => {
  await mockFeedStartup(page, { checkpoints: { scroll: { itemId: null, scrollOffset: 0 } } });
  const rows = itemsFor('reddit', 'Warm default item', 60);
  const writes = [];
  await page.route(`**${sessions}`, route => route.fulfill({ json: { items: rows, sessionId: 'warm-default', hasMore: false } }));
  await page.route(`**${sessions}/warm-default?**`, route => route.fulfill({ json: { items: rows, sessionId: 'warm-default', hasMore: false } }));
  await page.route('**/api/v1/feed/workspace/checkpoints/scroll', route => {
    const body = route.request().postDataJSON();
    writes.push(body);
    return route.fulfill({ json: { checkpoint: body } });
  });
  await page.goto('/feed/scroll');
  const main = page.getByRole('main', { name: 'Feed' });
  await expect(page.getByRole('button', { name: 'Open: Warm default item 1', exact: true })).toBeAttached();
  await main.evaluate(el => { el.scrollTop = 1800; });
  await expect.poll(() => main.evaluate(el => el.scrollTop)).toBeGreaterThan(1000);
  const targetOffset = await main.evaluate(el => el.scrollTop);

  await page.getByRole('button', { name: 'Library', exact: true }).click();
  await expect(page).toHaveURL(/filter=library/);
  await expect.poll(() => writes.length).toBeGreaterThan(0);
  expect(writes.at(-1)).toMatchObject({ scrollOffset: targetOffset });
  await page.goBack();
  await expect(page).toHaveURL('/feed/scroll');
  await expect.poll(() => main.evaluate(el => el.scrollTop)).toBeCloseTo(targetOffset, -1);
});

test('Feed Scroll keeps explicit focus=all isolated from the default session and checkpoint', async ({ page }) => {
  await mockFeedStartup(page, { checkpoints: { scroll: { itemId: 'default-story', scrollOffset: 1700 } } });
  await page.addInitScript(() => {
    sessionStorage.setItem('feed:scroll:session:all:all', 'default-session');
    sessionStorage.setItem('feed:scroll:session:@all:all', 'legacy-focus-at-all-session');
    sessionStorage.setItem('feed:scroll:session:@v2%3Aall:all', 'legacy-token-shaped-session');
  });
  const calls = [];
  const writes = [];
  await page.route(`**${sessions}**`, route => {
    calls.push({ method: route.request().method(), url: route.request().url(), body: route.request().postDataJSON() });
    return route.fulfill({ json: { items: itemsFor('reddit', 'Explicit all focus'), sessionId: 'explicit-all', hasMore: false } });
  });
  await page.route('**/api/v1/feed/workspace/checkpoints/scroll', route => {
    writes.push(route.request().postDataJSON());
    return route.fulfill({ json: { checkpoint: route.request().postDataJSON() } });
  });

  await page.goto('/feed/scroll?focus=all');
  await expect(page.getByRole('button', { name: 'Open: Explicit all focus 1', exact: true })).toBeAttached();
  await expect.poll(() => calls.length).toBeGreaterThan(0);
  expect(calls[0].method).toBe('POST');
  expect(writes).toEqual([]);
});

test('Feed Scroll session keys distinguish colon-delimited query dimensions', async ({ page }) => {
  await mockFeedStartup(page);
  await page.addInitScript(() => sessionStorage.setItem('feed:scroll:session:reddit:reddit:library', 'colliding-session'));
  const calls = [];
  await page.route(`**${sessions}**`, route => {
    calls.push({ method: route.request().method(), url: route.request().url(), body: route.request().postDataJSON() });
    return route.fulfill({ json: { items: itemsFor('reddit', 'Tuple scoped item'), sessionId: 'tuple-scoped', hasMore: false } });
  });

  await page.goto('/feed/scroll?focus=reddit%3Areddit&filter=library');
  await expect(page.getByRole('button', { name: 'Open: Tuple scoped item 1', exact: true })).toBeAttached();
  await expect.poll(() => calls.length).toBeGreaterThan(0);
  expect(calls[0].method).toBe('POST');
});

test('Feed Scroll v2 session keys encode ordinary dimensions when paired with exceptional values', async ({ page }) => {
  await mockFeedStartup(page);
  await page.addInitScript(() => sessionStorage.setItem('feed:scroll:session-v2:%40x:%61ll', 'colliding-v2-session'));
  const calls = [];
  await page.route(`**${sessions}**`, route => {
    calls.push({ method: route.request().method(), url: route.request().url(), body: route.request().postDataJSON() });
    return route.fulfill({ json: { items: itemsFor('reddit', 'Fully encoded tuple'), sessionId: 'encoded-tuple', hasMore: false } });
  });

  await page.goto('/feed/scroll?focus=%40x&filter=%2561ll');
  await expect(page.getByRole('button', { name: 'Open: Fully encoded tuple 1', exact: true })).toBeAttached();
  await expect.poll(() => calls.length).toBeGreaterThan(0);
  expect(calls[0].method).toBe('POST');
});

test('Feed Scroll preserves its visible card checkpoint when leaving mobile detail', async ({ page }) => {
  await mockFeedStartup(page, { checkpoints: { scroll: { itemId: null, scrollOffset: 0 } } });
  const rows = itemsFor('reddit', 'Mobile anchor item', 60);
  const writes = [];
  await page.route(`**${sessions}`, route => route.fulfill({ json: { items: rows, sessionId: 'mobile-anchor', hasMore: false } }));
  await page.route('**/api/v1/feed/detail/*', route => route.fulfill({ json: { sections: [] } }));
  await page.route('**/api/v1/feed/workspace/checkpoints/scroll', route => {
    const body = route.request().postDataJSON();
    writes.push(body);
    return route.fulfill({ json: { checkpoint: body } });
  });
  await page.goto('/feed/scroll');
  const main = page.getByRole('main', { name: 'Feed' });
  await expect(page.getByRole('button', { name: 'Open: Mobile anchor item 1', exact: true })).toBeAttached();
  await main.evaluate(el => { el.scrollTop = 1500; });
  await expect.poll(() => main.evaluate(el => el.scrollTop)).toBeGreaterThan(800);
  const anchor = await main.evaluate(el => [...el.querySelectorAll('[data-feed-item-id]')].find(node => {
    const bounds = node.getBoundingClientRect(), view = el.getBoundingClientRect();
    return bounds.bottom > view.top + 8 && bounds.top < view.bottom;
  })?.dataset.feedItemId);
  expect(anchor).toBeTruthy();
  const offset = await main.evaluate(el => el.scrollTop);
  const opener = main.locator(`[data-feed-item-id="${anchor}"]`).getByRole('button', { name: /^Open:/ });
  await opener.evaluate(node => node.click());
  await expect(page).toHaveURL(/\/feed\/scroll\/[^/]+$/);
  await expect(page.locator('.scroll-view')).toBeHidden();
  await page.getByRole('link', { name: 'Headlines', exact: true }).click();
  await expect(page).toHaveURL(/\/feed\/headlines\//);

  await expect.poll(() => writes.length).toBeGreaterThan(0);
  expect(writes.at(-1)).toMatchObject({ itemId: anchor, scrollOffset: offset });
});

test('Feed Scroll keeps a reading budget extension within the current filter visit', async ({ page }) => {
  await mockFeedStartup(page, { preferences: { sessionBudget: 30 } });
  await page.addInitScript(() => {
    localStorage.setItem('feed:reading-preferences', JSON.stringify({ sessionBudget: 30 }));
    sessionStorage.setItem('feed:scroll:session:all:all', 'for-you-budget');
    sessionStorage.setItem('feed:scroll:session:all:library', 'library-budget');
  });

  const forYouItems = itemsFor('reddit', 'For you budget item', 60);
  const libraryItems = itemsFor('goodreads', 'Library budget item', 40);
  let servedForYouItems = forYouItems.slice(0, 30);
  let appendAttempts = 0;
  let releaseFirstAppend;
  const heldFirstAppend = new Promise(resolve => { releaseFirstAppend = resolve; });
  await page.route(`**${sessions}/for-you-budget?**`, async route => {
    const { searchParams } = new URL(route.request().url());
    if (searchParams.has('resume')) {
      return route.fulfill({ json: { items: servedForYouItems, sessionId: 'for-you-budget', hasMore: true } });
    }
    if (++appendAttempts === 1) {
      await heldFirstAppend;
      return route.fulfill({ status: 503, json: { error: 'Unavailable' } });
    }
    servedForYouItems = forYouItems;
    return route.fulfill({ json: { items: forYouItems.slice(30), sessionId: 'for-you-budget', hasMore: true } });
  });
  await page.route(`**${sessions}/library-budget?**`, route => route.fulfill({ json: {
    items: libraryItems, sessionId: 'library-budget', hasMore: true,
  } }));

  const defaultBoundary = page.getByText('You reached your 30-item reading boundary.');
  const sentinel = page.locator('.scroll-sentinel');
  await page.goto('/feed/scroll');
  await expect(defaultBoundary).toBeAttached();
  try {
    await page.getByRole('button', { name: 'Continue 30 more' }).press('Enter');
    await sentinel.scrollIntoViewIfNeeded();
  } finally {
    releaseFirstAppend();
  }
  await page.getByRole('button', { name: 'Retry', exact: true }).press('Enter');
  await expect(page.getByText('You reached your 60-item reading boundary.')).toBeAttached();

  await page.getByRole('button', { name: 'Library', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Open: Library budget item 1', exact: true })).toBeAttached();
  await expect(page.getByRole('button', { name: 'Open: Library budget item 31', exact: true })).toHaveCount(0);
  await expect(defaultBoundary).toBeAttached();
  await expect(sentinel).toHaveCount(0);

  await page.getByRole('button', { name: 'For you', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Open: For you budget item 1', exact: true })).toBeAttached();
  await expect(defaultBoundary).toBeAttached();
  await expect(sentinel).toHaveCount(0);
});

test('two Feed Scroll tabs reconcile a queued archive without replacing their loaded sessions', async ({ page, context }) => {
  const sibling = await context.newPage();
  const pages = [page, sibling];
  const writes = [];
  const release = Promise.withResolvers();
  const items = itemsFor('goodreads', 'Library volume', 16).map(item => ({ ...item, state: { isRead: true } }));
  let archived = false;
  const requests = new Map();
  const card = (tab, number) => tab.locator(`[data-feed-item-id="goodreads:${number}"]`);
  const pending = tab => tab.getByRole('button', { name: 'Retry 1 pending change' });
  const siblingOffset = () => sibling.getByRole('main', { name: 'Feed' }).evaluate(node => node.scrollTop);
  let resumedSessions;

  for (const [index, tab] of pages.entries()) {
    const sessionId = `library-${index}`;
    const sessionRequests = [];
    requests.set(tab, sessionRequests);
    await mockFeedStartup(tab);
    await tab.route('**/feed/items/state', route => {
      const body = route.request().postDataJSON();
      writes.push(body);
      return release.promise.then(() => {
        archived = true;
        return route.fulfill({ json: { items: [{ id: 'goodreads:1', state: { isArchived: true, isRead: true, syncStatus: 'synced' } }] } });
      });
    });
    await tab.route(`**${sessions}`, route => {
      sessionRequests.push(['create', route.request().postDataJSON().filter]);
      return route.fulfill({ json: { items: items.slice(0, 15), sessionId, hasMore: true } });
    });
    await tab.route(`**${sessions}/${sessionId}?**`, route => {
      const { searchParams } = new URL(route.request().url());
      const resume = searchParams.get('resume') === '1';
      sessionRequests.push([resume ? 'resume' : 'append', searchParams.get('filter'), searchParams.get('cursor')]);
      const rows = resume ? items.map((item, row) => ({ ...item, state: {
        isRead: true, isArchived: archived && row === 0, isSaved: archived && row === 15, syncStatus: 'synced',
      } })) : items.slice(15);
      return route.fulfill({ json: { items: rows, sessionId, hasMore: false, resumed: resume } });
    });
    await tab.goto('/feed/scroll?filter=library');
    await expect(card(tab, 1)).toBeVisible();
    await tab.locator('.scroll-sentinel').scrollIntoViewIfNeeded();
    await expect(card(tab, 16)).toBeAttached();
    await tab.evaluate(() => Object.defineProperty(navigator, 'onLine', { configurable: true, value: false }));
  }

  try {
    expect(await siblingOffset()).toBeGreaterThan(0);
    await page.bringToFront();
    await card(page, 1).getByRole('button', { name: 'Archive', exact: true }).click();
    await expect(pending(page)).toBeVisible();
    await page.evaluate(() => {
      delete navigator.onLine;
      window.dispatchEvent(new Event('online'));
    });
    await expect.poll(() => writes.length).toBe(1);
    await sibling.bringToFront();
    await expect.poll(() => sibling.evaluate(() => JSON.parse(localStorage.getItem('feed:pending-mutations:household') || '[]')
      .map(operation => operation.action))).toEqual(['archive']);
    expect(writes).toEqual([{ itemIds: ['goodreads:1'], action: 'archive' }]);
    for (const tab of pages) {
      await expect(pending(tab)).toBeVisible();
      await expect(card(tab, 1)).toHaveCount(0, { timeout: 3000 });
    }
    await sibling.evaluate(() => { delete navigator.onLine; });
    resumedSessions = Promise.all(pages.map(async tab => {
      const response = await tab.waitForResponse(response => {
        const { pathname, searchParams } = new URL(response.url());
        return pathname.startsWith(`${sessions}/`) && searchParams.get('resume') === '1' && response.ok();
      });
      await response.finished();
    }));
  } finally {
    release.resolve();
  }

  await resumedSessions;
  await expect(pending(sibling)).toHaveCount(0);
  expect(await siblingOffset()).toBeGreaterThan(0);
  for (const tab of pages) {
    await tab.bringToFront();
    await expect(pending(tab)).toHaveCount(0);
    await expect(card(tab, 1)).toHaveCount(0);
    await expect(card(tab, 16)).toBeAttached();
    await card(tab, 16).getByRole('button', { name: 'Open: Library volume 16' }).press('Enter');
    await expect(tab.getByRole('heading', { name: 'Library volume 16', exact: true })).toBeVisible();
    const saved = tab.getByRole('button', { name: 'Saved', exact: true });
    await expect(saved).toBeVisible();
    await expect(saved).toHaveAttribute('aria-pressed', 'true');
    expect(requests.get(tab)).toEqual([
      ['create', 'library'], ['append', 'library', 'goodreads:15'], ['resume', 'library', null],
    ]);
  }
  expect(writes).toEqual([{ itemIds: ['goodreads:1'], action: 'archive' }]);
});

test('Feed Scroll retries a failed session refresh and retires it on a filter change', async ({ page }) => {
  await mockFeedStartup(page);
  await page.addInitScript(() => sessionStorage.setItem('feed:scroll:session:all:library', 'warm-library'));

  const rows = itemsFor('goodreads', 'Warm Library item', 3);
  const release = Promise.withResolvers();
  const writes = [];
  const requests = [];
  const resumed = `${sessions}/warm-library?`;
  let cancelled = false;
  page.on('requestfailed', request => {
    if (request.url().includes(resumed)) cancelled = true;
  });
  await page.route(`**${resumed}**`, async route => {
    const attempt = requests.push(['resume', route.request().method(), new URL(route.request().url()).searchParams.get('resume')]);
    if (attempt === 2) return route.fulfill({ status: 503, json: { error: 'Temporarily unavailable' } });
    if (attempt === 3) await release.promise;
    const items = attempt === 3
      ? [...rows, { ...rows[0], id: 'goodreads:retired', title: 'Retired read' }]
      : rows;
    return route.fulfill({ json: { items, sessionId: 'warm-library', hasMore: false, resumed: true } });
  });
  await page.route(`**${sessions}`, route => {
    requests.push(['create', route.request().method(), route.request().postDataJSON().filter]);
    return route.fulfill({ json: { items: itemsFor('reddit', 'Other filter', 1), sessionId: 'for-you', hasMore: false } });
  });
  await page.route('**/feed/items/state', route => {
    writes.push(route.request().postDataJSON());
    return route.fulfill({ json: { items: [{ id: 'goodreads:1', state: { isArchived: true } }] } });
  });

  await page.goto('/feed/scroll?filter=library');
  const retained = page.getByRole('button', { name: 'Open: Warm Library item 2', exact: true });
  await expect(retained).toBeVisible();
  await page.evaluate(() => Object.defineProperty(navigator, 'onLine', { configurable: true, value: false }));
  await page.locator('[data-feed-item-id="goodreads:1"]').getByRole('button', { name: 'Archive', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Retry 1 pending change' })).toBeVisible();
  await page.evaluate(() => {
    delete navigator.onLine;
    window.dispatchEvent(new Event('online'));
  });

  const retry = page.getByRole('button', { name: 'Retry refresh', exact: true });
  try {
    await expect(retry).toBeVisible();
    await expect(retained).toBeVisible();
    await retry.click();
    await expect.poll(() => requests.length).toBe(3);
    await page.getByRole('button', { name: 'For you', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Open: Other filter 1', exact: true })).toBeVisible();
    await expect.poll(() => cancelled).toBe(true);
  } finally {
    release.resolve();
  }

  await expect(retained).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Open: Retired read', exact: true })).toHaveCount(0);
  await expect(retry).toHaveCount(0);
  expect(requests).toEqual([
    ['resume', 'GET', '1'], ['resume', 'GET', '1'], ['resume', 'GET', '1'], ['create', 'POST', null],
  ]);
  expect(writes).toEqual([{ itemIds: ['goodreads:1'], action: 'archive' }]);
});

async function settlePeerChange(page, context) {
  const peer = await context.newPage();
  await peer.route('**/queue-peer', route => route.fulfill({ contentType: 'text/html', body: '<title>Peer</title>' }));
  await peer.goto(new URL('/queue-peer', page.url()).href);
  const key = 'feed:pending-mutations:household';
  await peer.evaluate(key => localStorage.setItem(key, JSON.stringify([{
    id: 'peer-change', itemIds: ['goodreads:1'], action: 'save', createdAt: new Date().toISOString(),
  }])), key);
  const pending = page.getByRole('button', { name: 'Retry 1 pending change' });
  await expect(pending).toBeAttached();
  await peer.evaluate(key => localStorage.removeItem(key), key);
  await expect(pending).toHaveCount(0);
  await peer.close();
}

test('Feed Scroll retries only its failed initial resume after a peer settles during load', async ({ page, context }) => {
  await mockFeedStartup(page);
  await page.addInitScript(() => sessionStorage.setItem('feed:scroll:session:all:library', 'stored'));
  const started = Promise.withResolvers();
  const release = Promise.withResolvers();
  let allowRetry = false;
  const requests = [];
  await page.route(`**${sessions}/stored?**`, async route => {
    requests.push(route.request().method());
    if (requests.length === 1) {
      started.resolve();
      await release.promise;
    }
    return allowRetry
      ? route.fulfill({ json: { items: itemsFor('goodreads', 'Library', 2), sessionId: 'stored', hasMore: false } })
      : route.fulfill({ status: 503, json: {} });
  });
  try {
    await page.goto('/feed/scroll?filter=library');
    await started.promise;
    await settlePeerChange(page, context);
  } finally {
    release.resolve();
  }
  const retry = page.getByRole('button', { name: 'Retry', exact: true });
  await expect(retry).toBeVisible();
  allowRetry = true;
  await retry.click();
  await expect(page.getByRole('button', { name: 'Open: Library 1', exact: true })).toBeVisible();
  expect(requests).toEqual(['GET', 'GET']);
  await expect(page.getByRole('button', { name: 'Retry refresh' })).toHaveCount(0);
});

test('Feed Scroll bounds a stalled reconciliation and retries its exact session with the original cursor', async ({ page, context }) => {
  await mockFeedStartup(page, { preferences: { sessionBudget: 30 } });
  await page.addInitScript(() => localStorage.setItem('feed:reading-preferences', JSON.stringify({ sessionBudget: 30 })));
  const rows = itemsFor('goodreads', 'Library', 30);
  const release = Promise.withResolvers();
  const requests = [];
  await page.route(`**${sessions}`, route => {
    requests.push(['POST']);
    return route.fulfill({ json: { items: rows, sessionId: 'library', hasMore: true } });
  });
  await page.route(`**${sessions}/library?**`, async route => {
    const query = new URL(route.request().url()).searchParams;
    requests.push([route.request().method(), query.get('resume'), query.get('filter'), query.get('cursor')]);
    if (requests.length === 2) await release.promise;
    const items = query.has('resume')
      ? rows.map(item => ({ ...item, state: { ...item.state, isArchived: item.id === 'goodreads:1' } }))
      : [{ ...rows[0], id: 'goodreads:31', title: 'Final volume' }];
    await route.fulfill({ json: { items, sessionId: 'library', hasMore: false } }).catch(() => {});
  });
  await page.goto('/feed/scroll?filter=library');
  const first = page.getByRole('button', { name: 'Open: Library 1', exact: true });
  await expect(first).toBeVisible();
  try {
    await settlePeerChange(page, context);
    await expect.poll(() => requests.length).toBe(2);
    const retry = page.getByRole('button', { name: 'Retry refresh', exact: true });
    await expect(retry).toBeVisible({ timeout: 16000 });
    await expect(first).toBeVisible();
    release.resolve();
    await retry.press('Enter');
    await expect(first).toHaveCount(0);
    await page.getByRole('button', { name: 'Continue 30 more' }).press('Enter');
    await page.getByRole('main', { name: 'Feed' }).evaluate(el => { el.scrollTop = el.scrollHeight; });
    await expect(page.getByRole('button', { name: 'Open: Final volume', exact: true })).toBeAttached();
    expect(requests).toEqual([
      ['POST'], ['GET', '1', 'library', null], ['GET', '1', 'library', null], ['GET', null, 'library', 'goodreads:30'],
    ]);
  } finally {
    release.resolve();
  }
});

test('Feed Scroll preserves a newer local archive when a held reconciliation completes', async ({ page, context }) => {
  await mockFeedStartup(page);
  const rows = itemsFor('goodreads', 'Library', 3);
  const started = Promise.withResolvers();
  const release = Promise.withResolvers();
  await page.route(`**${sessions}`, route => route.fulfill({ json: { items: rows, sessionId: 'library', hasMore: false } }));
  await page.route(`**${sessions}/library?**`, async route => {
    started.resolve();
    await release.promise;
    const items = rows.map(item => ({ ...item, state: { ...item.state, isArchived: item.id === 'goodreads:1' } }));
    await route.fulfill({ json: { items, sessionId: 'library', hasMore: false } });
  });
  await page.route('**/feed/items/state', route => route.fulfill({ json: { items: [{ id: 'goodreads:2', state: { isArchived: true } }] } }));
  const card = number => page.locator(`[data-feed-item-id="goodreads:${number}"]`);
  await page.goto('/feed/scroll?filter=library');
  await expect(card(1)).toBeVisible();
  try {
    await settlePeerChange(page, context);
    await started.promise;
    await card(2).getByRole('button', { name: 'Archive', exact: true }).click();
    await expect(card(2)).toHaveCount(0);
  } finally {
    release.resolve();
  }
  await expect(card(1)).toHaveCount(0);
  await expect(card(2)).toHaveCount(0);
  await expect(card(3)).toBeVisible();
});
