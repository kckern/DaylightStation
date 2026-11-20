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

async function installTriage(page, { holdBen } = {}) {
  const reads = [];
  const commands = [];
  const benSummary = Promise.withResolvers();
  await page.routeWebSocket('**/*', () => {});
  await page.route('**/api/**', async route => {
    const { pathname, searchParams } = new URL(route.request().url());
    const username = searchParams.get('username');
    if (pathname.endsWith('/supervision/bootstrap')) return route.fulfill({ json: { enabled: false } });
    if (pathname.endsWith('/life/users')) return route.fulfill({ json: { users: [amy, ben] } });
    if (pathname.endsWith('/life/user')) return route.fulfill({ json: username === 'ben' ? ben : amy });
    if (pathname.endsWith('/life/plan/')) return route.fulfill({ json: { purpose: { statement: 'Fixture plan' } } });
    if (pathname.endsWith('/life/now')) return route.fulfill({ json: { priorities: [], dashboard: {} } });
    if (!pathname.includes('/triage/')) return route.fulfill({ json: {} });
    const operation = pathname.slice('/api/v1/triage/'.length);
    if (route.request().method() !== 'GET') {
      commands.push({ username, operation, body: route.request().postDataJSON() });
      return route.fulfill({ json: { outcome: 'applied' } });
    }
    reads.push([username, operation]);
    if (operation === 'summary' && username === 'ben' && holdBen) await benSummary.promise;
    if (operation === 'summary') return route.fulfill({ json: username === 'ben' ? { enrolled: false } : summary });
    if (operation === 'session') return route.fulfill({ json: { steps: [{ id: 'unsure', count: 1 }], cards: [card], total: 1, done: 0 } });
    return route.fulfill({ json: { entries: [] } });
  });
  return { reads, commands, benSummary };
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
