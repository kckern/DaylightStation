import { expect, test } from '@playwright/test';

test.use({ serviceWorkers: 'block' });

const users = ['amy', 'bob'].map(username => ({ username, displayName: username.toUpperCase() }));

test.beforeEach(async ({ page }) => {
  await page.routeWebSocket('**/*', () => {});
  await page.route('**/api/**', route => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith('/life/users')) return route.fulfill({ json: { users } });
    if (url.pathname.endsWith('/life/user')) {
      const user = users.find(member => member.username === url.searchParams.get('username'));
      return route.fulfill({ json: user || users[0] });
    }
    return route.fulfill({ json: url.pathname.endsWith('/supervision/bootstrap') ? { enabled: false } : {} });
  });
});

for (const [section, resource] of [['Beliefs', 'beliefs'], ['Qualities', '']]) {
  test('Life ' + section + ' retries only the selected member GET before showing its empty state', async ({ page }) => {
    const path = '/api/v1/life/plan/' + resource;
    const requests = [];
    await page.route(url => url.pathname === path, route => {
      requests.push([route.request().method(), new URL(route.request().url()).search]);
      return requests.length === 1
        ? route.fulfill({ status: 400, json: { error: 'Fixture unavailable' } })
        : route.fulfill({ json: { [section.toLowerCase()]: [] } });
    });

    await page.goto('/life/plan/' + section.toLowerCase());
    await expect(page.getByRole('alert')).toContainText(section + ' failed to load');
    const empty = section === 'Beliefs'
      ? page.getByText(/No beliefs defined/)
      : page.getByRole('button', { name: 'Talk to your coach' });
    await expect(empty).toHaveCount(0);
    expect(requests).toEqual([['GET', '?username=amy']]);
    await page.getByRole('button', { name: 'Retry', exact: true }).click();
    await expect(empty).toBeVisible();
    expect(requests).toEqual([['GET', '?username=amy'], ['GET', '?username=amy']]);
    if (section === 'Qualities') {
      await empty.click();
      await expect(page).toHaveURL(/\/life\/coach$/);
      await expect(page.getByRole('button', { name: 'Send message' })).toBeVisible();
    }
  });
}

test('Life Coach aborts the previous member stream and keeps the new member reply in its own thread', async ({ page }) => {
  const requests = [];
  const firstStream = Promise.withResolvers();
  await page.addInitScript(() => {
    window.lifeCoachSignals = [];
    const originalFetch = window.fetch;
    window.fetch = function (input, options) {
      if (String(input).endsWith('/agents/lifeplan-guide/run-stream')) window.lifeCoachSignals.push(options?.signal);
      return originalFetch.apply(this, arguments);
    };
  });
  const answer = (route, text) => route.fulfill({
    contentType: 'text/event-stream',
    body: 'data: ' + JSON.stringify({ type: 'text-delta', text }) + '\n\ndata: {"type":"done"}\n\n',
  });
  await page.route('**/agents/lifeplan-guide/run-stream', route => {
    requests.push({ method: route.request().method(), ...route.request().postDataJSON() });
    if (requests.length === 1) {
      firstStream.resolve(route);
      return;
    }
    return answer(route, 'Bob reply');
  });
  await page.goto('/life/coach');
  const send = async text => {
    await page.getByPlaceholder(/^Ask…/).fill(text);
    await page.getByRole('button', { name: 'Send message' }).click();
  };
  await send('Amy question');
  const held = await firstStream.promise;
  const switcher = page.getByRole('textbox', { name: 'Switch household member' });
  await switcher.click();
  await page.getByRole('option', { name: 'BOB', exact: true }).click();
  await expect(switcher).toHaveValue('BOB');
  await expect.poll(() => page.evaluate(() => window.lifeCoachSignals[0]?.aborted)).toBe(true);
  await expect(page.getByText('Amy question', { exact: true })).toHaveCount(0);
  await send('Bob question');
  const reply = page.getByText('Bob reply', { exact: true });
  await expect(reply).toBeVisible();
  await answer(held, 'Late Amy reply');
  await expect(reply).toBeVisible();
  await expect(page.getByText('Late Amy reply', { exact: true })).toHaveCount(0);
  expect(requests.map(request => [request.method, request.context.userId, request.messages])).toEqual([
    ['POST', 'amy', [{ role: 'user', content: 'Amy question' }]],
    ['POST', 'bob', [{ role: 'user', content: 'Bob question' }]],
  ]);
  for (const request of requests) expect(request.threadId).toEqual(expect.any(String));
  expect(requests[0].threadId).not.toBe(requests[1].threadId);
});
