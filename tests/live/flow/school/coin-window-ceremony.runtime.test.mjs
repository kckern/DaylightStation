/**
 * The status board's coin cells, the bank screen they open, and the coin
 * ceremony, in a real browser at the Portal's 1280x800. Frontend only: every
 * /api/v1/** call is stubbed here, so no backend runs and no ledger is
 * touched. The test fails on any write to the economy or earnings APIs.
 */
import { expect, test } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const OUT_DIR = path.join(process.cwd(), 'test-results/coin-window');
fs.mkdirSync(OUT_DIR, { recursive: true });

const VIEWPORT = { width: 1280, height: 800 };
const STUDY_DAY = '2026-10-21';
const NOW = new Date(2026, 9, 21, 10, 0);
const WEEK = { from: '2026-10-19', to: '2026-10-25' };
const SCREEN_CONFIG = {
  screen: 'portal',
  route: '/screen/portal',
  layout: { children: [{ widget: 'school', grow: 1, props: { mode: 'locked', screenId: 'portal' } }] },
};
const ROSTER = [
  { id: 'test-learner', name: 'Alpha', birthyear: 2016 },
  { id: 'test-learner-2', name: 'Beta', birthyear: 2018 },
];
const at = (d, h) => new Date(2026, 9, d, h, 0).toISOString();
const BANK = {
  userId: 'test-learner', mode: 'live', studyDay: STUDY_DAY,
  balances: { silver: 5, gold: 12, gems: 1 },
  history: [
    { text: '+2 silver · Korean (each day done)', at: at(21, 9), kind: 'earn', ids: ['e'], source: 'payout', label: 'Korean (each day done)', legs: [{ currency: 'silver', delta: 2 }], balanceAfter: { silver: 5, gold: 12, gems: 1 } },
    { text: '−3 silver · early pass', at: at(20, 15), kind: 'spend', ids: ['s'], source: 'spend', label: 'early pass', legs: [{ currency: 'silver', delta: -3 }], balanceAfter: { silver: 3, gold: 12, gems: 1 } },
    { text: '12 silver → 12 gold · Sunday', at: at(18, 20), kind: 'convert', ids: ['g', 'o'], source: 'conversion', label: 'silver → gold', legs: [{ currency: 'silver', delta: -12 }, { currency: 'gold', delta: 12 }], balanceAfter: { silver: 6, gold: 12, gems: 1 } },
  ],
  pass: {}, offers: {}, weekEndsAt: new Date(2026, 9, 26, 4, 0).toISOString(), weekEndsOn: '2026-10-25',
};
const learnerWeek = (learnerId, silver, pendingSilver = 0) => ({
  learnerId, totals: { silver, gems: 0 }, pending: { silver: pendingSilver, gems: 0 }, windows: { school: WEEK },
  lines: [
    { ruleId: 'korean-daily', label: 'Korean (each day done)', status: 'earned', amount: { silver: Math.max(silver - 3, 0), gems: 0 } },
    { ruleId: 'green-day', label: 'Green day', status: 'earned', amount: { silver: Math.min(silver, 3), gems: 0 } },
  ],
});

async function installWorld(page, { bankFails = false, openRefusal = null } = {}) {
  const writes = [];
  // The test flips `silver` right before it advances the poll. The board reads
  // earnings twice at load (the roster arrives after the first render), so a
  // count of reads cannot mark the moment.
  const world = { silver: 9, writes, previewReads: 0 };
  await page.clock.install({ time: NOW });
  await page.route('**/api/v1/**', async (route) => {
    const request = route.request();
    const { pathname } = new URL(request.url());
    const method = request.method();
    if (method !== 'GET') writes.push(`${method} ${pathname}`);
    const json = (value, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(value) });

    if (pathname === '/api/v1/screens/portal') return json(SCREEN_CONFIG);
    if (pathname === '/api/v1/school/roster') return json(ROSTER);
    if (pathname === '/api/v1/school/book-scans/pending') return json({ intent: null });
    if (pathname === '/api/v1/school/bank/open' && method === 'POST') {
      if (openRefusal) return json({ error: openRefusal }, 403);
      return json({ launchTarget: { kind: 'program', program: 'economy-bank', learnerId: request.postDataJSON().learnerId } });
    }
    if (pathname === '/api/v1/earnings/preview') {
      world.previewReads += 1;
      return json({ windows: { school: WEEK }, learners: [learnerWeek('test-learner', world.silver, 2), learnerWeek('test-learner-2', 4)] });
    }
    if (/^\/api\/v1\/economy\/users\/[^/]+\/wallet$/.test(pathname)) return json({ balance: 5, balances: { silver: 5, gold: 12, gems: 1 } });
    if (/^\/api\/v1\/economy\/users\/[^/]+\/bank$/.test(pathname)) return bankFails ? json({ error: 'down' }, 503) : json(BANK);
    if (pathname.endsWith('/agenda/preview')) {
      return json({ studyDay: STUDY_DAY, errors: [], entries: [{ unitId: 'math.01', subject: 'math' }],
        sections: [{ subject: 'math', next: { unitId: 'math.01', title: 'Fractions' }, obligation: { state: 'obligated' } }] });
    }
    if (pathname === '/api/v1/school/teacher/day') {
      return json({ schema: 'school.teacher-day/v2', studyDay: STUDY_DAY, learners: ROSTER.map((k) => ({ learnerId: k.id, sessions: [] })) });
    }
    if (pathname === '/api/v1/school/materials') return json({ materials: [] });
    if (pathname === '/api/v1/school/sentence-ladder/courses' || pathname === '/api/v1/school/banks') return json([]);
    if (pathname === '/api/v1/school/surfaces/profile') return json({ surfaceId: 'portal' });
    if (pathname === '/api/v1/state-gates') return json({ gates: [] });
    if (/\/api\/v1\/(?:users|user-pics|static|proxy)\//.test(pathname)) {
      return route.fulfill({ status: 404, contentType: 'text/plain', body: 'no fixture' });
    }
    return json({});
  });
  return world;
}

