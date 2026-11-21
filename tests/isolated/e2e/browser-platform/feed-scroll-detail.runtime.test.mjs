import { test, expect } from '@playwright/test';

test.use({ serviceWorkers: 'block', viewport: { width: 390, height: 850 } });

const article = {
  id: 'reddit:fixture-detail',
  title: 'Feed detail ownership fixture',
  source: 'reddit',
  tier: 'wire',
  contentType: 'article',
  link: '/fixture-publisher',
  meta: { sourceName: 'Fixture' },
  state: { isRead: false },
};
const articleBody = 'The held request supplied this readable article.';
const sections = [{ type: 'article', data: { html: `<p>${articleBody}</p>` } }];
const detailPath = id => `/api/v1/feed/detail/${encodeURIComponent(id)}`;
const historyPath = id => `/api/v1/feed/items/${Buffer.from(id).toString('base64url')}`;
const scrollPath = id => `/feed/scroll/${Buffer.from(id).toString('base64url')}`;

test.beforeEach(async ({ page }) => {
  await page.routeWebSocket('**/ws', () => {});
  await page.route('**/api/**', route => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/supervision/bootstrap')) return route.fulfill({ json: { enabled: false } });
    if (path.endsWith('/headlines/pages')) return route.fulfill({ json: [] });
    if (path.endsWith('/feed/workspace')) return route.fulfill({ json: { preferencesStored: true } });
    if (path.endsWith('/scroll/sessions')) return route.fulfill({
      json: { items: [article], sessionId: 'detail-fixture', hasMore: false },
    });
    return route.fulfill({ json: {} });
  });
  await page.route('**/fixture-publisher', route => route.fulfill({ body: 'Original publisher fallback' }));
});

test('Feed detail actions keep independent pending commands across a responsive switch', async ({ page }) => {
  const endpoint = '/api/v1/feed/fixture-detail-action';
  const started = Promise.withResolvers();
  const release = Promise.withResolvers();
  const writes = [];
  const action = { id: 'bookmark', label: 'Bookmark article', endpoint, style: 'primary', body: { bookmark: true } };
  const other = { ...action, label: 'Dismiss suggestion', style: 'danger', method: 'PATCH', body: { dismiss: true } };
  await page.route(url => url.pathname === detailPath(article.id), route => route.fulfill({ json: { sections: [
    ...sections,
    { type: 'actions', data: { items: [action] } },
    { type: 'actions', data: { items: [other] } },
  ] } }));
  await page.route(url => url.pathname === endpoint, async route => {
    const request = route.request();
    writes.push([request.method(), request.postDataJSON()]);
    if (request.method() === 'POST' && writes.length === 1) {
      started.resolve();
      await release.promise;
      return route.fulfill({ status: 409, json: { error: 'Fixture refused the bookmark' } });
    }
    return route.fulfill({ json: { ok: true } });
  });
  await page.goto('/feed/scroll');
  await page.getByRole('button', { name: `Open: ${article.title}` }).click();
  const bookmark = page.getByRole('button', { name: action.label, exact: true });
  try {
    await bookmark.press('Enter');
    await started.promise;
    await expect(bookmark).toBeFocused();
    await expect(bookmark).toHaveAttribute('aria-busy', 'true');
    await page.keyboard.press('Enter');

    await page.setViewportSize({ width: 1440, height: 850 });
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByRole('button', { name: action.label, exact: true })).toHaveAttribute('aria-busy', 'true');
    await bookmark.press('Enter');
    await dialog.getByRole('button', { name: other.label, exact: true }).press('Enter');
    await expect.poll(() => writes).toEqual([['POST', { bookmark: true }], ['PATCH', { dismiss: true }]]);
  } finally {
    release.resolve();
  }
  await expect(page.getByRole('alert').filter({ hasText: 'Could not bookmark article.' })).toBeVisible();
  await expect(bookmark).toBeEnabled();
  await bookmark.press('Enter');
  await expect.poll(() => writes).toEqual([
    ['POST', { bookmark: true }], ['PATCH', { dismiss: true }], ['POST', { bookmark: true }],
  ]);
  await expect(page.getByRole('alert').filter({ hasText: 'Could not bookmark article.' })).toHaveCount(0);
});

