import { expect, test } from '@playwright/test';

test.use({ serviceWorkers: 'block' });

function editionResponse(edition, title) {
  const story = {
    id: `${edition}-briefing`, title, leadSource: edition === 'local' ? 'Local source' : 'World source',
    sourceCount: 1,
    coverage: [{
      id: edition, sourceId: 'daily', sourceLabel: edition === 'local' ? 'Local source' : 'World source',
      title, url: `https://example.test/${edition}`, state: { isArchived: false, isSaved: false, isRead: false },
    }],
  };
  return {
    grid: { rows: ['main'], cols: ['main'] },
    sources: { daily: {
      label: edition === 'local' ? 'Local source' : 'World source',
      row: 0,
      col: 0,
      url: 'https://example.test/feed',
      items: [{ id: edition, title, link: `https://example.test/${edition}` }],
    } },
    briefing: [story],
  };
}

test('Feed keeps focus in Headlines while retrying an unavailable edition', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 850 });
  const reads = [];
  let retryRead;
  await page.routeWebSocket('**/*', () => {});
  await page.route('**/api/**', route => {
    const { pathname, searchParams } = new URL(route.request().url());
    if (pathname.endsWith('/headlines/pages')) return route.fulfill({ json: [{ id: 'local', label: 'Local news' }] });
    if (pathname.endsWith('/headlines') && searchParams.has('page')) {
      reads.push([route.request().method(), searchParams.get('page')]);
      if (reads.length === 1) return route.fulfill({ status: 500, json: { message: 'Edition unavailable' } });
      retryRead = route;
      return;
    }
    return route.fulfill({ json: pathname.endsWith('/supervision/bootstrap') ? { enabled: false } : {} });
  });

  await page.goto('/feed/headlines/local?view=briefing');
  await expect(page.getByRole('alert')).toContainText('This edition could not be refreshed.');
  await expect(page.getByText('No headlines are available for this edition.')).toHaveCount(0);
  await page.getByRole('button', { name: 'Retry', exact: true }).press('Enter');
  await expect.poll(() => reads).toEqual([['GET', 'local'], ['GET', 'local']]);
  const section = page.getByRole('region', { name: 'Headlines', exact: true });
  await expect(section).toBeFocused();
  await expect(section).toHaveAttribute('aria-busy', 'true');
  await expect(section.getByRole('status')).toHaveText('Loading headlines…');
  await retryRead.fulfill({ json: editionResponse('local', 'Recovered local headline') });
  await expect(section.getByRole('link', { name: 'Recovered local headline' })).toBeVisible();
  await expect(section).toBeFocused();
  await expect(section).not.toHaveAttribute('aria-busy', 'true');
});

test('Feed Briefing shows its empty state after archiving the last visible story and Undo restores it', async ({ page }) => {
  const actions = [];
  const item = {
    id: 'briefing-item', title: 'Last briefing story', link: 'https://example.test/story',
    sourceId: 'daily', sourceLabel: 'Daily', state: { isArchived: false, isSaved: false, isRead: false },
  };
  await page.routeWebSocket('**/*', () => {});
  await page.route('**/api/**', route => {
    const request = route.request();
    const { pathname } = new URL(request.url());
    if (pathname.endsWith('/supervision/bootstrap')) return route.fulfill({ json: { enabled: false } });
    if (pathname.endsWith('/workspace')) return route.fulfill({ json: { preferencesStored: true } });
    if (pathname.endsWith('/items/state/summary')) return route.fulfill({ json: { readerUnread: 1, pendingSync: 0 } });
    if (pathname.endsWith('/items/state')) {
      const action = request.postDataJSON().action;
      actions.push(action);
      return route.fulfill({ json: { items: [{ id: item.id, state: { ...item.state, isArchived: action === 'archive' } }] } });
    }
    if (pathname.endsWith('/headlines/pages')) return route.fulfill({ json: [{ id: 'local', label: 'Local' }] });
    if (pathname.endsWith('/headlines')) return route.fulfill({ json: {
      grid: { rows: ['main'], cols: ['main'] }, sources: {},
      briefing: [{
        id: 'briefing-story', title: item.title, leadSource: 'Daily', sourceCount: 1,
        coverage: [item],
      }],
    } });
    return route.fulfill({ json: {} });
  });

  await page.goto('/feed/headlines/local?view=briefing');
  await expect(page.getByRole('heading', { name: item.title })).toBeVisible();
  await page.getByRole('button', { name: 'Archive', exact: true }).click();
  await expect(page.getByText('No headlines are available for this edition.')).toBeVisible();
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(page.getByRole('heading', { name: item.title })).toBeVisible();
  await expect(page.getByText('No headlines are available for this edition.')).toHaveCount(0);
  expect(actions).toEqual(['archive', 'unarchive']);
});

