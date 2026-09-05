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

const hostileBook = {
  isbn13: ISBN,
  title: '<b>The Wild Robot</b> [electronic resource]',
  subtitle: 'Escapes&nbsp;again',
  authors: ['Brown, Peter', 'Peter Brown', 'Jane Illustrator', 'A. Translator', 'Another Person'],
  description: '<p>A robot &amp; her friends survive a storm.</p>',
  pageCount: 288,
  coverUrl: 'https://catalog.example.test/landscape.svg',
};

const shelfItem = ({ isbn, title, subtitle = null, authors, coverUrl, progressMode = 'page', projection, pageCount = 240 }) => ({
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
  events: [],
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

async function installReadingWorld(page) {
  let items = [...initialItems];
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
      await json({ item: finished });
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
      await json({ learners: [] });
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

test('User_4 can enter his code, resolve a hostile real-world book, and finish it', async ({ page }) => {
  await page.setViewportSize(VIEWPORT);
  const world = await installReadingWorld(page);
  await page.goto('/school');

  const keypad = page.getByTestId('selfservice-keypad');
  await expect(keypad).toBeVisible();
  await screenshot(page, '01-panel-code');
  await expectViewportSafe(page);

  await page.keyboard.type(CODE);
  const card = page.getByTestId('selfservice-card');
  await expect(card).toBeVisible();
  await expect(card).toContainText('User_4');
  await expect(card).toContainText('English');
  await expect(page.getByTestId('selfservice-action-program')).toContainText('Open my books');
  await screenshot(page, '02-reading-launch-card');
  await expectViewportSafe(page);

  await page.getByTestId('selfservice-action-program').click();
  const shelfRoot = page.getByTestId('book-shelf');
  await expect(shelfRoot).toBeVisible();
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
    clientHeight: element.clientHeight,
    scrollHeight: element.scrollHeight,
  }));
  expect(boundedAuthors.lineClamp).toBe('2');
  expect(boundedAuthors.scrollHeight).toBeLessThanOrEqual(boundedAuthors.clientHeight + 1);
  const shelfScroll = await page.getByTestId('book-shelf-grid').evaluate((element) => ({
    clientHeight: element.clientHeight,
    scrollHeight: element.scrollHeight,
  }));
  expect(shelfScroll.scrollHeight).toBeGreaterThan(shelfScroll.clientHeight);
  await expect(page.getByRole('button', { name: 'Done', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: /history/i })).toBeVisible();
  await screenshot(page, '03-hostile-data-shelf');
  await expectViewportSafe(page);

  await page.getByRole('button', { name: 'Add a book', exact: true }).click();
  await expect(page.getByText('Type the number under the barcode')).toBeVisible();
  await page.keyboard.type(ISBN);
  const lookup = page.getByRole('button', { name: 'Look it up', exact: true });
  await expect(lookup).toBeEnabled();
  await lookup.click();

  await expect(page.getByRole('heading', { name: 'The Wild Robot: Escapes again' })).toBeVisible();
  await expect(page.getByText('Peter Brown, Jane Illustrator & 2 more')).toBeVisible();
  await expect(page.getByText('A robot & her friends survive a storm.')).toBeVisible();
  await expect(page.getByTestId('add-book')).not.toContainText('electronic resource');
  await screenshot(page, '04-isbn-confirmation');
  await expectViewportSafe(page);

  await page.getByRole('button', { name: 'Yes', exact: true }).click();
  await page.getByRole('button', { name: 'I already finished it', exact: true }).click();
  await expect(page.getByText('When did you finish it?')).toBeVisible();
  await page.getByRole('button', { name: "That's the day", exact: true }).click();

  const receipt = page.getByTestId('book-save-receipt');
  await expect(receipt).toBeVisible();
  await expect(receipt).toContainText('Book finished!');
  await expect(receipt).toContainText('The Wild Robot: Escapes again');
  await screenshot(page, '05-finished-receipt');
  await expectViewportSafe(page);

  const shelfWrite = world.writes.find((entry) => entry.pathname === '/api/v1/school/books/user_4/shelf');
  expect(shelfWrite?.body).toMatchObject({
    bookId: ISBN,
    where: 'finished',
    finishedOn: STUDY_DAY,
  });
  expect(shelfWrite.body.entryId).toMatch(/^[0-9a-f-]{36}$/i);
  expect(shelfWrite.body.progressEntryId).toMatch(/^[0-9a-f-]{36}$/i);

  await page.getByRole('button', { name: 'See History', exact: true }).click();
  await expect(page.getByTestId('book-history')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'September 2026' })).toBeVisible();
  await expect(page.getByText('The Wild Robot: Escapes again')).toBeVisible();
  await expect(page.getByText('Finished Sep 3')).toBeVisible();
  const historyCover = page.getByRole('img', { name: 'Cover of The Wild Robot: Escapes again' });
  await expect.poll(() => historyCover.evaluate((element) => element.complete && element.naturalWidth > 0)).toBe(true);
  await screenshot(page, '06-history');
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
  ]));
});
