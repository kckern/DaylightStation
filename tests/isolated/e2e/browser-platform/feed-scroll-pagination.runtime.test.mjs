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