test('Feed keeps an acknowledged headline read when an earlier save fails', async ({ page }) => {
  const actions = [];
  let saveRequest;
  await page.routeWebSocket('**/*', () => {});
  await page.route('**/api/**', async route => {
    const request = route.request();
    const { pathname, searchParams } = new URL(request.url());
    if (pathname.endsWith('/supervision/bootstrap')) return route.fulfill({ json: { enabled: false } });
    if (pathname.endsWith('/workspace')) return route.fulfill({ json: { preferencesStored: true } });
    if (pathname.endsWith('/items/state/summary')) return route.fulfill({ json: { readerUnread: 1, pendingSync: 0 } });
    if (pathname.endsWith('/items/state')) {
      const operation = request.postDataJSON().action;
      actions.push(operation);
      if (operation === 'save') {
        saveRequest = route;
        return;
      }
      return route.fulfill({ json: { items: [{ id: 'local', state: { isRead: true, isSaved: false } }] } });
    }
    if (pathname.endsWith('/headlines/pages')) return route.fulfill({ json: [{ id: 'local', label: 'Local' }] });
    if (pathname.endsWith('/headlines') && searchParams.has('page')) {
      return route.fulfill({ json: editionResponse('local', 'Morning story') });
    }
    return route.fulfill({ json: {} });
  });

  await page.goto('/feed/headlines/local');
  await page.getByRole('button', { name: 'Save Morning story' }).press('Enter');
  await expect.poll(() => actions.slice()).toEqual(['save']);
  await page.getByRole('button', { name: 'Mark read: Morning story' }).press('Enter');
  await expect.poll(() => actions.slice()).toEqual(['save', 'read']);
  await expect(page.getByRole('button', { name: 'Mark unread: Morning story' })).toBeVisible();

  await saveRequest.fulfill({ status: 500, json: { error: 'Save failed' } });
  await expect(page.getByRole('button', { name: 'Mark unread: Morning story' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Save Morning story' })).toBeVisible();
});

test('Feed links to the first configured edition and keeps a usable default when the pages read fails', async ({ page }) => {
  let available = true;
  await page.routeWebSocket('**/*', () => {});
  await page.route('**/api/**', route => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/headlines/pages')) {
      return available
        ? route.fulfill({ json: [{ id: 'local', label: 'Local news' }, { id: 'world', label: 'World' }] })
        : route.fulfill({ status: 404, json: { error: 'unavailable' } });
    }
    return route.fulfill({ json: path.endsWith('/supervision/bootstrap') ? { enabled: false } : {} });
  });
  await page.goto('/feed/search');
  const headlines = page.getByRole('link', { name: 'Headlines' });
  await expect(headlines).toHaveAttribute('href', '/feed/headlines/local');
  await headlines.click();
  await page.getByLabel('Headline edition').selectOption('world');
  await expect(page).toHaveURL(/\/feed\/headlines\/world$/);

  available = false;
  const failed = page.waitForResponse(response => response.url().includes('/headlines/pages') && response.status() === 404);
  await page.goto('/feed/search');
  await failed;
  await expect(headlines).toHaveAttribute('href', '/feed/headlines/mainstream');
  await expect(page.getByRole('main', { name: 'Feed' })).toBeVisible();
});

test('Feed entry redirects replace their history entries and share the main region across destinations', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 850 });
  await page.addInitScript(() => { window.fixtureHistoryLength = history.length; });
  await page.routeWebSocket('**/*', () => {});
  await page.route('**/api/**', route => {
    const { pathname } = new URL(route.request().url());
    if (pathname.endsWith('/supervision/bootstrap')) return route.fulfill({ json: { enabled: false } });
    if (pathname.endsWith('/headlines/pages')) return route.fulfill({ json: [{ id: 'mainstream', label: 'Mainstream' }] });
    if (pathname.endsWith('/scroll/sessions')) return route.fulfill({ json: { items: [], hasMore: false } });
    return route.fulfill({ json: {} });
  });

  const modes = page.getByRole('navigation', { name: 'Feed modes' });
  const scroll = modes.getByRole('link', { name: 'Scroll', exact: true });
  const headlines = modes.getByRole('link', { name: 'Headlines', exact: true });
  const main = page.getByRole('main', { name: 'Feed' });

  await page.goto('/feed');
  await expect(page).toHaveURL(/\/feed\/scroll$/);
  await expect(scroll).toHaveAttribute('aria-current', 'page');
  expect(await page.evaluate(() => history.length - window.fixtureHistoryLength)).toBe(0);

  const originalMain = await main.elementHandle();
  await headlines.click();
  await expect(page).toHaveURL(/\/feed\/headlines\/mainstream$/);
  await expect(headlines).toHaveAttribute('aria-current', 'page');
  await expect(page.getByRole('button', { name: 'Refresh all', exact: true })).toBeVisible();
  await page.setViewportSize({ width: 1440, height: 850 });
  expect(await main.evaluate((node, original) => node === original, originalMain)).toBe(true);
  await expect(page.getByRole('main')).toHaveCount(1);

  await page.goBack({ waitUntil: 'commit' });
  await expect(page).toHaveURL(/\/feed\/scroll$/);
  await expect(scroll).toHaveAttribute('aria-current', 'page');
  expect(await main.evaluate((node, original) => node === original, originalMain)).toBe(true);
  await originalMain.dispose();

  await page.goto('/feed/headlines', { waitUntil: 'domcontentloaded' });
  await expect(page).toHaveURL(/\/feed\/headlines\/mainstream$/);
  await expect(headlines).toHaveAttribute('aria-current', 'page');
  expect(await page.evaluate(() => history.length - window.fixtureHistoryLength)).toBe(0);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(headlines).toHaveAttribute('aria-current', 'page');
  await expect(main).toBeVisible();
});

