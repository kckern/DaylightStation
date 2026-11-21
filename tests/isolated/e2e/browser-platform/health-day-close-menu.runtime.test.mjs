import { expect, test } from '@playwright/test';
import { installHealthFixtures } from '../../../live/flow/health/healthFixtures.mjs';

test.use({ serviceWorkers: 'block', viewport: { width: 390, height: 850 } });

const date = '2026-09-24';
const dayQuery = `?date=${date}`;

async function installDayCloseFixtures(page) {
  await page.routeWebSocket('**/*', () => {});
  const fixture = await installHealthFixtures(page);
  const writes = [];
  let dayStatus = { today: date, status: null, minCalories: 1800, fastedMeals: [] };
  await page.route('**/supervision/bootstrap', route => route.fulfill({ json: { enabled: false } }));
  await page.route('**/health/day?date=*', route => route.fulfill({ json: {
    date: new URL(route.request().url()).searchParams.get('date'),
    items: [],
    budget: { budget: 2000, food: 0, remaining: 2000, exercise: 0, macros: {}, sessions: [] },
    dayStatus,
  } }));
  await page.route('**/health/nutrition/day-status', route => {
    const request = route.request();
    const body = request.postDataJSON();
    writes.push({ method: request.method(), body });
    dayStatus = { ...dayStatus, status: body.status };
    return route.fulfill({ json: dayStatus });
  });
  return { fixture, writes };
}

test('Day Close does not survive a history exit from retained Health Today', async ({ page }) => {
  const { fixture, writes } = await installDayCloseFixtures(page);
  const progressPath = '/health/progress' + dayQuery;
  await page.goto(progressPath);
  const progress = page.getByRole('link', { name: 'Progress', exact: true });
  await expect(progress).toHaveAttribute('aria-current', 'page');
  await page.getByRole('link', { name: 'Today', exact: true }).click();
  const closeDay = page.getByRole('button', { name: 'Close day. Close this day', exact: true });
  const doneLogging = page.getByRole('menuitem', { name: 'Done logging', exact: true });
  await closeDay.press('Enter');
  await expect(doneLogging).toBeVisible();

  await page.goBack();
  await expect(page).toHaveURL(progressPath);
  await expect(doneLogging).toBeHidden();
  await expect(closeDay).toBeHidden();
  await expect(progress).toHaveAttribute('aria-current', 'page');

  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+k' : 'Control+k');
  const coach = page.getByRole('dialog', { name: 'Health Coach', exact: true });
  await expect(coach.locator(':focus')).toHaveCount(1);
  await page.keyboard.press('Escape');
  await expect(coach).toBeHidden();
  await expect(progress).toHaveAttribute('aria-current', 'page');

  await page.goForward();
  await expect(closeDay).toHaveAttribute('aria-expanded', 'false');
  await expect(doneLogging).toBeHidden();
  await closeDay.press('Enter');
  await expect(doneLogging).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(doneLogging).toBeHidden();
  await expect(closeDay).toBeFocused();
  await expect(page).toHaveURL('/health' + dayQuery);
  expect(writes).toEqual([]);
  expect(fixture.unexpected).toEqual([]);
});

test('Selecting Done logging sends only the viewed day command', async ({ page }) => {
  const { fixture, writes } = await installDayCloseFixtures(page);
  await page.goto('/health' + dayQuery);
  const closeDay = page.getByRole('button', { name: 'Close day. Close this day', exact: true });
  const doneLogging = page.getByRole('menuitem', { name: 'Done logging', exact: true });
  await closeDay.click();
  await doneLogging.click();

  const reopen = page.getByRole('button', { name: 'Logging done. Change', exact: true });
  await expect(reopen).toBeVisible();
  await expect(reopen).toHaveAttribute('aria-expanded', 'false');
  await expect(page.getByRole('link', { name: 'Today', exact: true })).toHaveAttribute('aria-current', 'page');
  expect(writes).toEqual([{ method: 'POST', body: { date, status: 'done' } }]);
  expect(fixture.unexpected).toEqual([]);
});
