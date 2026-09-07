import { expect, test } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const OUT_DIR = path.join(process.cwd(), 'docs/_wip/audits/user_4-reading-shelf');
fs.mkdirSync(OUT_DIR, { recursive: true });

const VIEWPORT = { width: 1280, height: 800 };
const CODE = '482913';
const GRANT = 'signed-disposable-book-grant';
const ISBN = '9780064400558';
const STUDY_DAY = '2026-09-03';
const SCREEN_CONFIG = {
  screen: 'portal',
  route: '/screen/portal',
  layout: { children: [{ widget: 'school', grow: 1, props: { mode: 'locked', screenId: 'portal' } }] },
};

const hostileBook = {
  isbn13: ISBN,
  title: '<b>The Wild Robot</b> [electronic resource]',
  subtitle: 'Escapes&nbsp;again',
  authors: ['Brown, Peter', 'Peter Brown', 'Jane Illustrator', 'A. Translator', 'Another Person'],
  description: '<p>A robot &amp; her friends survive a storm.</p>',
  pageCount: 288,
  coverUrl: 'https://catalog.example.test/landscape.svg',
};

const shelfItem = ({ isbn, title, subtitle = null, authors, coverUrl, progressMode = 'page', projection, pageCount = 240, events = [] }) => ({
  itemId: `user_4:${isbn}:e0`,
  bookId: isbn,
  isbn13: isbn,
  title,
  subtitle,
  authors,
  coverUrl,
  pageCount,
  progressMode,
  openedAt: '2026-08-20',
  events,
  projection: {
    status: 'reading', page: null, percent: 0, minutes: 0, daysRead: 0,
    lastAt: '2026-09-02T17:00:00.000Z', ...projection,
  },
});

const initialItems = [
  shelfItem({
    isbn: '9780547928227',
    title: 'The Hobbit, or There and Back Again [paperback]',
    authors: ['Tolkien, J. R. R.', 'J. R. R. Tolkien', 'John Illustrator', 'Anne Editor', 'Sam Translator'],
    coverUrl: 'https://catalog.example.test/portrait.svg',
    projection: { page: 84, percent: 28, daysRead: 4 },
    pageCount: 300,
  }),
  shelfItem({
    isbn: '9780380807345',
    title: 'A Landscape Book With A Surprisingly Long Real Title That Still Has To Fit',
    subtitle: 'The uncropped edition',
    authors: ['Ursula K. Le Guin'],
    coverUrl: 'https://catalog.example.test/landscape.svg',
    progressMode: 'minutes',
    projection: { minutes: 205, daysRead: 9 },
  }),
  shelfItem({
    isbn: '9780140328721',
    title: 'Matilda [library binding]',
    authors: ['Dahl, Roald'],
    coverUrl: 'https://catalog.example.test/broken.jpg',
    progressMode: 'check',
    projection: { daysRead: 12 },
  }),
  shelfItem({
    isbn: '9780027746723',
    title: null,
    authors: [],
    coverUrl: null,
    projection: { page: 1, percent: 0 },
    pageCount: null,
  }),
];

const readingCard = {
  ok: true,
  learner: 'user_4',
  subject: 'english',
  title: 'Reading',
  sentence: null,
  schema: 'school.self-service-card/v2',
  context: {
    learner: { id: 'user_4', displayName: 'User_4', avatar: { kind: 'learner', id: 'user_4' } },
    taxonomy: { subject: { id: 'english', label: 'English' } },
    trail: [{ kind: 'subject', id: 'english', label: 'English' }],
    progress: [],
  },
  presentation: { status: 'ready', message: null },
  actions: [
    { kind: 'program', label: 'Open Reading', target: 'book-log', role: 'primary' },
    { kind: 'exit', label: 'Go back', role: 'secondary' },
  ],
};

const svg = ({ width, height, label, color }) => `
  <svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
    <rect width="100%" height="100%" rx="24" fill="${color}"/>
    <text x="50%" y="50%" text-anchor="middle" dominant-baseline="middle" fill="#fff" font-size="42">${label}</text>
  </svg>`;

function shelf(items) {
  return {
    learnerId: 'user_4',
    studyDay: STUDY_DAY,
    items,
    obligation: {
      metric: 'checkins', quantity: 1, per: 'day', actual: 0, target: 1,
      label: '0 of 1 check-ins', incompatibleBooks: [],
    },
  };
}

