import { expect, test } from '@playwright/test';
import { installHealthFixtures } from '../../../live/flow/health/healthFixtures.mjs';

test.use({ serviceWorkers: 'block', viewport: { width: 390, height: 650 }, timezoneId: 'UTC' });

const date = '2026-11-22';
const cleanupApi = '**/api/v1/health/nutrition/cleanup';

async function setup(page, items = []) {
  await page.clock.setFixedTime(new Date(date + 'T18:00:00Z'));
  await page.routeWebSocket('**/*', () => {});
  await installHealthFixtures(page, { items });
  await page.route('**/supervision/bootstrap', route => route.fulfill({ json: { enabled: false } }));
  await page.route(cleanupApi, route => route.fulfill({ json: {
    settings: { enabled: true, model: 'Fixture model' },
    options: { models: ['Fixture model'], triggers: [], permissions: [], minGapMinutes: [0] },
    questions: [], runs: [],
  } }));
  await page.route(cleanupApi + '/journal*', route => route.fulfill({ json: { rows: [], total: 0 } }));
  await page.route(cleanupApi + '/history*', route => route.fulfill({ json: { records: [], total: 0 } }));
}

async function settleScroll(main, position) {
  return main.evaluate(async (node, value) => {
    node.scrollTop = value;
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    return node.scrollTop;
  }, position);
}

test('Health Settings and Nutrition auditor keep separate frame scroll positions on phones', async ({ page }) => {
  await setup(page);
  await page.goto('/health/settings');
  const main = page.getByRole('main');
  const scroll = () => main.evaluate(node => node.scrollTop);
  const openAuditor = main.getByRole('button', { name: 'Open auditor', exact: true });
  await expect(openAuditor).toBeVisible();
  const settingsPosition = await settleScroll(main, 110);
  expect(settingsPosition).toBeGreaterThan(50);
  await expect(openAuditor).toBeInViewport();
  await openAuditor.click();
  await expect(main.getByRole('heading', { name: 'Nutrition auditor', exact: true })).toBeVisible();
  await expect.poll(scroll).toBe(0);

  const auditorPosition = await settleScroll(main, 550);
  expect(auditorPosition).toBeGreaterThan(settingsPosition + 100);
  await page.goBack();
  await expect(openAuditor).toBeVisible();
  await expect.poll(scroll).toBe(settingsPosition);
  await page.goForward();
  await expect(main.getByRole('heading', { name: 'Nutrition auditor', exact: true })).toBeVisible();
  await expect.poll(scroll).toBe(auditorPosition);
});

test('Health restores the mounted Today log and draft after visiting Settings', async ({ page }) => {
  const items = Array.from({ length: 28 }, (_, index) => ({
    uuid: 'food-' + index, name: 'Fixture food ' + index, mealTime: 'evening', calories: 120, grams: 100, date,
  }));
  await setup(page, items);
  let returning = false;
  let waitingRead = false;
  const resumeRead = Promise.withResolvers();
  await page.route('**/api/v1/health/day?date=' + date, async route => {
    if (returning) {
      waitingRead = true;
      await resumeRead.promise;
    }
    await route.fallback();
  });
  await page.goto('/health');
  const main = page.getByRole('main');
  const scroll = () => main.evaluate(node => node.scrollTop);
  const draft = main.getByRole('textbox', { name: 'Log food or change this day' });
  await draft.fill('unsubmitted breakfast');
  await expect(main.getByText('Fixture food 27', { exact: true })).toBeAttached();
  const todayPosition = await settleScroll(main, 550);
  expect(todayPosition).toBe(550);
  await page.getByRole('button', { name: 'Health settings', exact: true }).click();
  await expect(main.getByRole('heading', { name: 'Food log display', exact: true })).toBeVisible();
  await expect.poll(scroll).toBe(0);
  returning = true;
  try {
    await page.getByRole('link', { name: 'Today', exact: true }).click();
    await expect.poll(() => waitingRead).toBe(true);
    await expect(draft).toHaveValue('unsubmitted breakfast');
    await expect(main.getByText('Fixture food 27', { exact: true })).toBeAttached();
    await expect.poll(scroll).toBe(todayPosition);
  } finally {
    resumeRead.resolve();
  }
});