const shot = (page, name) => page.screenshot({ path: path.join(OUT_DIR, `${name}.png`) });

test('coin cells open the bank screen, and a silver rise pops the ceremony over the board', async ({ page }) => {
  await page.setViewportSize(VIEWPORT);
  const world = await installWorld(page);
  await page.goto('/school');
  await expect(page.getByTestId('selfservice-keypad')).toBeVisible({ timeout: 20_000 });

  const door = page.getByRole('button', { name: /^Alpha's bank/ });
  await expect(door).toBeVisible();
  await expect(door).toContainText('9');
  await expect(page.getByTestId('board-coins-door')).toHaveCount(2);
  await shot(page, '01-board');

  await door.click();
  const bank = page.getByTestId('bank-screen');
  await expect(bank).toBeVisible();
  await expect(bank.getByTestId('bank-tab-history')).toHaveAttribute('aria-selected', 'true');
  await expect(bank.getByTestId('bank-balances')).toBeVisible();
  await expect(bank.getByTestId('bank-pending')).toBeVisible();
  await expect(bank.getByTestId('bank-ledger-row')).toHaveCount(3);
  await shot(page, '02-bank-history');

  await bank.getByTestId('screen-header-back').click();
  await expect(bank).toHaveCount(0);
  await expect(page.getByTestId('selfservice-keypad')).toBeVisible();

  // The board polls every five minutes: flip the silver, then advance the clock.
  world.silver = 12;
  await page.clock.fastForward('05:05');
  await expect.poll(async () => page.getByRole('button', { name: /^Alpha's bank/ }).getAttribute('aria-label')).toContain('12 silver');
  await page.clock.runFor(2_000); // past the 1.5 s burst window
  const pop = page.getByTestId('coin-ceremony');
  await expect(pop).toBeVisible();
  await expect(pop).toContainText('+3');
  await expect(pop).toContainText('12 this week');
  await expect(pop).toContainText('Alpha');
  // The ceremony sits in the board pane, clear of the keypad.
  const card = await pop.getByRole('button').boundingBox();
  const keypad = await page.getByTestId('selfservice-keypad').boundingBox();
  expect(card.x >= keypad.x + keypad.width || card.x + card.width <= keypad.x).toBe(true);
  await page.waitForTimeout(400); // let the enter animation settle for the screenshot
  await shot(page, '03-ceremony');

  expect(world.writes.filter((w) => /economy|earnings/.test(w))).toEqual([]);
});

test('a bank that cannot be read naps, with no numbers', async ({ page }) => {
  await page.setViewportSize(VIEWPORT);
  await installWorld(page, { bankFails: true });
  await page.goto('/school');
  await expect(page.getByTestId('selfservice-keypad')).toBeVisible({ timeout: 20_000 });

  await page.getByRole('button', { name: /^Alpha's bank/ }).click();
  const bank = page.getByTestId('bank-screen');
  await expect(bank.getByTestId('bank-napping')).toHaveText('The bank is napping. Try again soon.');
  await expect(bank.getByTestId('bank-balances')).toHaveCount(0);
  await expect(bank.getByTestId('bank-ledger-row')).toHaveCount(0);
  await shot(page, '04-napping');
});

test('a refused open shows the refusal on "Whose bank?", outside the board, and Back returns', async ({ page }) => {
  await page.setViewportSize(VIEWPORT);
  await installWorld(page, { openRefusal: 'Choose a current School learner.' });
  await page.goto('/school');
  await expect(page.getByTestId('selfservice-keypad')).toBeVisible({ timeout: 20_000 });

  const door = page.getByRole('button', { name: /^Alpha's bank/ });
  await door.click();
  const who = page.getByRole('dialog', { name: 'Whose bank' });
  await expect(who).toBeVisible();
  await expect(who.getByRole('alert')).toHaveText('Choose a current School learner.');
  await expect(page.getByTestId('bank-screen')).toHaveCount(0);
  expect(await page.getByTestId('agenda-status-board').evaluate((board, el) => board.contains(el), await who.elementHandle())).toBe(false);
  await shot(page, '05-refusal');

  await who.getByTestId('screen-header-back').click();
  await expect(who).toHaveCount(0);
  await expect(page.getByTestId('selfservice-keypad')).toBeVisible();
  await expect(door).toBeFocused();
});
