/**
 * Personal reward chests, their modal, and the bank-details door, in a real browser at the Portal's 1280x800. Frontend only: every
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
  // Confine both APIs and sockets to this fixture; no household backend/HMR.
  await page.routeWebSocket('**/*', socket => socket.close());
  await page.route('**/api/v1/**', async (route) => {
    const request = route.request();
    const { pathname } = new URL(request.url());
    const method = request.method();
    if (method !== 'GET') writes.push(`${method} ${pathname}`);
    const json = (value, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(value) });

    // This rewards fixture models the ordinary household with supervision disabled.
    if (pathname === '/api/v1/supervision/bootstrap') return json({ enabled: false });
    if (pathname === '/api/v1/screens/portal') return json(SCREEN_CONFIG);
    if (pathname === '/api/v1/school/roster') return json(ROSTER);
    if (pathname === '/api/v1/school/book-scans/pending') return json({ intent: null });
    if (pathname === '/api/v1/school/bank/open' && method === 'POST') {
      if (openRefusal) return json({ error: openRefusal }, 403);
      return json({ launchTarget: { kind: 'program', program: 'economy-bank', learnerId: request.postDataJSON().learnerId } });
    }
    if (pathname.startsWith('/api/v1/earnings/preview/')) return json(learnerWeek(pathname.split('/').at(-1), world.silver));
    if (pathname === '/api/v1/earnings/gems') return json({ mode: 'live', learners: ROSTER.map(k => ({ learnerId: k.id, name: k.name })), categories: [{ id: 'reading', label: 'Reading', color: '#82c5b8' }], cells: { reading: { 'test-learner': { state: 'earned', week: 1, held: 1, parts: [{ ruleId: 'reader', label: 'Story time', state: 'earned', week: 1 }] } } } });
    if (pathname === '/api/v1/earnings/preview') {
      world.previewReads += 1;
      if (world.holdPreview) await world.holdPreview;
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
    if (pathname === '/api/v1/state-gates') return json({ items: ROSTER.map(k => ({ evaluation: { gateId: 'fitness.weekly-rings', subject: { kind: 'learner', id: k.id }, period: { kind: 'interval', startsAt: 0, endsAt: 4102444800000 }, progress: { current: 1260, target: 1 } } })) });
    if (/\/api\/v1\/(?:users|user-pics|static|proxy)\//.test(pathname)) {
      return route.fulfill({ status: 404, contentType: 'text/plain', body: 'no fixture' });
    }
    return json({});
  });
  return world;
}

const shot = (page, name) => page.screenshot({ path: path.join(OUT_DIR, `${name}.png`) });

async function openRewards(page) {
  const chest = page.getByRole('button', { name: "Open Alpha's rewards" });
  await expect(chest).toBeEnabled();
  await chest.click();
  await page.clock.runFor(500);
  const modal = page.getByRole('dialog', { name: "Alpha's rewards" });
  await expect(modal).toBeVisible();
  return modal;
}

async function openBankDetails(page) {
  const modal = await openRewards(page);
  await modal.getByRole('button', { name: 'Bank log' }).click();
  await expect(modal).toHaveCount(0);
}

