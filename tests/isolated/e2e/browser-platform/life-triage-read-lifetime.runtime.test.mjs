import { expect, test } from '@playwright/test';

test.use({ serviceWorkers: 'block' });

const member = { username: 'amy', displayName: 'Amy' };
const card = {
  cardId: 'fixture-card', kind: 'email', step: 'unsure', status: 'open',
  display: { title: 'Current fixture card', snippet: 'Fixture message', source: 'Fixture' },
  choices: [{ key: 'keep', label: 'Keep in inbox' }],
};
const recap = { cardId: 'fixture-recap', kind: 'recap', step: 'recap', status: 'open' };
const loginRequired = { status: 401, json: { error: 'login_required' } };

async function installTriage(page, { hold, heldResult, chosenCard = card, signIn = false }) {
  const held = Promise.withResolvers();
  const release = Promise.withResolvers();
  const reads = [];
  const commands = [];
  const canceled = [];
  await page.routeWebSocket('**/*', () => {});
  page.on('requestfailed', request => {
    const { pathname } = new URL(request.url());
    if (pathname.startsWith('/api/v1/triage/')) canceled.push(pathname.split('/').pop());
  });
  await page.route('**/api/**', async route => {
    const request = route.request();
    const { pathname, searchParams } = new URL(request.url());
    if (pathname.endsWith('/supervision/bootstrap')) return route.fulfill({ json: { enabled: false } });
    if (pathname.endsWith('/life/user')) return route.fulfill({ json: member });
    if (pathname.endsWith('/life/users')) return route.fulfill({ json: { users: [member] } });
    if (pathname.endsWith('/life/plan/')) return route.fulfill({ json: { purpose: { statement: 'Fixture plan' } } });
    if (pathname.endsWith('/life/now')) return route.fulfill({ json: { priorities: [], dashboard: {} } });
    if (pathname === '/api/v1/auth/context') return route.fulfill({ json: { needsSetup: false } });
    if (pathname.endsWith('/auth/token')) return route.fulfill({ json: { token: 'fixture-token' } });
    if (!pathname.startsWith('/api/v1/triage/')) return route.fulfill({ json: {} });
    const operation = pathname.split('/').pop();
    const read = [searchParams.get('username'), operation, searchParams.get('sinceDays')];
    if (request.method() !== 'GET') {
      commands.push(request.method());
      return route.fulfill({ json: { outcome: 'applied' } });
    }
    const first = !reads.some(([, previouslyRead]) => previouslyRead === operation);
    reads.push(read);
    if (first && operation === hold) {
      held.resolve();
      await release.promise;
      if (canceled.includes(hold)) return;
      return route.fulfill(heldResult);
    }
    if (operation === 'summary') return route.fulfill({ json: { enrolled: true, mode: 'live' } });
    if (operation === 'session') {
      if (signIn && request.headers().authorization !== 'Bearer fixture-token') return route.fulfill(loginRequired);
      return route.fulfill({ json: {
        steps: [{ id: chosenCard.step, count: 1 }], cards: [chosenCard], total: 1, done: 0,
      } });
    }
    return route.fulfill({ json: { entries: [
      { id: 'current-log', actor: 'owner', action: 'keep', title: 'Current fixture action' },
    ] } });
  });
  return { held, release, reads, commands, canceled };
}

test('Life Triage retires the held owner session when leaving its route', async ({ page }) => {
  const { held, release, reads, commands, canceled } = await installTriage(page, { hold: 'session', heldResult: loginRequired });
  const main = page.getByRole('main');
  const start = main.getByText(/Start triage/);
  try {
    await page.goto('/life/now');
    await start.click();
    await held.promise;
    await page.getByRole('link', { name: 'Log', exact: true }).click();
    await expect(page).toHaveURL('/life/log');
    await page.getByRole('link', { name: 'Now', exact: true }).click();
    await start.click();
    await expect(main.getByText('Current fixture card')).toBeVisible();
    expect(reads.filter(([, operation]) => operation === 'session')).toEqual([
      ['amy', 'session', null], ['amy', 'session', null],
    ]);
    await expect.poll(() => canceled).toEqual(['session']);
    expect(commands).toEqual([]);
  } finally {
    release.resolve();
  }
});

test('Life Triage ignores a retired Review refusal while retaining the current recap', async ({ page }) => {
  const { held, release, reads, commands, canceled } = await installTriage(page, { hold: 'log', heldResult: loginRequired, chosenCard: recap });
  const main = page.getByRole('main');
  const review = main.getByRole('button', { name: 'Review', exact: true });
  try {
    await page.goto('/life/now/triage');
    await review.click();
    await held.promise;
    await main.getByRole('button', { name: 'Hide', exact: true }).click();
    await review.click();
    await expect(main.getByText('Current fixture action')).toBeVisible();
    release.resolve();
    await expect.poll(() => canceled).toEqual(['log']);
    await expect(main.getByText('Current fixture action')).toBeVisible();
    await expect(main.getByText('Sign in to answer triage cards.')).toHaveCount(0);
    expect(reads.filter(([, operation]) => operation === 'log')).toEqual([['amy', 'log', '7'], ['amy', 'log', '7']]);
    expect(commands).toEqual([]);
  } finally {
    release.resolve();
  }
});

test('Life Triage times out a held read and still honors active login-required recovery', async ({ page }) => {
  await page.clock.install();
  const { held, release, reads, commands, canceled } = await installTriage(page, { hold: 'session', heldResult: loginRequired, signIn: true });
  const main = page.getByRole('main');
  try {
    await page.goto('/life/now/triage');
    await held.promise;
    await page.clock.fastForward(15000);
    await expect(main.getByText('Triage unavailable')).toBeVisible();
    await expect.poll(() => canceled).toEqual(['session']);
    await main.getByRole('button', { name: 'retry', exact: true }).click();
    await expect(main.getByText('Sign in to answer triage cards.')).toBeVisible();
    await main.getByRole('textbox', { name: 'Username' }).fill(member.username);
    await main.getByLabel('Password', { exact: true }).fill('fixture-password');
    await main.getByRole('button', { name: 'Sign In', exact: true }).click();
    await expect(main.getByText('Current fixture card')).toBeVisible();
    expect(reads.map(([, operation]) => operation)).toEqual(['summary', 'session', 'summary', 'session', 'summary', 'session']);
    expect(commands).toEqual([]);
  } finally {
    release.resolve();
  }
});

test('Life Triage retries only the stalled Review read and keeps the recap loaded', async ({ page }) => {
  await page.clock.install();
  const { held, release, reads, commands, canceled } = await installTriage(page, { hold: 'log', heldResult: loginRequired, chosenCard: recap });
  const main = page.getByRole('main');
  try {
    await page.goto('/life/now/triage');
    await main.getByRole('button', { name: 'Review', exact: true }).click();
    await held.promise;
    await page.clock.fastForward(15000);
    await expect(main.getByText("Couldn't load what was done.")).toBeVisible();
    await expect.poll(() => canceled).toEqual(['log']);
    await expect(main.getByRole('button', { name: /Got it/ })).toBeVisible();
    await main.getByRole('button', { name: 'Try again', exact: true }).click();
    await expect(main.getByText('Current fixture action')).toBeVisible();
    expect(reads.map(([, operation]) => operation)).toEqual(['summary', 'session', 'log', 'log']);
    expect(commands).toEqual([]);
  } finally {
    release.resolve();
  }
});