for (const refresh of [
  { button: 'Refresh all', endpoint: '/headlines/harvest' },
  { button: 'Refresh Local source', endpoint: '/headlines/harvest/daily' },
  { button: 'Refresh all', endpoint: '/headlines/harvest', partial: { harvested: 2, errors: 1 } },
  { button: 'Refresh all', endpoint: '/headlines/harvest', rejected: true },
]) {
  const title = refresh.partial
    ? 'Feed reports partial headline source failures only on the submitted edition'
    : refresh.rejected
    ? 'Feed reports a failed harvest after returning to the submitted edition'
    : `Feed ${refresh.button} completion stays with the submitted headline edition`;
  test(title, async ({ page }) => {
    const harvestStarted = Promise.withResolvers();
    const releaseHarvest = Promise.withResolvers();
    const reads = [];
    let harvests = 0;
    let retryRead;
    let harvested = false;
    await page.routeWebSocket('**/*', () => {});
    await page.route('**/api/**', async route => {
      const { pathname, searchParams } = new URL(route.request().url());
      if (pathname.endsWith('/headlines/pages')) {
        return route.fulfill({ json: [{ id: 'local', label: 'Local news' }, { id: 'world', label: 'World' }] });
      }
      if (pathname.endsWith(refresh.endpoint)) {
        harvests += 1;
        harvestStarted.resolve();
        await releaseHarvest.promise;
        if (refresh.rejected) return route.fulfill({ status: 500, json: { message: 'Harvest unavailable' } });
        harvested = true;
        return route.fulfill({ json: refresh.partial || {} });
      }
      if (pathname.endsWith('/headlines') && searchParams.has('page')) {
        const edition = searchParams.get('page');
        reads.push(edition);
        if (refresh.rejected && reads.length === 4) {
          retryRead = route;
          return;
        }
        const local = edition === 'local';
        const title = local ? (harvested ? 'Updated local headline' : 'Local headline') : 'World headline';
        return route.fulfill({ json: editionResponse(edition, title) });
      }
      return route.fulfill({ json: pathname.endsWith('/supervision/bootstrap') ? { enabled: false } : {} });
    });

    await page.goto('/feed/headlines/local');
    await expect(page.getByRole('link', { name: 'Local headline', exact: true })).toBeVisible();
    await page.getByRole('button', { name: refresh.button, exact: true }).click();
    await harvestStarted.promise;
    const edition = page.getByLabel('Headline edition');
    await edition.selectOption('world');
    await expect(page.getByRole('link', { name: 'World headline' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Refresh all', exact: true })).toBeEnabled();

    if (refresh.partial) {
      releaseHarvest.resolve();
      const result = page.waitForResponse(response => new URL(response.url()).pathname.endsWith(refresh.endpoint));
      await (await result).finished();
      await expect(page.getByRole('status').filter({ hasText: /1 of 2 sources could not refresh/ })).toHaveCount(0);
      await edition.selectOption('local');
      await expect(page.getByRole('link', { name: 'Updated local headline', exact: true })).toBeVisible();
      await expect(page.getByRole('status').filter({ hasText: '1 of 2 sources could not refresh' })).toBeVisible();
      expect(reads).toEqual(['local', 'world', 'local']);
      expect(harvests).toBe(1);
      return;
    }

    if (refresh.rejected) {
      await edition.selectOption('local');
      await expect(page.getByRole('button', { name: 'Refreshing…' })).toBeDisabled();
      await expect.poll(() => reads.slice()).toEqual(['local', 'world', 'local']);
      releaseHarvest.resolve();
      const alert = page.getByRole('alert').filter({ hasText: 'Sources could not be refreshed' });
      await expect(alert).toBeVisible();
      expect(reads).toEqual(['local', 'world', 'local']);
      await alert.getByRole('button', { name: 'Reload stored edition' }).press('Enter');
      await expect.poll(() => reads).toEqual(['local', 'world', 'local', 'local']);
      const section = page.getByRole('region', { name: 'Headlines', exact: true });
      await expect(section).toBeFocused();
      await expect(section).toHaveAttribute('aria-busy', 'true');
      await expect(section.getByRole('link', { name: 'Local headline', exact: true })).toBeVisible();
      await page.keyboard.press('Tab');
      const outlets = section.getByRole('button', { name: 'Outlets', exact: true });
      await expect(outlets).toBeFocused();
      await retryRead.fulfill({ json: editionResponse('local', 'Recovered local headline') });
      await expect(alert).toBeHidden();
      await expect(section.getByRole('link', { name: 'Recovered local headline', exact: true })).toBeVisible();
      await expect(outlets).toBeFocused();
      await expect(section).not.toHaveAttribute('aria-busy', 'true');
      await expect(page.getByRole('button', { name: 'Refresh all', exact: true })).toBeEnabled();
      expect(reads).toEqual(['local', 'world', 'local', 'local']);
      expect(harvests).toBe(1);
      return;
    }

    const result = page.waitForResponse(response => new URL(response.url()).pathname.endsWith(refresh.endpoint));
    releaseHarvest.resolve();
    await (await result).finished();
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    expect(reads).toEqual(['local', 'world']);
    await expect(page.getByRole('link', { name: 'World headline' })).toBeVisible();

    await edition.selectOption('local');
    await expect(page.getByRole('link', { name: 'Updated local headline' })).toBeVisible();
    expect(reads).toEqual(['local', 'world', 'local']);
  });
}

test('Feed opens headlines while badge counts load and keeps counts from the latest item change', async ({ page }) => {
  const firstSummary = Promise.withResolvers();
  const release = Promise.withResolvers();
  const reads = [];
  const actions = [];
  await page.routeWebSocket('**/*', () => {});
  await page.route('**/api/**', async route => {
    const req = route.request();
    const { pathname } = new URL(req.url());
    if (pathname.endsWith('/supervision/bootstrap')) return route.fulfill({ json: { enabled: false } });
    if (pathname.endsWith('/workspace')) return route.fulfill({ json: { preferencesStored: true } });
    if (pathname.endsWith('/items/state/summary')) {
      reads.push(pathname);
      if (reads.length === 1) {
        firstSummary.resolve();
        await release.promise;
        return route.fulfill({ json: { readerUnread: 8, pendingSync: 0 } });
      }
      return route.fulfill({ json: { readerUnread: 7, pendingSync: 0 } });
    }
    if (pathname.endsWith('/items/state')) {
      actions.push(req.postDataJSON());
      return route.fulfill({ json: { items: [{ id: 'story', state: { isRead: true } }] } });
    }
    if (pathname.endsWith('/headlines/pages')) return route.fulfill({ json: [{ id: 'local', label: 'Local' }] });
    if (pathname.endsWith('/headlines')) return route.fulfill({ json: {
      grid: { rows: ['main'], cols: ['main'] }, sources: { daily: { row: 0, col: 0,
        label: 'Daily', url: 'https://example.test/feed', items: [{ id: 'story', title: 'Morning story', link: 'https://example.test/story' }] } },
    } });
    return route.fulfill({ json: {} });
  });
  await page.goto('/feed/headlines/local');
  await firstSummary.promise;
  try {
    await expect(page.getByRole('link', { name: 'Morning story' })).toBeVisible();
    await page.getByRole('button', { name: 'Mark read: Morning story' }).press('Enter');
    await expect(page.getByLabel('7 unread Reader items')).toBeVisible();
  } finally {
    release.resolve();
  }
  await expect(page.getByRole('button', { name: 'Mark unread: Morning story' })).toBeVisible();
  expect(actions).toEqual([{ itemIds: ['story'], action: 'read' }]);
  expect(reads).toHaveLength(2);
  await expect(page.getByLabel('7 unread Reader items')).toBeVisible();
});

test('Feed reads headline editions and Reader subscriptions for the replacement account', async ({ page, context }) => {
  const token = owner => 'header.' + Buffer.from(JSON.stringify({ sub: owner })).toString('base64url') + '.signature';
  const reads = { editions: [], subscriptions: [] };
  const workspaces = [];
  const oldReads = {};
  const canceled = [];
  page.on('requestfailed', request => canceled.push(request));
  const editions = owner => [{ id: owner + '-edition', label: owner + ' edition' }];
  const subscriptions = owner => [{ id: owner + '-feed', title: owner + ' feed', categories: [{ label: owner + ' subscriptions' }] }];
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.addInitScript(amy => { if (!localStorage.getItem('ds_token')) localStorage.setItem('ds_token', amy); }, token('amy'));
  await page.routeWebSocket('**/*', () => {});
  await page.route('**/api/**', route => {
    const { pathname } = new URL(route.request().url());
    const owner = route.request().headers().authorization === 'Bearer ' + token('bob') ? 'bob' : 'amy';
    const resource = pathname.endsWith('/headlines/pages') ? 'editions'
      : pathname.endsWith('/reader/feeds') ? 'subscriptions' : null;
    if (resource) {
      reads[resource].push(owner);
      if (owner === 'amy') {
        oldReads[resource] = route.request();
        return;
      }
      if (resource === 'subscriptions' && reads.subscriptions.filter(value => value === 'bob').length === 1) {
        return route.fulfill({ status: 503, json: { error: 'Temporarily unavailable' } });
      }
      return route.fulfill({ json: resource === 'editions' ? editions(owner) : subscriptions(owner) });
    }
    if (pathname.endsWith('/workspace')) {
      workspaces.push(owner);
      return route.fulfill({ json: { preferencesStored: true } });
    }
    if (pathname.endsWith('/reader/stream')) return route.fulfill({ json: { items: [], exhausted: true } });
    return route.fulfill({ json: pathname.endsWith('/supervision/bootstrap') ? { enabled: false } : {} });
  });

  await context.route('**/edition-test-tab', route => route.fulfill({ contentType: 'text/html', body: '<title>Account switch</title>' }));
  const switcher = await context.newPage();
  await switcher.goto('/edition-test-tab');
  await page.goto('/feed/reader');
  await expect.poll(() => reads).toEqual({ editions: ['amy'], subscriptions: ['amy'] });
  await switcher.evaluate(bob => localStorage.setItem('ds_token', bob), token('bob'));
  await expect.poll(() => workspaces).toContain('bob');
  await expect.poll(() => canceled).toEqual(expect.arrayContaining([oldReads.editions, oldReads.subscriptions]));

  await expect(page.getByRole('link', { name: 'Headlines', exact: true })).toHaveAttribute('href', '/feed/headlines/bob-edition');
  await expect(page.getByRole('button', { name: 'amy subscriptions', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Expand bob subscriptions' }).click();
  await expect(page.getByRole('button', { name: 'bob feed', exact: true })).toBeVisible();
  expect(reads).toEqual({ editions: ['amy', 'bob'], subscriptions: ['amy', 'bob', 'bob'] });
  await switcher.close();
});
