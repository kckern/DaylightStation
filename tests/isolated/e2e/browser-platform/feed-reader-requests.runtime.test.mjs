import { expect, test } from '@playwright/test';

test.use({ serviceWorkers: 'block' });

test.beforeEach(async ({ page }) => {
  await page.routeWebSocket('**/*', () => {});
  await page.route('**/api/**', route => {
    const path = new URL(route.request().url()).pathname;
    const json = path.endsWith('/reader/feeds') ? []
      : path.endsWith('/supervision/bootstrap') ? { enabled: false } : {};
    return route.fulfill({ json });
  });
});

function article(id, title) {
  return { id, stateKey: id, title, published: '2026-07-01T12:00:00Z', state: { isSaved: true } };
}

test('Reader aborts a previous filter page and paginates the current stream', async ({ page }) => {
  let oldPage;
  const streamReads = [];
  await page.route('**/api/v1/feed/search?**', route => {
    const params = new URL(route.request().url()).searchParams;
    if (params.get('cursor') === 'saved-next') {
      oldPage = route;
      return;
    }
    return route.fulfill({ json: { items: [article('saved', 'Saved filter article')], nextCursor: 'saved-next' } });
  });
  await page.route('**/api/v1/feed/reader/stream?**', route => {
    const cursor = new URL(route.request().url()).searchParams.get('continuation');
    streamReads.push(cursor);
    return route.fulfill({ json: cursor === 'recent-next'
      ? { items: [article('more', 'More recent articles')], exhausted: true }
      : { items: [article('recent', 'Recent filter article')], continuation: 'recent-next' } });
  });

  await page.goto('/feed/reader?view=saved');
  await expect(page.getByText('Saved filter article', { exact: true })).toBeVisible();
  await expect.poll(() => Boolean(oldPage)).toBe(true);
  const canceled = page.waitForEvent('requestfailed', request => request === oldPage.request());
  await page.getByRole('group', { name: 'Article state' }).getByRole('button', { name: 'all', exact: true }).click();
  await canceled;
  await expect(page.getByText('Recent filter article', { exact: true })).toBeVisible();
  await expect(page.getByText('More recent articles', { exact: true })).toBeVisible();
  await expect(page.getByText('Saved filter article', { exact: true })).toHaveCount(0);
  expect(streamReads).toEqual([null, 'recent-next']);
});

test('Reader retains the first page and retries a failed cursor only when asked', async ({ page }) => {
  const reads = [];
  await page.route('**/api/v1/feed/reader/stream?**', route => {
    const cursor = new URL(route.request().url()).searchParams.get('continuation');
    reads.push(cursor);
    if (reads.length === 1) return route.fulfill({
      json: { items: [article('first', 'First page article')], continuation: 'next' },
    });
    if (reads.length === 2) return route.fulfill({ status: 500, json: { error: 'Unavailable' } });
    return route.fulfill({ json: { items: [article('second', 'Second page article')], exhausted: true } });
  });

  await page.goto('/feed/reader');
  const existing = page.getByText('First page article', { exact: true });
  await expect(existing).toBeVisible();
  const failure = page.getByRole('alert').filter({ hasText: 'More articles could not be loaded.' });
  await expect(failure).toBeVisible();
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  expect(reads).toEqual([null, 'next']);
  await failure.getByRole('button', { name: 'Retry' }).click();
  await expect(existing).toBeVisible();
  await expect(page.getByText('Second page article', { exact: true })).toBeVisible();
  expect(reads).toEqual([null, 'next', 'next']);
});

test('Reader restores a saved position after its first page supplies the scrollable rows', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  const offset = 2200;
  await page.route('**/api/v1/feed/workspace', route => route.fulfill({ json: {
    preferencesStored: true, checkpoints: { reader: { scrollOffset: offset, itemId: 'retired-story' } },
  } }));
  const entered = Promise.withResolvers();
  const release = Promise.withResolvers();
  const items = Array.from({ length: 98 }, (_, i) => article(String(i), 'Reader article ' + i));
  await page.route('**/api/v1/feed/reader/stream?**', async route => {
    entered.resolve();
    await release.promise;
    return route.fulfill({ json: { items, exhausted: true } });
  });
  await page.goto('/feed/reader');
  await entered.promise;
  const inbox = page.locator('.reader-inbox');
  await expect(inbox.getByText('Loading...', { exact: true })).toBeVisible();
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  release.resolve();
  await expect.poll(() => inbox.evaluate(el => el.scrollHeight - el.clientHeight)).toBeGreaterThan(offset);
  await expect.poll(() => inbox.evaluate(el => el.scrollTop)).toBe(offset);
  expect(await page.getByRole('main', { name: 'Feed' }).evaluate(el => el.scrollTop)).toBe(0);
});

