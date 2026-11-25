import { expect, test } from '@playwright/test';

test.use({ serviceWorkers: 'block' });

const api = '/api/v1/content-filter';
const film = '/admin/content/filter/77';
const review = ['GET', api + '/77/review'];
const row = {
  id: 'fixture-scene', kind: 'scenes', peekId: 'fixture', label: 'Fixture scene', in: 10, out: 12,
  reviewed: true, effect: 'skip-card', card: { text: 'Original card', approved: false }, unsure: [],
};

async function installReview(page, { approved = false, withRow = false, write, read } = {}) {
  const calls = [];
  let reviewReads = 0;
  let currentRow = row;
  await page.routeWebSocket('**/*', () => {});
  await page.route('**/api/**', async route => {
    const request = route.request();
    const { pathname } = new URL(request.url());
    const method = request.method();
    if (pathname === api + '/77/signoff') {
      calls.push([method, pathname, request.postDataJSON()]);
      const failure = await write?.();
      if (failure) return route.fulfill(failure);
      approved = method === 'POST';
      return route.fulfill({ json: { ok: true } });
    }
    if (pathname === api + '/77/scenes/fixture') {
      const body = request.postDataJSON();
      calls.push([method, pathname, body]);
      currentRow = { ...currentRow, card: { text: body.card.text, approved: body.card.approve } };
      return route.fulfill({ json: { ok: true } });
    }
    if (pathname === api + '/77/review' || pathname === api + '/88/review') {
      calls.push([method, pathname]);
      const firstFilm = pathname === api + '/77/review';
      const parent = firstFilm && approved;
      const rows = firstFilm && withRow ? [currentRow] : [];
      const failure = firstFilm && await read?.(++reviewReads);
      if (failure) return route.fulfill(failure).catch(() => {});
      const level = parent ? 'parent' : 'machine';
      return route.fulfill({ json: {
        title: firstFilm ? 'Signoff fixture' : 'Second film fixture', certification: { level },
        audit: null, rows, reviewed: rows.length, total: rows.length, job: null,
        status: {
          filters: { present: true, parts: withRow ? 1 : 0 }, refined: { present: true, measured: 1, of: 1 },
          certified: level, next: parent ? 'none' : 'approve',
        },
        signOff: { ready: true, missing: [], parent: parent ? { by: 'Fixture reviewer' } : null },
      } }).catch(() => {});
    }
    return route.fulfill({ json: pathname.endsWith('/supervision/bootstrap') ? { enabled: false } : {} });
  });
  return calls;
}

const approveButton = page => page.getByRole('button', { name: 'Approve for family', exact: true });
const withdrawButton = page => page.getByRole('button', { name: 'Withdraw approval', exact: true });
// Approve lives on the rail's Approve tab, in place of the part card.
const openApproveTab = page => page.getByRole('tab', { name: /^Approve/ }).click();
const openReviewTab = page => page.getByRole('tab', { name: /^Review/ }).click();
// The card text field sits behind the part's effect menu.
async function openCardDraft(page) {
  await page.getByRole('button', { name: /^Effect: .*Change it/ }).click();
  await page.getByRole('menuitem', { name: /^Card shown in place of the skip/ }).click();
  return page.getByRole('textbox', { name: /^Card( \(approved\)| shown in place of the skip)?$/ });
}
const approvalRegion = page => page.getByRole('region', { name: 'Family approval', exact: true });
const signoff = method => [method, api + '/77/signoff', {}];
const refused = message => ({ status: 409, json: { message } });

async function openFilm(page, path) {
  await page.evaluate(destination => {
    history.pushState({}, '', destination);
    window.dispatchEvent(new PopStateEvent('popstate'));
  }, path);
}

