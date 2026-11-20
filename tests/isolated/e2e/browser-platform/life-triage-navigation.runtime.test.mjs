import { expect, test } from '@playwright/test';

test.use({ hasTouch: true, serviceWorkers: 'block' });

const amy = { username: 'amy', displayName: 'Amy' };
const ben = { username: 'ben', displayName: 'Ben' };
const summary = { enrolled: true, mode: 'live', open: { unsure: 1 }, preDone: { archived: 2 } };
const card = {
  cardId: 'amy-fixture', kind: 'email', step: 'unsure', status: 'open',
  display: { title: 'Fixture inbox subject', snippet: 'Fixture request', source: 'Fixture' },
  choices: [{ key: 'keep', label: 'Keep in inbox' }],
};

const benCard = {
  ...card, cardId: 'ben-fixture',
  display: { ...card.display, title: "Ben’s fixture inbox subject" },
};
const sessionToken = username => username + '-fixture-session';

async function installTriage(page, { holdBen, requireOwner = false } = {}) {
  const reads = [];
  const commands = [];
  const signIns = [];
  const authReads = [];
  const benSummary = Promise.withResolvers();
  await page.routeWebSocket('**/*', () => {});
  await page.route('**/api/**', async route => {
    const request = route.request();
    const { pathname, searchParams } = new URL(request.url());
    const username = searchParams.get('username');
    if (pathname.endsWith('/supervision/bootstrap')) return route.fulfill({ json: { enabled: false } });
    if (pathname.endsWith('/life/users')) return route.fulfill({ json: { users: [amy, ben] } });
    if (pathname.endsWith('/life/user')) return route.fulfill({ json: username === 'ben' ? ben : amy });
    if (pathname.endsWith('/life/plan/')) return route.fulfill({ json: { purpose: { statement: 'Fixture plan' } } });
    if (pathname.endsWith('/life/now')) return route.fulfill({ json: { priorities: [], dashboard: {} } });
    if (pathname === '/api/v1/auth/context') {
      authReads.push(request.method());
      return route.fulfill({ json: { needsSetup: false } });
    }
    if (pathname.endsWith('/auth/token') && requireOwner) {
      const { username: owner } = request.postDataJSON();
      signIns.push(owner);
      return route.fulfill({ json: { token: sessionToken(owner) } });
    }
    if (!pathname.includes('/triage/')) return route.fulfill({ json: {} });
    const operation = pathname.slice('/api/v1/triage/'.length);
    if (requireOwner && operation !== 'summary') {
      const authorization = request.headers().authorization;
      if (!authorization) return route.fulfill({ status: 401, json: { error: 'login_required' } });
      if (authorization !== 'Bearer ' + sessionToken(username)) {
        reads.push([username, operation]);
        return route.fulfill({ status: 403, json: { error: 'session_user_mismatch' } });
      }
    }
    if (request.method() !== 'GET') {
      commands.push({ username, operation, body: request.postDataJSON() });
      return route.fulfill({ json: { outcome: 'applied' } });
    }
    reads.push([username, operation]);
    if (operation === 'summary' && username === 'ben' && holdBen) await benSummary.promise;
    if (operation === 'summary') return route.fulfill({ json: username === 'ben' && !requireOwner ? { enrolled: false } : summary });
    if (operation === 'session') return route.fulfill({ json: { steps: [{ id: 'unsure', count: 1 }], cards: [username === 'ben' ? benCard : card], total: 1, done: 0 } });
    return route.fulfill({ json: { entries: [] } });
  });
  return { reads, commands, signIns, authReads, benSummary };
}