async function installReadingWorld(page, { initialShelfItems = initialItems, scan = null } = {}) {
  let items = structuredClone(initialShelfItems);
  let hasActivity = false;
  const writes = [];

  await page.route('https://catalog.example.test/**', async (route) => {
    const pathname = new URL(route.request().url()).pathname;
    if (pathname.endsWith('/broken.jpg')) {
      await route.fulfill({ status: 404, contentType: 'text/plain', body: 'missing' });
      return;
    }
    const landscape = pathname.endsWith('/landscape.svg');
    await route.fulfill({
      status: 200,
      contentType: 'image/svg+xml',
      body: landscape
        ? svg({ width: 1200, height: 600, label: 'LANDSCAPE', color: '#3c6e71' })
        : svg({ width: 600, height: 1000, label: 'PORTRAIT', color: '#7b4f8c' }),
    });
  });

  await page.route('**/api/v1/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const pathname = url.pathname;
    const method = request.method();
    const json = (value, status = 200) => route.fulfill({
      status, contentType: 'application/json', body: JSON.stringify(value),
    });

    if (pathname === '/api/v1/screens/portal') {
      await json(SCREEN_CONFIG);
      return;
    }
    if (pathname === '/api/v1/school/book-scans/pending' && method === 'GET') {
      expect(url.searchParams.get('screenId')).toBe('portal');
      await json({ intent: scan?.exposed ? scan.intent : null });
      return;
    }
    if (scan && pathname === `/api/v1/school/book-scans/${scan.intent.id}/claim` && method === 'POST') {
      const body = request.postDataJSON();
      writes.push({ pathname, method, body });
      await json({
        intentId: scan.intent.id,
        launchTarget: { kind: 'program', program: 'book-log', learnerId: body.learnerId, bookGrant: GRANT },
        bookEntry: { isbn13: scan.intent.isbn13, book: scan.intent.book },
      });
      return;
    }
    if (pathname === '/api/v1/school/roster') {
      await json([{ id: 'user_4', name: 'User_4', birthyear: 2017 }]);
      return;
    }
    if (pathname === '/api/v1/school/self-service/resolve' && method === 'POST') {
      writes.push({ pathname, method, body: request.postDataJSON() });
      await json(readingCard);
      return;
    }
    if (pathname === '/api/v1/school/self-service/act' && method === 'POST') {
      writes.push({ pathname, method, body: request.postDataJSON() });
      await json({
        outcome: 'mount',
        transition: 'mount',
        sentence: 'Opening it here on the screen.',
        effect: {
          kind: 'program', program: 'book-log', programId: 'book-log', unitId: null,
          learnerId: 'user_4', bookGrant: GRANT,
        },
      });
      return;
    }
    if (pathname === '/api/v1/books/resolve') {
      expect(url.searchParams.get('id')).toBe(ISBN);
      await json({ status: 'ok', book: hostileBook });
      return;
    }
    if (pathname === '/api/v1/school/books/user_4/shelf' && method === 'GET') {
      expect(request.headers()['x-school-book-grant']).toBe(GRANT);
      await json(shelf(items));
      return;
    }
    if (pathname === '/api/v1/school/books/user_4/shelf' && method === 'POST') {
      expect(request.headers()['x-school-book-grant']).toBe(GRANT);
      const body = request.postDataJSON();
      writes.push({ pathname, method, body });
      const finished = shelfItem({
        isbn: ISBN,
        title: hostileBook.title,
        subtitle: hostileBook.subtitle,
        authors: hostileBook.authors,
        coverUrl: hostileBook.coverUrl,
        pageCount: hostileBook.pageCount,
        projection: {
          status: 'finished', page: null, percent: 100, daysRead: 1,
          lastAt: `${body.finishedOn}T18:00:00.000Z`,
        },
      });
      items = [...items, finished];
      hasActivity = true;
      await json({ item: finished });
      return;
    }
    if (pathname.startsWith('/api/v1/school/books/user_4/shelf/') && pathname.endsWith('/progress') && method === 'POST') {
      expect(request.headers()['x-school-book-grant']).toBe(GRANT);
      const body = request.postDataJSON();
      writes.push({ pathname, method, body });
      const encodedItemId = pathname.slice('/api/v1/school/books/user_4/shelf/'.length, -'/progress'.length);
      const itemId = decodeURIComponent(encodedItemId);
      const current = items.find((item) => item.itemId === itemId);
      expect(current).toBeTruthy();
      const updated = body.kind === 'reopened'
        ? { ...current, projection: { ...current.projection, status: 'reading', percent: 0 } }
        : current;
      items = items.map((item) => item.itemId === itemId ? updated : item);
      await json({ item: updated });
      return;
    }
    if (pathname === '/api/v1/school/materials') {
      await json({ materials: [] });
      return;
    }
    if (pathname === '/api/v1/school/sentence-ladder/courses' || pathname === '/api/v1/school/banks') {
      await json([]);
      return;
    }
    if (pathname === '/api/v1/school/surfaces/profile') {
      await json({ surfaceId: 'portal' });
      return;
    }
    if (pathname === '/api/v1/school/teacher/day') {
      await json({
        schema: 'school.teacher-day/v2',
        studyDay: STUDY_DAY,
        learners: [{
          learnerId: 'user_4', sessions: [],
          readingActivity: {
            status: 'ok', studyDay: STUDY_DAY, hasActivity,
            bookCount: hasActivity ? 1 : 0, progressCount: 0, finishedCount: hasActivity ? 1 : 0,
          },
        }],
      });
      return;
    }
    if (pathname.endsWith('/agenda/preview')) {
      await json({ learnerId: 'user_4', studyDay: STUDY_DAY, sections: [], entries: [], errors: [] });
      return;
    }
    if (pathname === '/api/v1/state-gates') {
      await json({ gates: [] });
      return;
    }
    if (/\/api\/v1\/(?:users|user-pics)\//.test(pathname)) {
      await route.fulfill({ status: 404, contentType: 'text/plain', body: 'no portrait fixture' });
      return;
    }
    await json({});
  });

  return { writes };
}