for (const width of [390, 1440]) {
  for (const approved of [false, true]) {
    test(`Admin keeps ${approved ? 'Withdraw' : 'Approve'} focused and locked through confirmation at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 850 });
      const write = Promise.withResolvers();
      const read = Promise.withResolvers();
      const calls = await installReview(page, { approved, write: () => write.promise, read: n => n === 2 ? read.promise : undefined });
      const action = approved ? withdrawButton(page) : approveButton(page);
      const region = approvalRegion(page);
      const command = signoff(approved ? 'DELETE' : 'POST');
      try {
        await page.goto(film);
        await openApproveTab(page);
        await action.scrollIntoViewIfNeeded();
        await action.press('Enter');
        await expect.poll(() => calls).toEqual([review, command]);
        await expect(action).toBeDisabled();
        await expect(region).toBeFocused();
        await expect(region).toHaveAttribute('aria-busy', 'true');
        await expect(region).toBeInViewport();
        write.resolve();
        await expect.poll(() => calls).toEqual([review, command, review]);
        await expect(action).toBeDisabled();
        await page.keyboard.press('Enter');
        expect(calls).toEqual([review, command, review]);
        if (approved) await expect(region.getByText('Approval withdrawn.', { exact: true })).toHaveCount(0);
        read.resolve();
        await expect(action).toHaveCount(0);
        await expect(approved ? approveButton(page) : withdrawButton(page)).toBeEnabled();
        await expect(region).toBeFocused();
        await expect(region).not.toHaveAttribute('aria-busy', 'true');
        if (approved) await expect(region.getByText('Approval withdrawn.', { exact: true })).toBeVisible();
        expect(calls).toEqual([review, command, review]);
      } finally {
        write.resolve();
        read.resolve();
      }
    });
  }
}

test('Admin keeps an editor draft when a confirmed approval needs a GET-only retry', async ({ page }) => {
  const retryRead = Promise.withResolvers();
  const calls = await installReview(page, { withRow: true, read: n => {
    if (n === 2) return refused('Review temporarily unavailable');
    if (n === 3) return retryRead.promise;
  } });
  try {
    await page.goto(film + '/' + row.id);
    await openApproveTab(page);
    await approveButton(page).press('Enter');
    const region = approvalRegion(page);
    const retry = region.getByRole('button', { name: 'Retry', exact: true });
    await expect(retry).toBeEnabled();
    await expect(approveButton(page)).toBeDisabled();
    await expect(region).toBeFocused();
    await retry.press('Enter');
    await expect.poll(() => calls).toEqual([review, signoff('POST'), review, review]);
    await expect(region).toBeFocused();
    await expect(region).toHaveAttribute('aria-busy', 'true');
    await openReviewTab(page);
    const draft = await openCardDraft(page);
    await draft.fill('Unsent card draft');
    await draft.focus();
    retryRead.resolve();
    await expect(draft).toBeFocused();
    await expect(draft).toHaveValue('Unsent card draft');
    await openApproveTab(page);
    await expect(withdrawButton(page)).toBeEnabled();
    expect(calls).toEqual([review, signoff('POST'), review, review]);
  } finally {
    retryRead.resolve();
  }
});

test('Admin unlocks a refused approval without reading confirmation', async ({ page }) => {
  const calls = await installReview(page, { write: () => refused('Approval refused') });
  await page.goto(film);
  await openApproveTab(page);
  await approveButton(page).press('Enter');
  const region = approvalRegion(page);
  await expect(region.getByRole('status')).toContainText('Approval refused');
  await expect(approveButton(page)).toBeEnabled();
  await expect(region).toBeFocused();
  expect(calls).toEqual([review, signoff('POST')]);
});

test('Admin accepts a newer same-film review when a row save supersedes the held confirmation', async ({ page }) => {
  const firstRead = Promise.withResolvers();
  const replacementRead = Promise.withResolvers();
  const calls = await installReview(page, { withRow: true, read: n => n === 2 ? firstRead.promise : n === 3 ? replacementRead.promise : undefined });
  const edit = ['PUT', api + '/77/scenes/fixture', { card: { approve: true, text: 'Replacement card' } }];
  try {
    await page.goto(film + '/' + row.id);
    await openApproveTab(page);
    await approveButton(page).press('Enter');
    await expect.poll(() => calls).toEqual([review, signoff('POST'), review]);
    await openReviewTab(page);
    const draft = await openCardDraft(page);
    await draft.fill('Replacement card');
    await page.getByRole('button', { name: 'Approve card', exact: true }).press('Enter');
    await expect.poll(() => calls).toEqual([review, signoff('POST'), review, edit, review]);
    await draft.focus();
    replacementRead.resolve();
    await expect(draft).toBeFocused();
    await expect(draft).toHaveValue('Replacement card');
    await openApproveTab(page);
    await expect(withdrawButton(page)).toBeEnabled();
    expect(calls).toEqual([review, signoff('POST'), review, edit, review]);
  } finally {
    firstRead.resolve();
    replacementRead.resolve();
  }
});

test('Admin leaves a replacement film alone when a departed approval is acknowledged', async ({ page }) => {
  const write = Promise.withResolvers();
  const calls = await installReview(page, { write: () => write.promise });
  try {
    await page.goto(film);
    await openApproveTab(page);
    await approveButton(page).press('Enter');
    await expect.poll(() => calls).toEqual([review, signoff('POST')]);
    await openFilm(page, '/admin/content/filter/88');
    await expect(page.getByText('Second film fixture', { exact: true })).toBeVisible();
    await openApproveTab(page);
    await approveButton(page).focus();
    const response = page.waitForResponse(result => result.url().endsWith('/77/signoff'));
    write.resolve();
    await (await response).finished();
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await expect(approveButton(page)).toBeFocused();
    expect(calls).toEqual([review, signoff('POST'), ['GET', api + '/88/review']]);
  } finally {
    write.resolve();
  }
});

test('Admin keeps approval locked when the same film reopens before acknowledgement', async ({ page }) => {
  const write = Promise.withResolvers();
  const confirmation = Promise.withResolvers();
  const calls = await installReview(page, { write: () => write.promise, read: n => n === 3 ? confirmation.promise : undefined });
  const secondReview = ['GET', api + '/88/review'];
  try {
    await page.goto(film);
    await openApproveTab(page);
    await approveButton(page).press('Enter');
    await expect.poll(() => calls).toEqual([review, signoff('POST')]);
    await openFilm(page, '/admin/content/filter/88');
    await expect(page.getByText('Second film fixture', { exact: true })).toBeVisible();
    await openApproveTab(page);
    await expect(approveButton(page)).toBeEnabled();
    await openFilm(page, film);
    await expect(page.getByText('Signoff fixture', { exact: true })).toBeVisible();
    await openApproveTab(page);
    await expect.poll(() => calls).toEqual([review, signoff('POST'), secondReview, review]);
    await expect(approveButton(page)).toBeDisabled();
    const allFilms = page.getByRole('link', { name: /Films$/ });
    await allFilms.focus();
    write.resolve();
    await expect.poll(() => calls).toEqual([review, signoff('POST'), secondReview, review, review]);
    await expect(approveButton(page)).toBeDisabled();
    confirmation.resolve();
    await expect(withdrawButton(page)).toBeEnabled();
    await expect(allFilms).toBeFocused();
    expect(calls).toEqual([review, signoff('POST'), secondReview, review, review]);
  } finally {
    write.resolve();
    confirmation.resolve();
  }
});

test('Admin retires an old session approval when a peer replaces the browser credential', async ({ page, baseURL }) => {
  const write = Promise.withResolvers();
  const freshRead = Promise.withResolvers();
  const calls = await installReview(page, { write: () => write.promise, read: n => n === 2 ? freshRead.promise : undefined });
  const peer = await page.context().newPage();
  try {
    await page.goto(film);
    await openApproveTab(page);
    await approveButton(page).press('Enter');
    await expect.poll(() => calls).toEqual([review, signoff('POST')]);
    await peer.route('**/*', route => route.fulfill({ contentType: 'text/html', body: '<html></html>' }));
    await peer.goto(baseURL + '/fixture-credential-writer');
    await peer.evaluate(() => localStorage.setItem('ds_token', 'fixture-replacement-token'));
    await expect.poll(() => calls).toEqual([review, signoff('POST'), review]);
    await expect(approveButton(page)).toHaveCount(0);
    const response = page.waitForResponse(result => result.url().endsWith('/77/signoff'));
    write.resolve();
    await (await response).finished();
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await expect(approveButton(page)).toHaveCount(0);
    freshRead.resolve();
    await expect(approveButton(page)).toBeEnabled();
    expect(calls).toEqual([review, signoff('POST'), review]);
  } finally {
    write.resolve();
    freshRead.resolve();
    await peer.close();
  }
});