test('icon-only chests reveal individual rewards and bank details without public totals or ceremonies', async ({ page }) => {
  await page.setViewportSize(VIEWPORT);
  const world = await installWorld(page);
  await page.goto('/school');
  await expect(page.getByTestId('selfservice-keypad')).toBeVisible({ timeout: 20_000 });
  const door = page.getByRole('button', { name: "Open Alpha's rewards" });
  await expect(door).toBeVisible();
  await expect(door).toHaveText('');
  await expect(door).toBeEnabled();
  await expect(page.getByRole('button', { name: "Open Beta's rewards" })).toBeVisible();
  await expect(page.getByTestId('board-coins-door')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Open the gem board' })).toHaveCount(0);
  await shot(page, '01-board');

  const rewards = await openRewards(page);
  await expect(rewards.getByText('9', { exact: true })).toBeVisible();
  await expect(rewards).not.toContainText('Beta');
  await shot(page, '02-personal-rewards');
  await rewards.getByRole('button', { name: 'Bank log' }).click();
  const bank = page.getByTestId('bank-screen');
  await expect(bank).toBeVisible();
  await expect(bank.getByTestId('bank-tab-history')).toHaveAttribute('aria-selected', 'true');
  await expect(bank.getByTestId('bank-balances')).toBeVisible();
  await expect(bank.getByTestId('bank-ledger-row')).toHaveCount(3);
  await shot(page, '03-bank-history');
  await bank.getByTestId('screen-header-back').click();
  await expect(bank).toHaveCount(0);
  await expect(page.getByTestId('selfservice-keypad')).toBeVisible();

  world.silver = 12;
  await page.clock.fastForward('05:05');
  await expect(page.getByTestId('coin-ceremony')).toHaveCount(0);
  await expect(door).toHaveText('');
  const updated = await openRewards(page);
  await expect(updated.getByText('12', { exact: true }).first()).toBeVisible();
  await expect(updated.getByText(/Loading/)).toHaveCount(0);
  await expect(updated.getByText('1,260')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(updated).toHaveCount(0);
  await expect(page.getByTestId('selfservice-keypad')).toBeVisible();
  await expect(door).toBeFocused();
  expect(world.previewReads).toBeGreaterThan(0);
  expect(world.writes.filter(w => /economy|earnings/.test(w))).toEqual([]);
});

test('a bank that cannot be read naps, with no numbers', async ({ page }) => {
  await page.setViewportSize(VIEWPORT);
  await installWorld(page, { bankFails: true });
  await page.goto('/school');
  await expect(page.getByTestId('selfservice-keypad')).toBeVisible({ timeout: 20_000 });

  await openBankDetails(page);
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

  const door = page.getByRole('button', { name: "Open Alpha's rewards" });
  await openBankDetails(page);
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


test('preloaded rewards open without requests and stay fixed while a held background poll settles', async ({ page }) => {
  await page.setViewportSize(VIEWPORT);
  const world = await installWorld(page);
  await page.goto('/school');
  const chest = page.getByRole('button', { name: "Open Alpha's rewards" });
  await expect(chest).toBeEnabled({ timeout: 20000 });
  let release;
  world.silver = 31;
  world.holdPreview = new Promise(resolve => { release = resolve; });
  await page.clock.fastForward('01:01');
  await expect.poll(() => world.previewReads).toBeGreaterThan(1);
  const reads = world.previewReads;
  const modal = await openRewards(page);
  await expect(modal.getByText('9', { exact: true })).toBeVisible();
  await expect(modal.getByText(/Loading/)).toHaveCount(0);
  const before = await modal.boundingBox();
  const response = page.waitForResponse(r => new URL(r.url()).pathname === '/api/v1/earnings/preview');
  release(); world.holdPreview = null; await response;
  await page.clock.runFor(200);
  await expect(modal.getByText('9', { exact: true })).toBeVisible();
  expect(await modal.boundingBox()).toEqual(before);
  expect(world.previewReads).toBe(reads);
  await modal.getByRole('button', { name: 'Close rewards' }).click();
  const refreshed = await openRewards(page);
  await expect(refreshed.getByText('31', { exact: true })).toBeVisible();
  expect(world.previewReads).toBe(reads);
});


test('touch-down starts the chest before release and keyboard activation still works', async ({ page }) => {
  await page.setViewportSize(VIEWPORT); await installWorld(page); await page.goto('/school');
  const chest = page.getByRole('button', { name: "Open Alpha's rewards" });
  await expect(chest).toBeEnabled({ timeout: 20000 });
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 });
  const box = await chest.boundingBox();
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: box.x + box.width / 2, y: box.y + box.height / 2 }] });
  await expect(chest).toHaveClass(/is-opening/);
  await page.clock.runFor(500);
  const modal = page.getByRole('dialog', { name: "Alpha's rewards" });
  await expect(modal).toBeVisible();
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await expect(modal).toBeVisible();
  await page.keyboard.press('Escape'); await expect(chest).toBeFocused();
  await page.keyboard.press('Enter'); await page.clock.runFor(500);
  await expect(modal).toBeVisible(); await cdp.detach();
});