async function screenshot(page, name) {
  await page.screenshot({ path: path.join(OUT_DIR, `${name}.png`), fullPage: true });
}

async function expectViewportSafe(page) {
  const dimensions = await page.evaluate(() => ({
    innerWidth: window.innerWidth,
    innerHeight: window.innerHeight,
    scrollWidth: document.documentElement.scrollWidth,
    scrollHeight: document.documentElement.scrollHeight,
  }));
  expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.innerWidth);
  expect(dimensions.scrollHeight).toBeLessThanOrEqual(dimensions.innerHeight);
}

async function expectHitTargetInViewport(locator) {
  await expect(locator).toBeVisible();
  const box = await locator.boundingBox();
  expect(box).not.toBeNull();
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(VIEWPORT.width);
  expect(box.y + box.height).toBeLessThanOrEqual(VIEWPORT.height);
  expect(box.height).toBeGreaterThanOrEqual(44);
  await locator.click({ trial: true });
}

test('User_4 enters his code directly into a usable shelf, finishes a hostile book, and undoes it', async ({ page }) => {
  await page.setViewportSize(VIEWPORT);
  const world = await installReadingWorld(page);
  await page.goto('/school');

  const keypad = page.getByTestId('selfservice-keypad');
  await expect(keypad).toBeVisible({ timeout: 20_000 });
  await screenshot(page, '01-panel-code');
  await expectViewportSafe(page);

  await page.keyboard.type(CODE);
  const shelfRoot = page.getByTestId('book-shelf');
  await expect(shelfRoot).toBeVisible();
  await expect(page.getByTestId('selfservice-card')).toHaveCount(0);
  await expect(shelfRoot).toContainText('User_4');
  await expect(shelfRoot).toContainText('The Hobbit, or There and Back Again');
  await expect(shelfRoot).not.toContainText('[paperback]');
  await expect(shelfRoot).toContainText('J. R. R. Tolkien, John Illustrator & 2 more');
  await expect(shelfRoot).toContainText('Book 9780027746723');
  await expect(shelfRoot.getByRole('img', { name: 'No cover available for Matilda' })).toBeVisible();
  await expect(shelfRoot.getByRole('img', { name: 'No cover available for Book 9780027746723' })).toBeVisible();

  const landscape = shelfRoot.getByRole('img', { name: /Cover of A Landscape Book/ });
  await expect(landscape).toBeVisible();
  const coverGeometry = await landscape.evaluate((element) => ({
    naturalWidth: element.naturalWidth,
    naturalHeight: element.naturalHeight,
    width: element.getBoundingClientRect().width,
    height: element.getBoundingClientRect().height,
    objectFit: getComputedStyle(element).objectFit,
  }));
  expect(coverGeometry.naturalWidth).toBeGreaterThan(coverGeometry.naturalHeight);
  expect(coverGeometry.objectFit).toBe('contain');
  expect(coverGeometry.width / coverGeometry.height).toBeCloseTo(2 / 3, 1);
  const hobbitTile = shelfRoot.getByRole('button', { name: 'Open The Hobbit, or There and Back Again', exact: true });
  const boundedAuthors = await hobbitTile.locator('.school-books-tile__author').evaluate((element) => ({
    lineClamp: getComputedStyle(element).webkitLineClamp,
    overflow: getComputedStyle(element).overflow,
    clientHeight: element.clientHeight,
    scrollHeight: element.scrollHeight,
  }));
  expect(Number(boundedAuthors.lineClamp)).toBeGreaterThanOrEqual(1);
  expect(boundedAuthors.overflow).toBe('hidden');
  expect(boundedAuthors.scrollHeight).toBeGreaterThan(boundedAuthors.clientHeight);
  const shelfScroll = await page.getByTestId('book-shelf-grid').evaluate((element) => ({
    clientWidth: element.clientWidth,
    scrollWidth: element.scrollWidth,
    clientHeight: element.clientHeight,
    scrollHeight: element.scrollHeight,
  }));
  expect(shelfScroll.scrollWidth).toBeGreaterThan(shelfScroll.clientWidth);
  expect(shelfScroll.scrollHeight).toBeLessThanOrEqual(shelfScroll.clientHeight + 1);
  await expectHitTargetInViewport(page.getByRole('button', { name: 'Done', exact: true }));
  await expectHitTargetInViewport(page.getByRole('button', { name: 'See all history', exact: true }));
  await screenshot(page, '02-hostile-data-shelf');
  await expectViewportSafe(page);

  const addBook = page.getByRole('button', { name: /Add a book/ });
  await expectHitTargetInViewport(addBook);
  await addBook.click();
  await expect(page.getByText('Type the number under the barcode')).toBeVisible();
  await page.keyboard.type(ISBN);
  await expect(page.getByTestId('numberpad-entry')).toHaveText(ISBN);
  const lookup = page.getByRole('button', { name: 'Look it up', exact: true });
  await expect(lookup).toBeEnabled();
  await lookup.click();

  await expect(page.getByRole('heading', { name: 'The Wild Robot: Escapes again' })).toBeVisible();
  await expect(page.getByText('Peter Brown, Jane Illustrator & 2 more')).toBeVisible();
  await expect(page.getByText('A robot & her friends survive a storm.')).toBeVisible();
  await expect(page.getByTestId('add-book')).not.toContainText('electronic resource');
  const primaryChoices = [
    page.getByRole('button', { name: 'Start reading', exact: true }),
    page.getByRole('button', { name: 'Update page', exact: true }),
    page.getByRole('button', { name: 'Finished today', exact: true }),
    page.getByRole('button', { name: 'Finished on another day', exact: true }),
  ];
  for (const choice of primaryChoices) await expectHitTargetInViewport(choice);
  await screenshot(page, '03-isbn-actions');
  await expectViewportSafe(page);

  await page.getByRole('button', { name: 'Finished today', exact: true }).click();

  const receipt = page.getByTestId('book-save-receipt');
  await expect(receipt).toBeVisible();
  await expect(receipt).toContainText('Book finished!');
  await expect(receipt).toContainText('The Wild Robot: Escapes again');
  await expect(page.getByTestId('recently-finished-row')).toContainText('The Wild Robot: Escapes again');
  await expectHitTargetInViewport(page.getByRole('button', { name: 'Undo finish', exact: true }));
  await screenshot(page, '04-finished-shelf');
  await expectViewportSafe(page);

  const shelfWrite = world.writes.find((entry) => entry.pathname === '/api/v1/school/books/user_4/shelf');
  expect(shelfWrite?.body).toMatchObject({
    bookId: ISBN,
    where: 'finished',
    finishedOn: STUDY_DAY,
  });
  expect(shelfWrite.body.entryId).toMatch(/^[0-9a-f-]{36}$/i);
  expect(shelfWrite.body.progressEntryId).toMatch(/^[0-9a-f-]{36}$/i);

  await page.getByRole('button', { name: 'See all history', exact: true }).click();
  await expect(page.getByTestId('book-history')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'September 2026' })).toBeVisible();
  await expect(page.getByText('The Wild Robot: Escapes again')).toBeVisible();
  await expect(page.getByText('Finished Sep 3')).toBeVisible();
  const historyCover = page.getByRole('img', { name: 'Cover of The Wild Robot: Escapes again' });
  await expect.poll(() => historyCover.evaluate((element) => element.complete && element.naturalWidth > 0)).toBe(true);
  await screenshot(page, '05-history');
  await expectViewportSafe(page);

  await page.getByRole('button', { name: '‹ back', exact: true }).click();
  await page.getByRole('button', { name: 'Undo finish', exact: true }).click();
  await expect(receipt).toContainText('Finish undone');
  await expect(page.getByTestId('recently-finished-row')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Open The Wild Robot: Escapes again', exact: true })).toBeVisible();
  await screenshot(page, '06-undo-finish');
  await expectViewportSafe(page);

  expect(world.writes).toEqual(expect.arrayContaining([
    expect.objectContaining({
      pathname: '/api/v1/school/self-service/resolve',
      method: 'POST',
      body: { code: CODE },
    }),
    expect.objectContaining({
      pathname: '/api/v1/school/self-service/act',
      method: 'POST',
      body: { code: CODE, action: 'program' },
    }),
    expect.objectContaining({
      method: 'POST',
      body: expect.objectContaining({ kind: 'reopened', entryId: expect.stringMatching(/^[0-9a-f-]{36}$/i) }),
    }),
  ]));

  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(page.getByRole('img', { name: 'Reading: done' })).toBeVisible();
  await expect(page.getByText('Done for the day')).toHaveCount(0);
  await screenshot(page, '07-agenda-reading-credit');
  await expectViewportSafe(page);
});

