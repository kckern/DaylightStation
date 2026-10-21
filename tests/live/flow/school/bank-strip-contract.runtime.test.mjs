/**
 * The Portal's bank, end to end in a real browser (economy slice 1, C3):
 * strip → chip → door → bank screen → back, and the coin button's "Whose
 * bank?" door. Frontend only: every `/api/v1/**` call is stubbed here, so no
 * backend runs and no ledger is touched.
 */
import { expect, test } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const OUT_DIR = path.join(process.cwd(), 'test-results/bank-strip');
fs.mkdirSync(OUT_DIR, { recursive: true });

const VIEWPORT = { width: 1280, height: 800 };
const STUDY_DAY = '2026-10-21';
const GRANT = 'signed-disposable-bank-grant';
const SCREEN_CONFIG = {
  screen: 'portal',
  route: '/screen/portal',
  layout: { children: [{ widget: 'school', grow: 1, props: { mode: 'locked', screenId: 'portal' } }] },
};
const ROSTER = [
  { id: 'learner_a', name: 'Learner A', birthyear: 2016 },
  { id: 'learner_b', name: 'Learner B', birthyear: 2018 },
];

const bankFor = (learnerId) => ({
  userId: learnerId,
  studyDay: STUDY_DAY,
  balances: learnerId === 'learner_a' ? { silver: 7, gold: 12, gems: 1 } : { silver: 2, gold: 0, gems: 0 },
  history: [
    { text: '+2 silver · Fractions 4-02 passed', at: new Date().toISOString(), kind: 'earn', ids: ['h1'] },
    { text: '12 silver → 12 gold · Sunday', at: '2026-10-18T20:00:00.000Z', kind: 'convert', ids: ['h2', 'h3'] },
  ],
  pass: { 'piano.games': { passId: null, state: 'none', capUsed: false } },
  offers: { 'piano.games': [{ coin: 'silver', price: 10, affordable: false }] },
  weekEndsAt: new Date(Date.now() + 3 * 86_400_000).toISOString(),
});

async function installBankWorld(page, { bankFails = false } = {}) {
  const opens = [];
  await page.route('**/api/v1/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const pathname = url.pathname;
    const method = request.method();
    const json = (value, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(value) });

    if (pathname === '/api/v1/screens/portal') return json(SCREEN_CONFIG);
    if (pathname === '/api/v1/school/roster') return json(ROSTER);
    if (pathname === '/api/v1/school/book-scans/pending') return json({ intent: null });
    if (pathname === '/api/v1/school/bank/open' && method === 'POST') {
      const body = request.postDataJSON();
      opens.push(body);
      return json({ launchTarget: { kind: 'program', program: 'economy-bank', learnerId: body.learnerId, bankGrant: GRANT } });
    }
    const bank = /^\/api\/v1\/economy\/users\/([^/]+)\/bank$/.exec(pathname);
    if (bank) return bankFails ? json({ error: 'down' }, 503) : json(bankFor(decodeURIComponent(bank[1])));
    const next = /^\/api\/v1\/school\/self-service\/learners\/([^/]+)\/next$/.exec(pathname);
    if (next) {
      return json({ subject: 'math', unit: { unitId: 'math.402', title: 'Fractions 4-03', subject: 'math' }, printable: true, reward: null });
    }
    if (pathname.endsWith('/agenda/preview')) {
      return json({
        studyDay: STUDY_DAY, entries: [], errors: [],
        sections: [
          { subject: 'math', next: { unitId: 'math.402', title: 'Fractions 4-03' }, obligation: { state: 'obligated' } },
          { subject: 'geography', next: { unitId: 'geo.07', title: 'Rivers of the world' }, obligation: { state: 'obligated' } },
        ],
      });
    }
    if (pathname === '/api/v1/school/teacher/day') {
      return json({ schema: 'school.teacher-day/v2', studyDay: STUDY_DAY, learners: ROSTER.map((k) => ({ learnerId: k.id, sessions: [] })) });
    }
    if (pathname === '/api/v1/school/materials') return json({ materials: [] });
    if (pathname === '/api/v1/school/sentence-ladder/courses' || pathname === '/api/v1/school/banks') return json([]);
    if (pathname === '/api/v1/school/surfaces/profile') return json({ surfaceId: 'portal' });
    if (pathname === '/api/v1/state-gates') return json({ gates: [] });
    if (/\/api\/v1\/(?:users|user-pics)\//.test(pathname)) {
      return route.fulfill({ status: 404, contentType: 'text/plain', body: 'no portrait fixture' });
    }
    return json({});
  });
  return { opens };
}