for (const query of ['view=saved', 'feeds=news']) {
  test('Reader keeps the default checkpoint independent of ' + query, async ({ page }) => {
    const checkpoint = { itemId: 'retired', scrollOffset: 2200 };
    const writes = [];
    await page.route('**/api/v1/feed/workspace', route => route.fulfill({ json: {
      preferencesStored: true, checkpoints: { reader: checkpoint },
    } }));
    await page.route('**/api/v1/feed/workspace/checkpoints/reader', route => {
      writes.push(route.request().postDataJSON());
      return route.fulfill({ json: {} });
    });
    const items = Array.from({ length: 98 }, (_, i) => article(String(i), 'Story ' + i));
    await page.route(/\/api\/v1\/feed\/(reader\/stream|search)\?/, route => route.fulfill({ json: { items, exhausted: true } }));
    await page.goto('/feed/reader?' + query);
    const inbox = page.locator('.reader-inbox');
    await expect.poll(() => inbox.evaluate(el => el.scrollHeight - el.clientHeight)).toBeGreaterThan(2200);
    expect(await inbox.evaluate(el => el.scrollTop)).toBe(0);
    await inbox.evaluate(el => { el.scrollTop = 1100; });
    await page.getByRole('link', { name: 'Headlines', exact: true }).click();
    await expect.poll(() => writes.length).toBeGreaterThanOrEqual(2);
    for (const write of writes) expect(write).toMatchObject(checkpoint);
    await page.getByRole('link', { name: 'Reader', exact: true }).click();
    await expect(page).toHaveURL(/\/feed\/reader$/);
    await expect.poll(() => inbox.evaluate(el => el.scrollTop)).toBe(2200);
  });
}

test('Reader retains an unread checkpoint on early departure and warm rows during revalidation', async ({ page }) => {
  const checkpoint = { itemId: 'retired', scrollOffset: 2200 };
  const writes = [];
  await page.route('**/api/v1/feed/workspace', route => route.fulfill({ json: {
    preferencesStored: true, checkpoints: { reader: checkpoint },
  } }));
  await page.route('**/api/v1/feed/workspace/checkpoints/reader', route => {
    writes.push(route.request().postDataJSON());
    return route.fulfill({ json: {} });
  });
  const items = Array.from({ length: 98 }, (_, i) => article(String(i), 'Story ' + i));
  let reads = 0;
  let revalidate;
  const payload = { json: { items, exhausted: true } };
  await page.route('**/api/v1/feed/reader/stream?**', route => {
    reads++;
    if (reads === 1) return;
    if (reads === 2) return route.fulfill(payload);
    revalidate = route;
  });
  await page.goto('/feed/reader');
  await expect.poll(() => reads).toBe(1);
  const headlines = page.getByRole('link', { name: 'Headlines', exact: true });
  const reader = page.getByRole('link', { name: 'Reader', exact: true });
  await headlines.click();
  await expect.poll(() => writes.length).toBeGreaterThanOrEqual(2);
  for (const write of writes) expect(write).toMatchObject(checkpoint);
  await reader.click();
  const inbox = page.locator('.reader-inbox');
  await expect.poll(() => inbox.evaluate(el => el.scrollTop)).toBe(2200);
  await inbox.evaluate(el => { el.scrollTop = 1500; });
  await headlines.click();
  await reader.click();
  await expect.poll(() => Boolean(revalidate)).toBe(true);
  await expect.poll(() => inbox.evaluate(el => el.scrollTop)).toBe(1500);
  await revalidate.fulfill(payload);
  await expect(inbox.getByRole('button', { name: 'Refresh' })).toBeEnabled();
  expect(await inbox.evaluate(el => el.scrollTop)).toBe(1500);
});