for (const width of [390, 1440]) {
  test('Life triage provides links within Now and follows the household member at ' + width + 'px', async ({ page }) => {
    await page.setViewportSize({ width, height: 850 });
    const { reads, commands, benSummary } = await installTriage(page, { holdBen: true });
    try {
      await page.goto('/life/now');
      const main = page.getByRole('main');
      const now = page.getByRole('link', { name: 'Now', exact: true });
      await expect(main.getByText('2 emails archived')).toBeVisible();
      const start = main.getByRole('link', { name: /Start triage/ });
      await expect(start).toHaveAttribute('href', '/life/now/triage');
      if (await page.evaluate(() => matchMedia('(pointer: coarse)').matches)) {
        const size = await start.boundingBox();
        expect(Math.min(size.width, size.height)).toBeGreaterThanOrEqual(44);
      }
      await start.press('Enter');
      await expect(page).toHaveURL(/\/life\/now\/triage$/);
      await expect(now).toHaveAttribute('aria-current', 'page');
      await expect(main.getByText(card.display.title)).toBeVisible();
      await expect(main).toHaveCount(1);
      await main.getByRole('button', { name: 'Keep in inbox', exact: false }).press('Enter');
      await expect.poll(() => commands).toEqual([{ username: 'amy', operation: 'cards/amy-fixture/answer', body: { choice: 'keep' } }]);
      await expect(main.getByText(/All done/)).toBeVisible();
      await expect(main.getByRole('link', { name: 'Back to Now' })).toHaveAttribute('href', '/life/now');
      await expect(main.getByRole('link', { name: 'Stop for now' })).toHaveAttribute('href', '/life/now');
      await page.goBack();
      await expect(page).toHaveURL(/\/life\/now$/);
      await expect(main.getByText('2 emails archived')).toBeVisible();

      await start.press('Enter');
      await expect(main.getByText(card.display.title)).toBeVisible();
      const member = page.getByRole('textbox', { name: 'Switch household member' });
      await member.click();
      await page.getByRole('option', { name: 'Ben', exact: true }).click();
      await expect.poll(() => reads.filter(([username]) => username === 'ben')).toEqual([['ben', 'summary']]);
      await expect(main.getByText(card.display.title)).toHaveCount(0);
      await expect(main.getByRole('button', { name: 'Keep in inbox', exact: false })).toHaveCount(0);
      benSummary.resolve();
      await expect(main.getByText(/isn.t set up/i)).toBeVisible();
      expect(reads.filter(([username]) => username === 'ben')).toEqual([['ben', 'summary']]);
      expect(commands).toHaveLength(1);
    } finally {
      benSummary.resolve();
    }
  });
}

test('Life triage asks for the selected owner sign-in when another member is signed in', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 850 });
  await page.addInitScript(token => localStorage.setItem('ds_token', token), sessionToken(amy.username));
  const { reads, commands, signIns, authReads } = await installTriage(page, { requireOwner: true });
  const main = page.getByRole('main');
  await page.goto('/life/now/triage');
  await expect(main.getByText(card.display.title)).toBeVisible();
  await page.getByRole('textbox', { name: 'Switch household member' }).click();
  await page.getByRole('option', { name: 'Ben', exact: true }).click();

  await expect(main.getByText('Sign in as Ben to answer their triage cards.')).toBeVisible();
  await expect(main.getByText(card.display.title)).toHaveCount(0);
  expect(await page.evaluate(() => localStorage.getItem('ds_token'))).toBe(sessionToken(amy.username));
  expect(signIns).toEqual([]);
  expect(commands).toEqual([]);

  await main.getByRole('textbox', { name: 'Username' }).fill(ben.username);
  await main.getByLabel('Password', { exact: true }).fill('fixture-password');
  await main.getByRole('button', { name: 'Sign In', exact: true }).press('Enter');
  await expect(main.getByText(benCard.display.title)).toBeVisible();
  expect(signIns).toEqual([ben.username]);
  expect(authReads).toEqual(['GET']);
  expect(reads.filter(([username]) => username === ben.username)).toEqual([
    [ben.username, 'summary'], [ben.username, 'session'], [ben.username, 'summary'], [ben.username, 'session'],
  ]);
  await main.getByRole('button', { name: 'Keep in inbox', exact: false }).press('Enter');
  await expect.poll(() => commands).toEqual([
    { username: ben.username, operation: 'cards/ben-fixture/answer', body: { choice: 'keep' } },
  ]);
});