test('a truly empty initial shelf opens ISBN entry without a misleading empty shelf', async ({ page }) => {
  await page.setViewportSize(VIEWPORT);
  const world = await installReadingWorld(page, { initialShelfItems: [] });
  await page.goto('/school');
  await expect(page.getByTestId('selfservice-keypad')).toBeVisible({ timeout: 20_000 });
  await page.keyboard.type(CODE);

  await expect(page.getByTestId('numberpad')).toBeVisible();
  await expect(page.getByText('Type the number under the barcode')).toBeVisible();
  await expect(page.getByText('Ready for your next book')).toHaveCount(0);
  expect(world.writes.filter((entry) => entry.pathname === '/api/v1/school/books/user_4/shelf')).toHaveLength(0);
  await screenshot(page, '08-initial-empty-number');
  await expectViewportSafe(page);
});

test('a finished-only shelf keeps reread context and opens the progress pad on demand', async ({ page }) => {
  const priorFinish = shelfItem({
    isbn: ISBN,
    title: hostileBook.title,
    subtitle: hostileBook.subtitle,
    authors: hostileBook.authors,
    coverUrl: hostileBook.coverUrl,
    pageCount: hostileBook.pageCount,
    projection: { status: 'finished', page: 288, percent: 100, daysRead: 6, lastAt: '2026-09-02T18:00:00.000Z' },
    events: [{ kind: 'finished', finishedOn: '2026-09-02', at: '2026-09-02T18:00:00.000Z' }],
  });
  await page.setViewportSize(VIEWPORT);
  await installReadingWorld(page, { initialShelfItems: [priorFinish] });
  await page.goto('/school');
  await expect(page.getByTestId('selfservice-keypad')).toBeVisible({ timeout: 20_000 });
  await page.keyboard.type(CODE);

  await expect(page.getByText('Ready for your next book')).toBeVisible();
  const finishedTile = page.getByRole('button', { name: 'Open The Wild Robot: Escapes again', exact: true });
  await expectHitTargetInViewport(finishedTile);
  await finishedTile.click();
  await expect(page.getByTestId('completed-book')).toContainText('Last finished Sep 2, 2026');
  await page.getByRole('button', { name: 'Read again', exact: true }).click();
  await expect(page.getByTestId('add-book')).toContainText('Last finished Sep 2, 2026');
  const updatePage = page.getByRole('button', { name: 'Update page', exact: true });
  await expectHitTargetInViewport(updatePage);
  await updatePage.click();
  await expect(page.getByText('What page are you on?')).toBeVisible();
  await page.getByRole('button', { name: '8', exact: true }).click();
  await expectHitTargetInViewport(page.getByRole('button', { name: 'Save page', exact: true }));
  await screenshot(page, '09-reread-progress-pad');
  await expectViewportSafe(page);

  await page.getByRole('button', { name: '‹ back', exact: true }).click();
  await page.getByRole('button', { name: 'Finished on another day', exact: true }).click();
  const day = page.getByRole('gridcell', { name: 'Thursday 3 September', exact: true });
  await expectHitTargetInViewport(day);
  await expectHitTargetInViewport(page.getByRole('button', { name: 'Save finish · Thursday 3 September', exact: true }));
  await screenshot(page, '10-alternate-date');
  await expectViewportSafe(page);
});

