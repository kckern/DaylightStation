import { expect, test } from '@playwright/test';

test.use({ serviceWorkers: 'block' });

test('Life restores its Goals list after detail and clears scroll when the member changes', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 750 });
  await page.routeWebSocket('**/*', () => {});
  const members = ['amy', 'bob'].map(username => ({ username, displayName: username.toUpperCase() }));
  const bobRequested = Promise.withResolvers();
  const bobReady = Promise.withResolvers();
  await page.route('**/api/**', async route => {
    const { pathname, searchParams } = new URL(route.request().url());
    const user = searchParams.get('username') || 'amy';
    if (pathname.endsWith('/supervision/bootstrap')) return route.fulfill({ json: { enabled: false } });
    if (pathname === '/api/v1/life/users') return route.fulfill({ json: { users: members } });
    if (pathname === '/api/v1/life/user') return route.fulfill({ json: members.find(member => member.username === user) });
    if (pathname === '/api/v1/life/plan/goals') {
      if (user === 'bob') {
        bobRequested.resolve();
        await bobReady.promise;
      }
      const goals = Array.from({ length: 30 }, (_, index) => ({
        id: 'goal-' + index, name: user + ' goal ' + index, state: 'ready',
      }));
      return route.fulfill({ json: { goals } });
    }
    if (pathname === '/api/v1/life/plan/goals/goal-24') {
      return route.fulfill({ json: { id: 'goal-24', name: 'Goal details', state: 'ready' } });
    }
    return route.fulfill({ json: {} });
  });

  await page.goto('/life/plan/goals');
  const main = page.getByRole('main');
  const scroll = () => main.evaluate(node => node.scrollTop);
  const goal = main.getByText('amy goal 24', { exact: true });
  await goal.scrollIntoViewIfNeeded();
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const savedPosition = await scroll();
  expect(savedPosition).toBeGreaterThan(500);
  await goal.click();
  await expect(main.getByRole('heading', { name: 'Goal details' })).toBeVisible();
  await expect.poll(scroll).toBe(0);
  await page.goBack();
  await expect(goal).toBeAttached();
  await expect.poll(scroll, { timeout: 5_000 }).toBe(savedPosition);
  await expect(goal).toBeInViewport();

  const switcher = page.getByRole('textbox', { name: 'Switch household member' });
  await switcher.click();
  await page.getByRole('option', { name: 'BOB' }).click();
  try {
    await bobRequested.promise;
    await expect.poll(scroll).toBe(0);
  } finally {
    bobReady.resolve();
  }
  await expect(main.getByText('bob goal 0', { exact: true })).toBeVisible();
  await expect.poll(scroll).toBe(0);
  await switcher.click();
  await page.getByRole('option', { name: 'AMY' }).click();
  await expect(main.getByText('amy goal 0', { exact: true })).toBeVisible();
  await expect.poll(scroll).toBe(0);
});

test('Life waits for the returning log category to mount before restoring its position', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 650 });
  await page.routeWebSocket('**/*', () => {});
  const member = { username: 'amy', displayName: 'Amy' };
  const returning = Promise.withResolvers();
  const release = Promise.withResolvers();
  const days = Object.fromEntries(Array.from({ length: 20 }, (_, index) => [
    '2026-11-' + String(index + 1).padStart(2, '0'),
    { sources: { food: {} }, summaries: [{ text: 'Meal log ' + index }] },
  ]));
  let reads = 0;
  await page.route('**/api/**', async route => {
    const { pathname } = new URL(route.request().url());
    if (pathname.endsWith('/supervision/bootstrap')) return route.fulfill({ json: { enabled: false } });
    if (pathname === '/api/v1/life/users') return route.fulfill({ json: { users: [member] } });
    if (pathname === '/api/v1/life/user') return route.fulfill({ json: member });
    if (pathname === '/api/v1/life/log/amy/category/food') {
      if (++reads === 2) {
        returning.resolve();
        await release.promise;
      }
      return route.fulfill({ json: { days } });
    }
    return route.fulfill({ json: {} });
  });

  await page.goto('/life/log/category/food');
  const main = page.getByRole('main');
  const scroll = () => main.evaluate(node => node.scrollTop);
  const lastEntry = main.getByText('Meal log 0', { exact: true });
  await lastEntry.scrollIntoViewIfNeeded();
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const savedPosition = await scroll();
  expect(savedPosition).toBeGreaterThan(500);
  await page.getByRole('link', { name: 'Plan', exact: true }).click();
  await expect(page).toHaveURL(/\/life\/plan$/);
  await page.goBack();
  try {
    await returning.promise;
    await expect(lastEntry).toHaveCount(0);
    await expect.poll(scroll).toBe(0);
  } finally {
    release.resolve();
  }
  await expect(lastEntry).toBeAttached();
  await expect.poll(scroll).toBe(savedPosition);
  await expect(lastEntry).toBeInViewport();
});