test('Reader refreshes the reopened article when a pending note saves', async ({ page }) => {
  const reads = [];
  let save;
  let notes = [];
  let failNotesRead = false;
  await page.route('**/api/v1/feed/reader/stream?**', route => route.fulfill({ json: {
    items: [article('note-story', 'Article with a pending note'), article('other-story', 'Another article')],
    exhausted: true,
  } }));
  await page.route('**/api/v1/feed/annotations?**', route => {
    const itemId = new URL(route.request().url()).searchParams.get('itemId');
    reads.push(itemId);
    if (failNotesRead) return route.abort('failed');
    return route.fulfill({ json: { annotations: itemId === 'note-story' ? notes : [] } });
  });
  await page.route('**/api/v1/feed/annotations', route => { save = route; });

  await page.goto('/feed/reader');
  const articleHeader = page.getByRole('button', { name: /Article with a pending note/ });
  const otherHeader = page.getByRole('button', { name: /Another article/ });
  await articleHeader.click();
  await otherHeader.click();
  const story = page.locator('[id="article-note-story"]');
  const other = page.locator('[id="article-other-story"]');
  const note = story.getByRole('textbox', { name: 'Add a note' });
  await expect(other.getByRole('textbox', { name: 'Add a note' })).toBeVisible();
  await note.fill('Remember this story');
  await story.getByRole('button', { name: 'Save note' }).click();
  await expect.poll(() => save?.request().method()).toBe('POST');
  await articleHeader.click();
  await expect(note).toHaveCount(0);
  await articleHeader.click();
  await expect(note).toBeVisible();
  expect(reads.filter(id => id === 'note-story')).toHaveLength(2);

  const saved = { ...save.request().postDataJSON(), createdAt: '2026-07-01T12:30:00Z' };
  expect(saved.itemId).toBe('note-story');
  notes = [saved];
  await save.fulfill({ json: { annotation: saved } });

  await expect(story.getByText('Remember this story', { exact: true })).toBeVisible();
  await expect.poll(() => reads.filter(id => id === 'note-story').length).toBe(3);
  await expect(other.getByText('Remember this story', { exact: true })).toHaveCount(0);
  expect(reads.filter(id => id === 'other-story')).toHaveLength(1);

  failNotesRead = true;
  await articleHeader.click();
  await articleHeader.click();
  await expect(story.getByText('Showing notes saved on this device.')).toBeVisible();
  await expect(story.getByText('Remember this story', { exact: true })).toBeVisible();
});

test('Reader keeps a retired account note acknowledgement out of the replacement account', async ({ page, context }) => {
  const token = owner => 'header.' + Buffer.from(JSON.stringify({ sub: owner })).toString('base64url') + '.signature';
  const ownerOf = route => route.request().headers().authorization === 'Bearer ' + token('bob') ? 'bob' : 'amy';
  let save;
  let bobReads = 0;
  let bobRead;
  await page.addInitScript(amy => { if (!localStorage.getItem('ds_token')) localStorage.setItem('ds_token', amy); }, token('amy'));
  await page.route('**/api/v1/feed/workspace', route => route.fulfill({ json: { preferencesStored: true } }));
  await page.route('**/api/v1/feed/reader/stream?**', route => route.fulfill({ json: {
    items: [article('shared-note-story', ownerOf(route) + ' shared article')], exhausted: true,
  } }));
  await page.route('**/api/v1/feed/annotations?**', route => {
    if (ownerOf(route) === 'amy') return route.fulfill({ json: { annotations: [] } });
    bobReads++;
    bobRead = route;
  });
  await page.route('**/api/v1/feed/annotations', route => { save = route; });

  await page.goto('/feed/reader');
  await page.getByRole('button', { name: /amy shared article/ }).click();
  await page.getByRole('textbox', { name: 'Add a note' }).fill('Amy private note');
  await page.getByRole('button', { name: 'Save note' }).click();
  await expect.poll(() => save && ownerOf(save)).toBe('amy');

  await context.route('**/note-test-tab', route => route.fulfill({ contentType: 'text/html', body: '<title>Account switch</title>' }));
  const switcher = await context.newPage();
  await switcher.goto('/note-test-tab');
  await switcher.evaluate(bob => {
    localStorage.setItem('feed:annotation-cache:bob', JSON.stringify([
      { id: 'bob-cached', itemId: 'shared-note-story', note: 'Bob cached note' },
    ]));
    localStorage.setItem('ds_token', bob);
  }, token('bob'));
  await page.getByRole('button', { name: /bob shared article/ }).click();
  await expect.poll(() => bobReads).toBe(1);

  const acknowledgement = page.waitForEvent('requestfinished', request => request === save.request());
  await save.fulfill({ json: { annotation: save.request().postDataJSON() } });
  await acknowledgement;
  await bobRead.abort('failed');
  await expect(page.getByText('Bob cached note', { exact: true })).toBeVisible();
  await expect(page.getByText('Amy private note', { exact: true })).toHaveCount(0);
  expect(bobReads).toBe(1);
  expect(await switcher.evaluate(() => JSON.parse(localStorage.getItem('feed:annotation-cache:bob')))).toEqual([
    { id: 'bob-cached', itemId: 'shared-note-story', note: 'Bob cached note' },
  ]);
  await switcher.close();
});