test('a Portal scan waits for a keypad draft, then claims a learner without an early reading write', async ({ page }) => {
  const scan = {
    exposed: false,
    intent: {
      id: 'scan-reading-1', screenId: 'portal', isbn13: ISBN,
      receivedAt: new Date(Date.now() - 1_000).toISOString(),
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      status: 'ready', book: hostileBook, error: null,
    },
  };
  await page.setViewportSize(VIEWPORT);
  const world = await installReadingWorld(page, { scan });
  await page.goto('/screen/portal');
  await expect(page.getByTestId('selfservice-keypad')).toBeVisible({ timeout: 20_000 });
  await page.waitForFunction(() => Boolean(window.__wsService), null, { timeout: 20_000 });

  await page.getByRole('button', { name: '4', exact: true }).click();
  scan.exposed = true;
  await page.evaluate(({ intentId }) => {
    window.__wsService._dispatch({ topic: 'school', type: 'school.book-scan', screenId: 'portal', intentId });
  }, { intentId: scan.intent.id });
  await expect(page.getByText('Book scanned — open when ready')).toBeVisible();
  await expect(page.getByRole('dialog', { name: 'This book was just scanned' })).toHaveCount(0);
  expect(world.writes.filter(entry => entry.pathname.includes('/school/books/'))).toHaveLength(0);
  expect(world.writes.filter(entry => entry.pathname.includes('/book-scans/'))).toHaveLength(0);

  await page.getByRole('button', { name: 'Backspace', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'This book was just scanned' });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText("Who's reading this?");
  await expectHitTargetInViewport(dialog.getByRole('button', { name: 'User_4', exact: true }));
  await screenshot(page, '11-scan-choose-learner');
  await dialog.getByRole('button', { name: 'User_4', exact: true }).click();

  await expect(page.getByTestId('add-book')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'The Wild Robot: Escapes again' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Start reading', exact: true })).toBeVisible();
  expect(world.writes.filter(entry => entry.pathname.includes('/school/books/') && entry.method === 'POST')).toHaveLength(0);
  expect(world.writes).toEqual(expect.arrayContaining([expect.objectContaining({
    pathname: '/api/v1/school/book-scans/scan-reading-1/claim',
    method: 'POST', body: { screenId: 'portal', learnerId: 'user_4' },
  })]));
  await screenshot(page, '12-scanned-book-actions');
  await expectViewportSafe(page);

  await page.getByRole('button', { name: 'Finished today', exact: true }).click();
  await expect(page.getByTestId('recently-finished-row')).toContainText('The Wild Robot: Escapes again');
  expect(world.writes.filter(entry => entry.pathname === '/api/v1/school/books/user_4/shelf' && entry.method === 'POST')).toHaveLength(1);
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(page.getByRole('img', { name: 'Reading: done' })).toBeVisible();
  await screenshot(page, '13-scan-finish-credit');
  await expectViewportSafe(page);
});
