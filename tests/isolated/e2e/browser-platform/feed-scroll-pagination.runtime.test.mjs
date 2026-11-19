import { test, expect } from '@playwright/test';

test.use({ serviceWorkers: 'block', viewport: { width: 390, height: 850 } });

const sessions = '/api/v1/feed/scroll/sessions';

function itemsFor(source, title) {
  return Array.from({ length: 15 }, (_, index) => ({
    id: `${source}:${index + 1}`,
    title: `${title} ${index + 1}`,
    source,
    contentType: 'article',
    state: { isRead: false },
  }));
}

test('changing the Feed Scroll filter retires the previous session’s pending page', async ({ page }) => {
  await page.routeWebSocket('**/ws', () => {});
  await page.route('**/api/**', route => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/supervision/bootstrap')) return route.fulfill({ json: { enabled: false } });
    if (path.endsWith('/headlines/pages')) return route.fulfill({ json: [] });
    if (path.endsWith('/feed/workspace')) return route.fulfill({ json: { preferencesStored: true } });
    return route.fulfill({ json: {} });
  });

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
