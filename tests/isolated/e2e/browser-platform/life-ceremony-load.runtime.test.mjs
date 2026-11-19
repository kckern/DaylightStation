import { expect, test } from '@playwright/test';

test.use({ serviceWorkers: 'block' });

async function installCeremony(page, { holdRetry = false, missingPlan = false } = {}) {
  const members = ['amy', 'bob'].map(username => ({ username, displayName: username.toUpperCase() }));
  const requests = [];
  await page.routeWebSocket('**/*', () => {});
  await page.route('**/api/**', route => {
    const request = route.request();
    const { pathname, searchParams } = new URL(request.url());
    const username = searchParams.get('username');
    if (pathname.endsWith('/supervision/bootstrap')) return route.fulfill({ json: { enabled: false } });
    if (pathname.endsWith('/life/users')) return route.fulfill({ json: { users: members } });
    if (pathname.endsWith('/life/user')) return route.fulfill({ json: members.find(member => member.username === username) || members[0] });
    if (pathname.includes('/plan/ceremony/')) {
      requests.push({ method: request.method(), username });
      if (missingPlan) return route.fulfill({ status: 409, json: { error: 'Plan required', code: 'NO_PLAN' } });
      if (requests.length === 1) return route.fulfill({ status: 503, json: { error: 'Ceremony server restarting' } });
      if (holdRetry && username === 'amy') return;
      return route.fulfill({ json: { periodId: 'fixture', activeGoals: [{ id: 'walk', name: username + ' walking goal' }] } });
    }
    return route.fulfill({ json: {} });
  });
  await page.goto('/life/ceremony/unit_intention');
  await expect(page.getByText(missingPlan ? "You don't have a life plan yet" : 'Ceremony server restarting')).toBeVisible();
  return requests;
}

test('Life retries the selected member’s ceremony content without submitting a completion', async ({ page }) => {
  const requests = await installCeremony(page);
  await page.getByRole('button', { name: 'Retry' }).click();
  await expect(page.getByText('amy walking goal')).toBeVisible();
  expect(requests).toEqual([{ method: 'GET', username: 'amy' }, { method: 'GET', username: 'amy' }]);
});

test('switching members retires a held ceremony retry and opens the new member’s content', async ({ page }) => {
  const requests = await installCeremony(page, { holdRetry: true });
  const retry = page.waitForRequest(request => request.url().includes('/ceremony/unit_intention?username=amy'));
  await page.getByRole('button', { name: 'Retry' }).click();
  const held = await retry;
  const retired = page.waitForEvent('requestfailed', request => request === held);
  await page.getByRole('textbox', { name: 'Switch household member' }).click();
  await page.getByRole('option', { name: 'BOB', exact: true }).click();
  await retired;
  await expect(page.getByText('bob walking goal')).toBeVisible();
  expect(requests).toEqual([
    { method: 'GET', username: 'amy' }, { method: 'GET', username: 'amy' }, { method: 'GET', username: 'bob' },
  ]);
});

test('Life Ceremony recovery links to Plan and Coach without submitting', async ({ page }) => {
  const requests = await installCeremony(page, { missingPlan: true });
  const plan = page.getByRole('link', { name: 'See the plan page', exact: true });
  const coach = page.getByRole('link', { name: 'Talk to your coach', exact: true });
  await expect(plan).toHaveAttribute('href', '/life/plan');
  await expect(coach).toHaveAttribute('href', '/life/coach');
  await plan.press('Enter');
  await expect(page).toHaveURL('/life/plan');
  await page.goBack();
  await coach.press('Enter');
  await expect(page).toHaveURL('/life/coach');
  expect(requests.length).toBeGreaterThan(0);
  expect(requests.every(request => request.method === 'GET')).toBe(true);
});