test('Reader shows a late offline save in the reopened article and replays it once', async ({ page }) => {
  let write;
  let sent = 0;
  let saved;
  await page.route('**/api/v1/feed/reader/stream?**', route => route.fulfill({ json: {
    items: [article('notes', 'First story'), article('other', 'Other story')], exhausted: true,
  } }));
  await page.route('**/api/v1/feed/annotations?**', route => {
    const itemId = new URL(route.request().url()).searchParams.get('itemId');
    return route.fulfill({ json: { annotations: saved && itemId === 'notes' ? [saved] : [] } });
  });
  await page.route('**/api/v1/feed/annotations', route => {
    if (++sent === 1) { write = route; return; }
    saved = { ...route.request().postDataJSON(), note: 'Reconciled note' };
    return route.fulfill({ json: { annotation: saved } });
  });
  await page.goto('/feed/reader');
  const first = page.getByRole('button', { name: /First story/ });
  await first.click();
  await page.getByRole('button', { name: /Other story/ }).click();
  const story = page.locator('#article-notes');
  const other = page.locator('#article-other');
  const draft = story.getByRole('textbox', { name: 'Add a note' });
  await draft.fill('Pending note');
  await story.getByRole('button', { name: 'Save note' }).click();
  await expect.poll(() => Boolean(write)).toBe(true);
  await first.click();
  await expect(draft).toHaveCount(0);
  await first.click();
  await expect(draft).toBeVisible();
  await write.abort('failed');
  await expect(story.getByText('Pending note', { exact: true })).toBeVisible();
  await expect(story.getByText('1 note change waiting to sync.')).toBeVisible();
  await expect(other.getByText('Pending note', { exact: true })).toHaveCount(0);
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await expect(story.getByText('Reconciled note', { exact: true })).toBeVisible();
  await expect(story.getByText('1 note change waiting to sync.')).toHaveCount(0);
  expect(sent).toBe(2);
});

test('Reader observes a note queued and acknowledged in another tab', async ({ page, context }) => {
  const original = { id: 'note', itemId: 'story', note: 'Original note' };
  const updated = { ...original, note: 'Server revision' };
  let reads = 0;
  const writes = [];
  await page.route('**/api/v1/feed/reader/stream?**', route => route.fulfill({ json: {
    items: [article('story', 'Shared story')], exhausted: true,
  } }));
  await page.route('**/api/v1/feed/annotations?**', route => {
    reads++;
    return reads === 1 ? route.fulfill({ json: { annotations: [original] } }) : route.abort('failed');
  });
  await page.route('**/api/v1/feed/annotations/note', route => {
    writes.push(route.request().method());
    return route.fulfill({ json: { annotation: updated } });
  });
  await page.goto('/feed/reader');
  await page.getByRole('button', { name: /Shared story/ }).click();
  await expect(page.getByText(original.note, { exact: true })).toBeVisible();
  const writer = await context.newPage();
  await writer.route('**/notes-writer', route => route.fulfill({ contentType: 'text/html', body: '<title>Notes writer</title>' }));
  await writer.goto('/notes-writer');
  const operation = {
    queueId: 'pending-edit', method: 'PATCH', path: '/api/v1/feed/annotations/note',
    data: { note: 'Pending revision' }, createdAt: '2026-07-01T12:00:00Z',
  };
  await writer.evaluate(row => localStorage.setItem('feed:annotation-queue:household', JSON.stringify([row])), operation);
  await expect(page.getByText('Pending revision', { exact: true })).toBeVisible();
  await expect(page.getByText('1 note change waiting to sync.')).toBeVisible();
  await writer.evaluate(note => {
    localStorage.setItem('feed:annotation-cache:household', JSON.stringify([note]));
    localStorage.setItem('feed:annotation-queue:household', '[]');
  }, updated);
  await expect(page.getByText(updated.note, { exact: true })).toBeVisible();
  await expect(page.getByText('1 note change waiting to sync.')).toHaveCount(0);
  expect(writes).toEqual([]);
  await writer.close();
});