for (const width of [390, 1440]) test(`Feed detail honors reduced motion at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: 850 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const next = { ...article, id: 'reddit:reduced-motion-next', title: 'Reduced motion next article' };
  await page.route('**/scroll/sessions', route => route.fulfill({ json: {
    items: [article, next], sessionId: 'reduced-motion', hasMore: false,
  } }));
  await page.addInitScript(() => {
    const animate = Element.prototype.animate;
    window.__detailAnimations = [];
    Element.prototype.animate = function (...args) {
      if (this.classList.contains('detail-content') || this.classList.contains('detail-sticky-header')) {
        window.__detailAnimations.push(this.className);
      }
      return animate.apply(this, args);
    };
    const NativeIntersectionObserver = window.IntersectionObserver;
    window.IntersectionObserver = class extends NativeIntersectionObserver {
      constructor(callback, options) {
        super(callback, options);
        this.callback = callback;
      }
      observe(target) {
        if (target.classList.contains('detail-close')) window.__detailCloseObserver = this;
        return super.observe(target);
      }
    };
  });
  await page.route('**/feed/detail/*', route => route.fulfill({ json: { sections } }));
  await page.goto('/feed/scroll');
  await page.getByRole('button', { name: `Open: ${article.title}` }).click();
  await page.evaluate(() => window.__detailCloseObserver.callback([{ intersectionRatio: 0 }], window.__detailCloseObserver));
  await expect(page.locator('.detail-sticky-header')).toHaveCSS('opacity', '1');
  await page.keyboard.press('ArrowRight');

  await expect(page).toHaveURL(scrollPath(next.id));
  expect(await page.evaluate(() => window.__detailAnimations)).toEqual([]);
  await expect(page.getByText(articleBody)).toBeVisible();
});

test('Feed clears a completed exit animation when reduced motion changes mid-transition', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  const next = { ...article, id: 'reddit:motion-change-next', title: 'Motion change next article' };
  await page.route('**/scroll/sessions', route => route.fulfill({ json: {
    items: [article, next], sessionId: 'motion-change', hasMore: false,
  } }));
  await page.addInitScript(() => {
    const animate = Element.prototype.animate;
    window.__heldExitAnimation = null;
    Element.prototype.animate = function (keyframes, options) {
      const animation = animate.call(this, keyframes, options);
      if (this.classList.contains('detail-content') && options?.duration === 150 && keyframes.at(-1)?.opacity === 0) {
        window.__heldExitAnimation = animation;
        animation.pause();
      }
      return animation;
    };
  });
  await page.route('**/feed/detail/*', route => route.fulfill({ json: { sections } }));
  await page.goto('/feed/scroll');
  await page.getByRole('button', { name: `Open: ${article.title}` }).click();
  await page.keyboard.press('ArrowRight');
  await expect.poll(() => page.evaluate(() => Boolean(window.__heldExitAnimation))).toBe(true);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.evaluate(() => window.__heldExitAnimation.finish());

  await expect(page).toHaveURL(scrollPath(next.id));
  await expect(page.locator('.detail-content')).toHaveCSS('opacity', '1');
  await expect(page.locator('.detail-content')).toHaveCSS('transform', 'none');
});

test('Feed coalesces repeated article navigation while an exit is pending', async ({ page }) => {
  const second = { ...article, id: 'reddit:repeat-second', title: 'Repeated navigation second article' };
  const third = { ...article, id: 'reddit:repeat-third', title: 'Repeated navigation third article' };
  await page.route('**/scroll/sessions', route => route.fulfill({ json: {
    items: [article, second, third], sessionId: 'repeat-navigation', hasMore: false,
  } }));
  await page.addInitScript(() => {
    window.__articleTransitions = [];
    Element.prototype.animate = function () {
      const transition = { onfinish: null, cancelled: false, cancel() { this.cancelled = true; } };
      Object.defineProperty(transition, 'onfinish', {
        get() { return this.activeFinish; },
        set(callback) {
          this.activeFinish = callback;
          if (callback) this.originalFinish = callback;
        },
      });
      window.__articleTransitions.push(transition);
      return transition;
    };
  });
  await page.route('**/feed/detail/*', route => route.fulfill({ json: { sections } }));
  await page.goto('/feed/scroll');
  await page.getByRole('button', { name: `Open: ${article.title}` }).click();
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');

  await expect.poll(() => page.evaluate(() => window.__articleTransitions.length)).toBe(1);
  await page.evaluate(() => window.__articleTransitions[0].onfinish?.());
  await expect(page).toHaveURL(scrollPath(second.id));
  await expect(page).not.toHaveURL(scrollPath(third.id));
});

for (const departure of ['Back', 'responsive layout change']) test(`Feed cancels a delayed article transition on ${departure}`, async ({ page }) => {
  const next = { ...article, id: 'reddit:cancel-transition-next', title: 'Cancel transition next article' };
  await page.route('**/scroll/sessions', route => route.fulfill({ json: {
    items: [article, next], sessionId: 'cancel-transition', hasMore: false,
  } }));
  await page.addInitScript(() => {
    window.__articleTransitions = [];
    const animate = Element.prototype.animate;
    Element.prototype.animate = function (...args) {
      if (this.classList.contains('detail-content') && args[1]?.duration === 150) {
        const transition = { onfinish: null, originalFinish: null, cancelled: false, cancel() { this.cancelled = true; } };
        Object.defineProperty(transition, 'onfinish', {
          get() { return this.activeFinish; },
          set(callback) {
            this.activeFinish = callback;
            if (callback) this.originalFinish = callback;
          },
        });
        transition.fireStale = () => transition.originalFinish?.();
        window.__articleTransitions.push(transition);
        return transition;
      }
      return animate.apply(this, args);
    };
  });
  await page.route('**/feed/detail/*', route => route.fulfill({ json: { sections } }));
  await page.goto('/feed/scroll');
  await page.getByRole('button', { name: `Open: ${article.title}` }).click();
  await page.keyboard.press('ArrowRight');
  await expect.poll(() => page.evaluate(() => window.__articleTransitions.length)).toBe(1);
  if (departure === 'Back') {
    await page.keyboard.press('Escape');
    await expect(page).toHaveURL('/feed/scroll');
  } else {
    await page.setViewportSize({ width: 1440, height: 850 });
    await expect(page.getByRole('dialog')).toBeVisible();
    await expect(page).toHaveURL(scrollPath(article.id));
  }

  expect(await page.evaluate(() => window.__articleTransitions[0].cancelled)).toBe(true);
  await page.evaluate(() => window.__articleTransitions[0].fireStale());
  await expect(page).toHaveURL(departure === 'Back' ? '/feed/scroll' : scrollPath(article.id));
});

test('Feed detail action feedback stays with the article visit that submitted it', async ({ page }) => {
  const second = { ...article, id: 'reddit:next-action-article', title: 'Next Feed action fixture' };
  const endpoint = '/api/v1/feed/fixture-detail-action';
  const started = Promise.withResolvers();
  const release = Promise.withResolvers();
  const writes = [];
  let firstReads = 0;
  await page.route('**/scroll/sessions', route => route.fulfill({ json: {
    items: [article, second], sessionId: 'two-action-articles', hasMore: false,
  } }));
  for (const item of [article, second]) {
    await page.route(url => url.pathname === detailPath(item.id), route => {
      const refreshed = item === article && ++firstReads > 1;
      const detail = refreshed ? [{ type: 'article', data: { html: '<p>Context returned on revisit.</p>' } }, ...sections] : sections;
      const body = refreshed ? { saved: true, id: item.id } : { id: item.id, saved: true };
      return route.fulfill({ json: { sections: [
        ...detail, { type: 'actions', data: { items: [{ id: 'bookmark', label: 'Bookmark article', endpoint, body }] } },
      ] } });
    });
  }
  await page.route(url => url.pathname === endpoint, async route => {
    writes.push(route.request().postDataJSON());
    if (writes.length === 1) {
      started.resolve();
      await release.promise;
      return route.fulfill({ status: 409, json: { error: 'Departed article refused' } });
    }
    return route.fulfill({ json: { ok: true } });
  });
  await page.goto('/feed/scroll');
  await page.getByRole('button', { name: `Open: ${article.title}` }).click();
  const bookmark = page.getByRole('button', { name: 'Bookmark article', exact: true });
  await bookmark.press('Enter');
  await started.promise;
  try {
    const navigation = page.getByRole('navigation', { name: 'Article navigation' });
    await navigation.getByRole('button', { name: 'Next', exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`${scrollPath(second.id)}$`));
    await expect(bookmark).toBeEnabled();
    await bookmark.press('Enter');
    await expect.poll(() => writes).toEqual([{ id: article.id, saved: true }, { id: second.id, saved: true }]);
    await navigation.getByRole('button', { name: 'Previous', exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`${scrollPath(article.id)}$`));
    await expect(page.getByText('Context returned on revisit.', { exact: true })).toBeVisible();
    await expect(bookmark).toHaveAttribute('aria-busy', 'true');
    await bookmark.press('Enter');
  } finally {
    release.resolve();
  }
  await expect(bookmark).toBeEnabled();
  expect(writes).toEqual([{ id: article.id, saved: true }, { id: second.id, saved: true }]);
  await expect(page.getByRole('alert').filter({ hasText: 'Could not bookmark article.' })).toHaveCount(0);
});

for (const cold of [false, true]) {
  test(`Feed keeps the ${cold ? 'cold history' : 'in-batch'} detail GET across a layout switch`, async ({ page }) => {
    const id = cold ? 'reddit:outside-batch' : article.id;
    const path = cold ? historyPath(id) : detailPath(id);
    const requests = [];
    const failures = [];
    const readWrites = [];
    let release;
    const held = new Promise(resolve => { release = resolve; });
    page.on('requestfailed', request => {
      if (new URL(request.url()).pathname === path) failures.push(request.failure().errorText);
    });
    page.on('request', request => {
      if (request.method() === 'PATCH' && new URL(request.url()).pathname === '/api/v1/feed/items/state') {
        readWrites.push(request.postDataJSON());
      }
    });
    await page.route(url => url.pathname === path, async route => {
      requests.push(route.request().method());
      await held;
      await route.fulfill({ json: cold ? { item: { ...article, id }, sections } : { sections } });
    });
    try {
      if (cold) {
        await page.setViewportSize({ width: 1440, height: 850 });
        await page.goto(scrollPath(id));
      } else {
        await page.goto('/feed/scroll');
        await page.getByRole('button', { name: `Open: ${article.title}` }).click();
      }
      await expect.poll(() => requests).toEqual(['GET']);
      await page.setViewportSize({ width: cold ? 390 : 1440, height: 850 });
      if (cold) await expect(page.locator('.scroll-view')).toHaveCSS('display', 'none');
      else await expect(page.getByRole('dialog')).toBeVisible();
      release();

      await expect(page.getByText(articleBody, { exact: true })).toBeVisible();
      await expect(page.getByRole('link', { name: 'Open in browser' })).toHaveAttribute('href', article.link);
      expect(new URL(page.url()).pathname).toBe(scrollPath(id));
      expect(requests).toEqual(['GET']);
      expect(failures).toEqual([]);
      const expectedReadWrites = cold ? [] : [{ itemIds: [id], action: 'read' }];
      expect(readWrites).toEqual(expectedReadWrites);
    } finally {
      release();
    }
  });
}

test('Feed retries the current detail after changing items and keeps its original link', async ({ page }) => {
  const second = {
    ...article,
    id: 'reddit:current-detail',
    title: 'Current Feed item',
    link: '/other-publisher',
    meta: { paywall: true, paywallProxy: '/fixture-archive?url=' },
  };
  await page.route('**/scroll/sessions', route => route.fulfill({
    json: { items: [article, second], sessionId: 'two-articles', hasMore: false },
  }));
  await page.route('**/fixture-archive?**', route => route.fulfill({ body: 'Archived publisher article' }));
  let release;
  const departed = new Promise(resolve => { release = resolve; });
  let started = false;
  await page.route(url => url.pathname === detailPath(article.id), async route => {
    started = true;
    await departed;
    await route.fulfill({ json: { sections } });
  });
  let reads = 0;
  const secondBody = 'The reader view for the second article recovered.';
  await page.route(url => url.pathname === detailPath(second.id), route => {
    if (++reads === 1) return route.fulfill({ status: 404, json: { error: 'Unavailable' } });
    return route.fulfill({ json: { sections: [{ type: 'article', data: { html: `<p>${secondBody}</p>` } }] } });
  });
  try {
    await page.goto('/feed/scroll');
    await page.getByRole('button', { name: `Open: ${article.title}` }).click();
    await expect.poll(() => started).toBe(true);
    const retired = page.waitForEvent('requestfailed', request =>
      new URL(request.url()).pathname === detailPath(article.id));
    await page.getByRole('button', { name: 'Next', exact: true }).first().click();
    await retired;
    await expect(page).toHaveURL(scrollPath(second.id));
    const original = page.getByRole('link', { name: 'Open via archive' });
    await expect(original).toHaveAttribute('href', second.meta.paywallProxy + second.link);
    await page.getByRole('button', { name: 'Try reader view again' }).click();
    release();
    await expect(page.getByText(secondBody, { exact: true })).toBeVisible();
    await expect(page.getByText(articleBody, { exact: true })).toHaveCount(0);
    await expect(original).toHaveAttribute('href', second.meta.paywallProxy + second.link);
    expect(reads).toBe(2);
  } finally {
    release();
  }
});

test('Feed keeps an invalid link error after the previous item’s offline lookup rejects', async ({ page }) => {
  const id = 'reddit:offline-missing';
  await page.addInitScript(() => {
    const open = indexedDB.open.bind(indexedDB);
    IDBFactory.prototype.open = (name, ...args) => {
      if (name !== 'daylight-feed-offline-v1') return open(name, ...args);
      const request = { error: new Error('Storage denied by fixture') };
      window.rejectDepartedEdition = () => request.onerror();
      return request;
    };
  });
  await page.route(url => url.pathname === historyPath(id), route => route.fulfill({ status: 404, json: { error: 'Unavailable' } }));
  await page.goto(scrollPath(id));
  await page.waitForFunction(() => typeof window.rejectDepartedEdition === 'function');
  await page.evaluate(() => {
    history.replaceState(history.state, '', '/feed/scroll/!');
    dispatchEvent(new PopStateEvent('popstate', { state: history.state }));
  });
  const alert = page.locator('.scroll-detail-error');
  const invalidLink = 'This Feed link is invalid. Return to Scroll and choose an item again.';
  await expect(alert).toContainText(invalidLink);
  await page.evaluate(async () => {
    window.rejectDepartedEdition();
    await new Promise(resolve => setTimeout(resolve, 0));
  });
  await expect(alert).toContainText(invalidLink);
});

test('Feed prunes a downloaded edition only within the account that started the save', async ({ page }) => {
  const alice = 'fixture-alice';
  const bob = 'fixture-bob';
  const downloadedKey = `${alice}:${article.id}`;
  await page.addInitScript(({ alice, bob, downloadedKey }) => {
    const token = sub => `token.${btoa(JSON.stringify({ sub }))}.signature`;
    localStorage.setItem('ds_token', token(alice));
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (row, ...args) {
      const request = put.call(this, row, ...args);
      if (row?.key === downloadedKey) {
        request.addEventListener('success', () => localStorage.setItem('ds_token', token(bob)), { once: true });
      }
      return request;
    };
  }, { alice, bob, downloadedKey });
  await page.route(url => url.pathname === historyPath(article.id), route => route.fulfill({ json: { item: article, sections } }));
  await page.goto(scrollPath(article.id));
  await page.evaluate(({ alice, bob }) => new Promise((resolve, reject) => {
    const request = indexedDB.open('daylight-feed-offline-v1', 1);
    request.onerror = () => reject(request.error);
    request.onupgradeneeded = () => {
      const store = request.result.createObjectStore('editions', { keyPath: 'key' });
      store.createIndex('user', 'user', { unique: false });
      store.createIndex('savedAt', 'savedAt', { unique: false });
    };
    request.onsuccess = () => {
      const db = request.result;
      const transaction = db.transaction('editions', 'readwrite');
      transaction.oncomplete = () => { db.close(); resolve(); };
      transaction.onabort = () => { db.close(); reject(transaction.error); };
      const store = transaction.objectStore('editions');
      for (const [user, total] of [[alice, 100], [bob, 101]]) {
        for (let index = 0; index < total; index++) {
          const id = `old-${index}`;
          store.put({ key: `${user}:${id}`, user, item: { id }, detail: null, savedAt: index });
        }
      }
    };
  }), { alice, bob });

  await expect(page.getByText(articleBody, { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Download', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Downloaded', exact: true })).toBeVisible();
  const currentOwner = await page.evaluate(() => JSON.parse(atob(localStorage.getItem('ds_token').split('.')[1])).sub);
  expect(currentOwner).toBe(bob);
  const records = await page.evaluate(() => new Promise((resolve, reject) => {
    const request = indexedDB.open('daylight-feed-offline-v1', 1);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      const transaction = db.transaction('editions', 'readonly');
      const read = transaction.objectStore('editions').getAll();
      transaction.oncomplete = () => { db.close(); resolve(read.result); };
      transaction.onabort = () => { db.close(); reject(transaction.error); };
    };
  }));
  expect(records.filter(row => row.user === alice).map(row => row.key).sort()).toEqual(
    [downloadedKey, ...Array.from({ length: 99 }, (_, index) => `${alice}:old-${index + 1}`)].sort()
  );
  expect(records.filter(row => row.user === bob).map(row => row.key).sort()).toEqual(
    Array.from({ length: 101 }, (_, index) => `${bob}:old-${index}`).sort()
  );
});

test('Feed opens a compact article ready for arrow navigation from its keyboard entry', async ({ page }) => {
  const next = { ...article, id: 'reddit:next-detail', title: 'Next Feed item' };
  await page.route('**/scroll/sessions', route => route.fulfill({
    json: { items: [article, next], sessionId: 'two-articles', hasMore: false },
  }));
  await page.route('**/feed/detail/*', route => route.fulfill({ json: { sections } }));
  await page.goto('/feed/scroll');

  await page.getByRole('button', { name: `Open: ${article.title}` }).press('Enter');
  await expect(page).toHaveURL(scrollPath(article.id));
  await page.keyboard.press('ArrowRight');
  await expect(page).toHaveURL(scrollPath(next.id));
  await expect(page.getByRole('button', { name: 'Back to feed' }).first()).toBeFocused();
  await page.keyboard.press('ArrowLeft');
  await expect(page).toHaveURL(scrollPath(article.id));
});

test('Feed desktop detail contains Tab and returns focus to the opening card after navigation', async ({ page }) => {
  const first = { ...article, id: 'reddit:previous-detail', title: 'Previous Feed item' };
  const third = { ...article, id: 'reddit:next-detail', title: 'Next Feed item' };
  await page.setViewportSize({ width: 1440, height: 850 });
  await page.route('**/scroll/sessions', route => route.fulfill({
    json: { items: [first, article, third], sessionId: 'three-articles', hasMore: false },
  }));
  await page.route('**/feed/detail/*', route => route.fulfill({ json: { sections } }));
  await page.goto('/feed/scroll');

  const opener = page.getByRole('button', { name: `Open: ${article.title}` });
  await opener.focus();
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog', { name: article.title });
  await expect(dialog).toBeVisible();
  await expect.poll(() => dialog.evaluate(element => element.contains(document.activeElement))).toBe(true);

  await page.keyboard.press('Shift+Tab');
  expect(await dialog.evaluate(element => element.contains(document.activeElement))).toBe(true);
  const next = dialog.getByRole('button', { name: 'Next item' });
  await expect(next).toBeFocused();
  await page.keyboard.press('Tab');
  const back = dialog.getByRole('button', { name: 'Back to feed' }).first();
  await expect(back).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(next).toBeFocused();

  await page.keyboard.press('ArrowRight');
  await expect(page).toHaveURL(scrollPath(third.id));
  const lastDialog = page.getByRole('dialog', { name: third.title });
  await expect.poll(() => lastDialog.evaluate(element => element.contains(document.activeElement))).toBe(true);
  const previous = lastDialog.getByRole('button', { name: 'Previous item' });
  await previous.focus();
  await page.keyboard.press('ArrowLeft');
  await expect(page).toHaveURL(scrollPath(article.id));
  await expect(dialog.getByRole('button', { name: 'Previous item' })).toBeFocused();

  await dialog.getByRole('button', { name: 'Download', exact: true }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'Available offline' })).toBeVisible();

  await page.keyboard.press('Escape');
  await expect(page).toHaveURL('/feed/scroll');
  await expect(dialog).toHaveCount(0);
  await expect(opener).toBeFocused();

  await page.keyboard.press('Enter');
  await expect(dialog).toBeVisible();
  await page.mouse.click(10, 10);
  await expect(page).toHaveURL('/feed/scroll');
  await expect(opener).toBeFocused();
});

const scrollArticle = (header, amount) => header.evaluate((element, y) => {
  for (let node = element.parentElement; node; node = node.parentElement) {
    if (node.scrollHeight > node.clientHeight + 100 && /auto|scroll/.test(getComputedStyle(node).overflowY)) {
      node.scrollTo(0, y);
      return;
    }
  }
  window.scrollTo(0, y);
}, amount);

test.describe('Feed card Archive on a coarse pointer', () => {
  test.use({ hasTouch: true });

  for (const variant of ['image', 'text']) {
    test(`Feed Scroll archives the ${variant} card from its full touch target`, async ({ page }) => {
      const item = variant === 'image' ? { ...article, image: '/fixture-feed-card.svg' } : article;
      const writes = [];
      await page.route('**/fixture-feed-card.svg', route => route.fulfill({
        contentType: 'image/svg+xml',
        body: '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="225"><rect width="400" height="225" fill="#234"/></svg>',
      }));
      await page.route('**/scroll/sessions', route => route.fulfill({
        json: { items: [item], sessionId: 'archive-fixture', hasMore: false },
      }));
      await page.route('**/feed/items/state', route => {
        writes.push(route.request().postDataJSON());
        return route.fulfill({ json: { items: [{ id: article.id, state: { isArchived: true } }] } });
      });

      await page.goto('/feed/scroll');
      const archive = page.getByRole('button', { name: 'Archive', exact: true });
      await expect(archive).toBeVisible();
      await archive.scrollIntoViewIfNeeded();
      expect(await page.evaluate(() => matchMedia('(pointer: coarse)').matches)).toBe(true);
      const bounds = await archive.boundingBox();
      expect(bounds.width).toBeGreaterThanOrEqual(44);
      expect(bounds.height).toBeGreaterThanOrEqual(44);

      await page.touchscreen.tap(bounds.x + bounds.width - 2, bounds.y + bounds.height / 2);
      await expect.poll(() => writes).toEqual([{ itemIds: [article.id], action: 'archive' }]);
      await expect(archive).toHaveCount(0);
      await expect(page).toHaveURL(/\/feed\/scroll$/);
    });
  }
});

test.describe('Feed detail Back controls on a coarse pointer', () => {
  test.use({ hasTouch: true });

  for (const width of [390, 1440]) {
    test(`Feed exposes one full-size Back control while scrolling at ${width}px`, async ({ page, baseURL }) => {
      const origin = new URL(baseURL).origin;
      await page.context().route('**/*', route => (
        new URL(route.request().url()).origin === origin ? route.fallback() : route.abort()
      ));
      await page.route(url => url.pathname === detailPath(article.id), route => route.fulfill({
        json: { sections: [{ type: 'article', data: { html: `<p>${articleBody}</p>`.repeat(70) } }] },
      }));
      await page.setViewportSize({ width, height: 850 });
      await page.goto('/feed/scroll');
      const opener = page.getByRole('button', { name: `Open: ${article.title}` });
      await opener.press('Enter');
      await expect(page).toHaveURL(scrollPath(article.id));
      const activeBack = page.getByRole('button', { name: 'Back to feed', exact: true });
      const top = page.locator('.detail-close');
      const sticky = page.locator('.detail-sticky-back');
      const header = page.locator('.detail-sticky-header');

      await expect(top).toBeFocused();
      await expect(header).toHaveCSS('opacity', '0');
      await expect(activeBack).toHaveCount(1);
      await expect(activeBack).toBeInViewport({ ratio: 1 });
      await page.keyboard.press('Tab');
      await expect(sticky).not.toBeFocused();
      expect(await page.evaluate(() => matchMedia('(pointer: coarse)').matches)).toBe(true);
      const topBounds = await top.boundingBox();
      expect(topBounds.width).toBeGreaterThanOrEqual(44);
      expect(topBounds.height).toBeGreaterThanOrEqual(44);

      await top.focus();
      await scrollArticle(header, 70);
      await expect(header).toHaveCSS('opacity', '1');
      await expect(sticky).toBeFocused();
      await expect(activeBack).toHaveCount(1);
      await expect(activeBack).toBeInViewport({ ratio: 1 });
      const stickyBounds = await sticky.boundingBox();
      const headerBounds = await header.boundingBox();
      expect(stickyBounds.width).toBeGreaterThanOrEqual(44);
      expect(stickyBounds.height).toBeGreaterThanOrEqual(44);
      expect(stickyBounds.y).toBeGreaterThanOrEqual(headerBounds.y);
      expect(stickyBounds.y + stickyBounds.height).toBeLessThanOrEqual(headerBounds.y + headerBounds.height);

      await scrollArticle(header, 0);
      await expect(header).toHaveCSS('opacity', '0');
      await expect(top).toBeFocused();
      await scrollArticle(header, 650);
      await expect(sticky).toBeFocused();
      await page.keyboard.press('Enter');
      await expect(page).toHaveURL(/\/feed\/scroll$/);
      await expect(opener).toBeFocused();
    });
  }
});


test('Feed restores Back focus when the next button disappears from a scrolled dialog', async ({ page }) => {
  const last = { ...article, id: 'reddit:final-detail', title: 'Final Feed item' };
  await page.setViewportSize({ width: 1440, height: 850 });
  await page.route('**/scroll/sessions', route => route.fulfill({
    json: { items: [article, last], sessionId: 'two-articles', hasMore: false },
  }));
  await page.route('**/feed/detail/*', route => route.fulfill({
    json: { sections: [{ type: 'article', data: { html: `<p>${articleBody}</p>`.repeat(70) } }] },
  }));
  await page.goto('/feed/scroll');
  const opener = page.getByRole('button', { name: `Open: ${article.title}` });
  await opener.press('Enter');

  const header = page.locator('.detail-sticky-header');
  await expect(page.locator('.detail-close')).toBeFocused();
  await scrollArticle(header, 650);
  await expect(header).toHaveCSS('opacity', '1');
  await page.getByRole('button', { name: 'Next item', exact: true }).press('Enter');
  await expect(page).toHaveURL(scrollPath(last.id));
  await expect(header).toHaveCSS('opacity', '0');
  await expect(page.getByRole('button', { name: 'Back to feed', exact: true })).toBeFocused();

  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/feed\/scroll$/);
  await expect(opener).toBeFocused();
});

test('Feed detail retains a queued deletion when reopened offline', async ({ page }) => {
  let deletion;
  let offline = false;
  await page.route(url => url.pathname === detailPath(article.id), route => route.fulfill({ json: { sections } }));
  await page.route('**/api/v1/feed/annotations?**', route => offline ? route.abort('failed') : route.fulfill({ json: {
    annotations: [{ id: 'old-note', itemId: article.id, note: 'Remove this note', updatedAt: '2026-07-01T12:00:00Z' }],
  } }));
  await page.route('**/api/v1/feed/annotations/old-note', route => { deletion = route; });
  await page.goto('/feed');
  const open = page.getByRole('button', { name: `Open: ${article.title}` });
  await open.click();
  await expect(page.getByText('Remove this note')).toBeVisible();
  await page.getByRole('button', { name: 'Delete' }).click();
  await expect.poll(() => deletion?.request().method()).toBe('DELETE');
  await page.keyboard.press('Escape');
  await expect(open).toBeVisible();
  offline = true;
  await page.evaluate(() => Object.defineProperty(navigator, 'onLine', { configurable: true, value: false }));
  await deletion.abort('failed');
  await open.click();
  await expect(page.getByRole('textbox', { name: 'Add a note' })).toBeVisible();
  await expect(page.getByText('1 note change waiting to sync.')).toBeVisible();
  await expect(page.getByText('Remove this note')).toHaveCount(0);
});

for (const initialWidth of [1440, 390]) {
  test(`Feed returns to the opening virtual card after detail changes layout from ${initialWidth}px`, async ({ page }) => {
    await page.setViewportSize({ width: initialWidth, height: 850 });
    const rows = Array.from({ length: 180 }, (_, index) => ({
      ...article, id: 'reddit:layout-' + index, title: 'Layout article ' + index, state: { isRead: true },
    }));
    await page.route('**/scroll/sessions', route => route.fulfill({ json: { items: rows, sessionId: 'virtual', hasMore: false } }));
    const reads = [];
    await page.route('**/feed/detail/*', route => {
      reads.push(decodeURIComponent(new URL(route.request().url()).pathname.split('/').at(-1)));
      return route.fulfill({ json: { sections } });
    });
    await page.goto('/feed/scroll');
    const feed = page.getByRole('main', { name: 'Feed' });
    await expect.poll(() => feed.evaluate(el => el.scrollHeight)).toBeGreaterThan(5600);
    await feed.evaluate(el => { el.scrollTop = 4500; });
    const visibleOpener = () => feed.evaluate(el => {
      const box = el.getBoundingClientRect();
      const opener = [...el.querySelectorAll('.scroll-card-open')].find(node => {
        const rect = node.getBoundingClientRect();
        return rect.top > box.top + 80 && rect.bottom < box.bottom - 80 && rect.left >= box.left;
      });
      return opener?.closest('[data-feed-item-id]').dataset.feedItemId;
    });
    await expect.poll(visibleOpener).toMatch(/^reddit:layout-\d+$/);
    const id = await visibleOpener();
    const index = rows.findIndex(item => item.id === id);
    expect(index).toBeGreaterThan(5);
    const opener = feed.getByRole('button', { name: 'Open: ' + rows[index].title, exact: true });
    await opener.focus();
    const offset = await feed.evaluate(el => el.scrollTop);
    await page.keyboard.press('Enter');
    await expect(page.getByText(articleBody)).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(opener).toBeFocused();
    await expect.poll(() => feed.evaluate(el => el.scrollTop)).toBe(offset);

    await opener.press('Enter');
    const back = page.getByRole('button', { name: 'Back to feed', exact: true });
    await expect(back).toBeFocused();
    await expect(page.getByText(articleBody)).toBeVisible();
    await page.setViewportSize({ width: initialWidth === 1440 ? 390 : 1440, height: 850 });
    await expect(page.getByRole('dialog')).toHaveCount(initialWidth === 1440 ? 0 : 1);
    await expect(back).toBeFocused();
    await page.keyboard.press('ArrowRight');
    await expect(page).toHaveURL(scrollPath(rows[index + 1].id));
    await expect(page.getByText(articleBody)).toBeVisible();
    if (initialWidth === 1440) await back.press('Enter');
    else await page.keyboard.press('Escape');
    await expect(page).toHaveURL('/feed/scroll');
    await expect(opener).toBeFocused();
    await expect(opener).toBeInViewport();
    expect(reads).toEqual([id, id, rows[index + 1].id]);
  });
}

test('Feed returns focus to the list when the opening card is archived in detail', async ({ page }) => {
  await page.route('**/feed/detail/*', route => route.fulfill({ json: { sections } }));
  await page.route('**/feed/items/state', route => {
    const { action } = route.request().postDataJSON();
    return route.fulfill({ json: { items: [{ id: article.id, state: { isRead: true, isArchived: action === 'archive' } }] } });
  });
  await page.goto('/feed/scroll');
  const opener = page.getByRole('button', { name: 'Open: ' + article.title, exact: true });
  await opener.press('Enter');
  await expect(page.getByText(articleBody)).toBeVisible();
  await page.getByRole('button', { name: 'Archive', exact: true }).press('Enter');
  await expect(page).toHaveURL('/feed/scroll');
  await expect(opener).toHaveCount(0);
  await expect(page.getByRole('main', { name: 'Feed' })).toBeFocused();
});

test('Feed desktop gallery activation returns focus to the card Open control', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 850 });
  const image = '/fixture-gallery.jpg';
  const item = { ...article, image, meta: { galleryImages: [{ url: image }, { url: image }] } };
  await page.route('**/fixture-gallery.jpg', route => route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="225"/>' }));
  await page.route('**/scroll/sessions', route => route.fulfill({ json: { items: [item], sessionId: 'gallery', hasMore: false } }));
  await page.route('**/feed/detail/*', route => route.fulfill({ json: { sections } }));
  await page.goto('/feed/scroll');
  const gallery = page.getByRole('region', { name: 'Image gallery, 1 of 2' });
  await gallery.focus();
  await gallery.click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Back to feed' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: 'Open: ' + article.title })).toBeFocused();
});

function settleListReturn(list) {
  return list.evaluate(() => new Promise(resolve => {
    let frames = 0;
    const next = () => { if (++frames === 8) resolve(); else requestAnimationFrame(next); };
    requestAnimationFrame(next);
  }));
}

for (const input of ['wheel', 'touchstart', 'keydown', 'focus']) {
  test(`Feed retires a pending list return when the user sends ${input}`, async ({ page }) => {
    const rows = Array.from({ length: 40 }, (_, i) => ({ ...article, id: 'reddit:input-' + i, title: 'Input ' + i }));
    await page.route('**/scroll/sessions', route => route.fulfill({ json: { items: rows, sessionId: 'input', hasMore: false } }));
    await page.route('**/feed/detail/*', route => route.fulfill({ json: { sections } }));
    await page.goto('/feed/scroll');
    const opener = page.getByRole('button', { name: 'Open: Input 20', exact: true });
    await opener.press('Enter');
    const feed = page.getByRole('main', { name: 'Feed' });
    await expect(page.getByText(articleBody)).toBeVisible();
    // Deliver input just after the list reappears, before its queued animation frames.
    await feed.evaluate((el, type) => {
      const observer = new MutationObserver(() => {
        if (el.querySelector('.detail-view')) return;
        observer.disconnect();
        if (type === 'focus') el.querySelector('.scroll-controls > button').focus({ preventScroll: true });
        else el.dispatchEvent(new Event(type, { bubbles: true }));
        el.scrollTop = 300;
      });
      observer.observe(el, { childList: true, subtree: true });
    }, input);
    await page.keyboard.press('Escape');
    await expect(page).toHaveURL('/feed/scroll');
    await settleListReturn(feed);
    expect(await feed.evaluate(el => el.scrollTop)).toBe(300);
    await expect(opener).not.toBeFocused();
    if (input === 'focus') await expect(feed.getByRole('button', { name: 'For you' })).toBeFocused();

    await page.goForward();
    await expect(page.getByText(articleBody)).toBeVisible();
    await page.goBack();
    await expect(feed).toBeFocused();
  });
}

test('Feed retires its warm checkpoint when a card opens before the first restore frame', async ({ page }) => {
  const rows = Array.from({ length: 40 }, (_, i) => ({ ...article, id: 'reddit:warm-' + i, title: 'Warm ' + i }));
  await page.route('**/feed/workspace', route => route.fulfill({ json: {
    preferencesStored: true, checkpoints: { scroll: { scrollOffset: 1700 } },
  } }));
  await page.route('**/scroll/sessions', route => route.fulfill({ json: { items: rows, sessionId: 'warm', hasMore: false } }));
  await page.route('**/feed/detail/*', route => route.fulfill({ json: { sections } }));
  await page.addInitScript(() => {
    const observer = new MutationObserver(() => {
      const opener = document.querySelector('.scroll-card-open');
      if (!opener) return;
      observer.disconnect();
      opener.click();
    });
    observer.observe(document, { subtree: true, childList: true });
  });
  await page.goto('/feed/scroll');
  await expect(page.getByText(articleBody)).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page).toHaveURL('/feed/scroll');
  const list = page.getByRole('main', { name: 'Feed' });
  await expect(list.getByRole('button', { name: 'Open: Warm 0', exact: true })).toBeFocused();
  await settleListReturn(list);
  expect(await list.evaluate(el => el.scrollTop)).toBe(0);
});