async function screenshot(page, name) {
  await page.screenshot({ path: path.join(OUT_DIR, `${name}.png`), fullPage: true });
}

test('strip → chip → bank screen → back, with no buy button and no path of its own', async ({ page }) => {
  await page.setViewportSize(VIEWPORT);
  const world = await installBankWorld(page);
  await page.goto('/school');

  await expect(page.getByTestId('selfservice-keypad')).toBeVisible({ timeout: 20_000 });
  const chips = page.getByTestId('bank-chip');
  await expect(chips).toHaveCount(2);
  await expect(chips.first()).toContainText('7');
  await screenshot(page, '01-strip');
  const pathBefore = new URL(page.url()).pathname;

  await chips.first().getByTestId('bank-chip-open').click();
  const bank = page.getByTestId('bank-screen');
  await expect(bank).toBeVisible();
  expect(world.opens.map((o) => o.learnerId)).toEqual(['learner_a']);
  await expect(bank.getByRole('heading', { name: 'Bank' })).toBeVisible();
  await expect(bank).toContainText('Learner A');
  const balances = bank.getByTestId('bank-balances');
  await expect(balances).toContainText('becomes gold in');
  await expect(balances).toContainText('yours for good');
  await expect(bank.getByTestId('bank-history')).toContainText('Today');
  await expect(bank.getByTestId('bank-history')).toContainText('+2 silver · Fractions 4-02 passed');
  await expect(bank.getByTestId('bank-spend')).toContainText('3 more silver');
  await expect(bank.getByTestId('bank-earn')).toContainText('Rivers of the world');
  await expect(bank.getByRole('button', { name: /buy/i })).toHaveCount(0);
  await expect(page.getByTestId('selfservice-section-exit')).toHaveCount(0);
  expect(new URL(page.url()).pathname).toBe(pathBefore);
  await screenshot(page, '02-bank');

  await bank.getByTestId('screen-header-back').click();
  await expect(bank).toHaveCount(0);
  await expect(page.getByTestId('selfservice-keypad')).toBeVisible();
  await expect(chips).toHaveCount(2);
});

test('the coin button asks whose bank, and opens the one tapped', async ({ page }) => {
  await page.setViewportSize(VIEWPORT);
  const world = await installBankWorld(page);
  await page.goto('/school');
  await expect(page.getByTestId('selfservice-keypad')).toBeVisible({ timeout: 20_000 });

  await page.getByTestId('bank-door').click();
  const who = page.getByRole('dialog', { name: 'Whose bank' });
  await expect(who).toBeVisible();
  await screenshot(page, '03-whose-bank');
  await who.getByRole('button', { name: 'Learner B' }).click();
  await expect(page.getByTestId('bank-screen')).toContainText('Learner B');
  expect(world.opens.map((o) => o.learnerId)).toEqual(['learner_b']);
});

test('a bank that cannot be read naps, with no numbers', async ({ page }) => {
  await page.setViewportSize(VIEWPORT);
  await installBankWorld(page, { bankFails: true });
  await page.goto('/school');
  await expect(page.getByTestId('selfservice-keypad')).toBeVisible({ timeout: 20_000 });

  await page.getByTestId('bank-chip-open').first().click();
  const bank = page.getByTestId('bank-screen');
  await expect(bank.getByTestId('bank-napping')).toHaveText('The bank is napping. Try again soon.');
  await expect(bank.getByTestId('bank-balances')).toHaveCount(0);
  await expect(bank.getByTestId('bank-history')).toHaveCount(0);
  await screenshot(page, '04-napping');
});
