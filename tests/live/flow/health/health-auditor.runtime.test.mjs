/**
 * /health/auditor end to end against a mocked API: Settings → auditor page,
 * header, run timeline, run detail, a permission toggle (PATCH body and the
 * change log it produces), and the Health AI usage card.
 *
 * Every auditor and AI usage endpoint the page touches is answered here, and
 * installHealthFixtures answers the rest of /api, so the run makes no request
 * to a real backend. Any write other than the one settings PATCH fails the test.
 */
import { test, expect } from '@playwright/test';
import { installHealthFixtures } from './healthFixtures.mjs';

const RUN_AT = '2026-09-24T17:42:00.000Z';
const PERMISSION_KINDS = ['naming', 'identification', 'mealPlacement', 'grouping', 'artwork', 'portion', 'nutrients', 'estimates', 'completeCaptures', 'questions'];
const TRIGGER_KINDS = ['captures', 'reviews', 'stabilization', 'scaleReconcile', 'artwork', 'dayRollover', 'edits', 'dailySweep'];

function initialStatus() {
  return {
    version: 12, settingsVersion: 3, nextEligibleAt: null, questions: [],
    settings: { enabled: true, dryRun: false, telegram: false, model: 'gpt-4.1-mini', dailyCapUsd: 1, minGapMinutes: 15,
      triggers: Object.fromEntries(TRIGGER_KINDS.map(kind => [kind, true])),
      permissions: Object.fromEntries(PERMISSION_KINDS.map(kind => [kind, true])) },
    runs: [{ id: 'audit_fixture', status: 'completed', dryRun: false, model: 'gpt-4.1-mini', trigger: ['captures'],
      createdAt: RUN_AT, completedAt: '2026-09-24T17:42:41.000Z', summary: 'Corrected the rice portion from the scale reading.', outcomes: [] }],
  };
}

const outcome = { status: 'applied', operationId: 'audit_fixture_0', affectedIds: ['rice'], reason: 'The scale read 150 g', mode: 'verified',
  changes: [{ id: 'rice', name: 'Rice', field: 'grams', from: 100, to: 150 }] };
const journalRow = { runId: 'audit_fixture', at: RUN_AT, completedAt: '2026-09-24T17:42:41.000Z', status: 'completed', trigger: ['captures'],
  model: 'gpt-4.1-mini', usage: { input: 12000, cached: 4000, output: 800 }, costUsd: 0.0123, turnId: null, toolCalls: [],
  outcomes: [outcome], suppressedQuestions: [], questions: [], summary: 'Corrected the rice portion from the scale reading.',
  dryRun: false, manual: false, overCap: false };
const journalEntry = { ...journalRow, transcript: null, transcriptExpired: false };

const days = Array.from({ length: 30 }, (_, i) => ({ date: new Date(Date.parse('2026-08-27T12:00:00Z') + i * 86400000).toISOString().slice(0, 10),
  costUsd: i === 28 ? 0.0123 : 0, runs: i === 28 ? 1 : 0, changed: i === 28 ? 1 : 0 }));
const spend = { days, today: 0.0123, week: 0.0123, month: 0.0123,
  byTrigger: [{ trigger: 'captures', runs: 1, costUsd: 0.0123, avgUsd: 0.0123 }],
  byModel: [{ model: 'gpt-4.1-mini', runs: 1, costUsd: 0.0123, avgUsd: 0.0123, tokens: { input: 12000, cached: 4000, output: 800 } }],
  capUsd: 1, cappedToday: false, ledgerTodayUsd: 0.12 };

const aiUsage = { range: { from: days[0].date, to: days.at(-1).date, days: 30 }, today: 0.12, week: 0.3, month: 0.45,
  byFeature: [
    { feature: 'auditor', calls: 9, costUsd: 0.31, avgUsd: 0.0344, unpriced: 0 },
    { feature: 'voice-log', calls: 14, costUsd: 0.14, avgUsd: 0.01, unpriced: 0 },
  ],
  days: days.map((day, i) => ({ date: day.date, total: i === 28 ? 0.12 : 0, byFeature: i === 28 ? { auditor: 0.1, 'voice-log': 0.02 } : {} })),
  beforeTracking: null };

/** Mocks every auditor and AI usage endpoint; returns what the page sent. */
async function installAuditorApi(page) {
  const api = { status: initialStatus(), log: [], patches: [], unexpected: [] };
  await page.route('**/api/v1/health/nutrition/cleanup**', async route => {
    const request = route.request(), method = request.method();
    const path = new URL(request.url()).pathname.replace(/^.*\/nutrition\/cleanup/, '');
    if (method === 'PATCH' && path === '/settings') {
      const body = request.postDataJSON();
      api.patches.push(body);
      if (body.expectedSettingsVersion !== api.status.settingsVersion) return route.fulfill({ status: 409, json: { error: 'Settings changed. Reload first.' } });
      const at = new Date().toISOString();
      for (const kind of ['permissions', 'triggers']) for (const [key, on] of Object.entries(body[kind] || {})) {
        api.log.unshift({ at, actor: 'user', field: `${kind}.${key}`, from: api.status.settings[kind][key], to: on });
        api.status.settings[kind] = { ...api.status.settings[kind], [key]: on };
      }
      api.status = { ...api.status, version: api.status.version + 1, settingsVersion: api.status.settingsVersion + 1 };
      return route.fulfill({ json: api.status });
    }
    if (method !== 'GET') {
      api.unexpected.push({ method, path });
      return route.fulfill({ status: 500, json: { error: 'Unowned auditor mutation' } });
    }
    if (path === '') return route.fulfill({ json: api.status });
    if (path === '/journal') return route.fulfill({ json: { rows: [journalRow], total: 1 } });
    if (path === '/journal/audit_fixture') return route.fulfill({ json: journalEntry });
    if (path === '/spend') return route.fulfill({ json: spend });
    if (path === '/settings/log') return route.fulfill({ json: { entries: api.log } });
    if (path === '/history') return route.fulfill({ json: { records: [], total: 0 } });
    api.unexpected.push({ method, path });
    return route.fulfill({ status: 404, json: { error: 'Unmocked auditor endpoint' } });
  });
  await page.route('**/api/v1/health/ai-usage**', route => route.fulfill({ json: aiUsage }));
  return api;
}

for (const width of [1440, 390]) test(`auditor page: header, run detail, permission change, AI usage at ${width}px`, async ({ page }, testInfo) => {
  await page.setViewportSize({ width, height: 1000 });
  const fixture = await installHealthFixtures(page, { items: [] });
  const api = await installAuditorApi(page);

  await page.goto('/health/settings');
  await expect(page.getByRole('heading', { name: 'Nutrition cleanup', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Open auditor', exact: true }).click();
  await expect(page).toHaveURL(/\/health\/auditor/);

  // Header: state, model, spend against the cap.
  const header = page.locator('section.ds-card', { has: page.getByRole('heading', { name: 'Nutrition auditor', exact: true }) });
  await expect(header).toBeVisible();
  await expect(header.getByText('On', { exact: true })).toBeVisible();
  await expect(header.getByText('gpt-4.1-mini', { exact: true })).toBeVisible();
  await expect(header).toContainText('$0.12 of $1.00 today');
  await expect(header).toContainText('(includes failed runs)');

  // Timeline row from the journal fixture, then its detail.
  const row = page.locator('.health-auditor-run', { hasText: 'Rice · grams 100 → 150' });
  await expect(row).toBeVisible();
  await expect(row).toContainText('New food captured');
  await expect(row).toContainText('$0.0123');
  await row.click();
  const detail = page.getByRole('dialog', { name: /^Run at / });
  await expect(detail).toBeVisible();
  await expect(detail.getByText('Why it ran', { exact: true })).toBeVisible();
  await expect(detail.getByText('Started automatically', { exact: true })).toBeVisible();
  await expect(detail.getByRole('columnheader', { name: 'Before', exact: true })).toBeVisible();
  const change = detail.getByRole('row', { name: /Rice · grams/ });
  await expect(change).toContainText('100');
  await expect(change).toContainText('150');
  await expect(detail.getByRole('button', { name: 'Undo this change', exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath(`auditor-run-detail-${width}.png`), fullPage: true });
  await detail.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(detail).toHaveCount(0);

  // Switch off "Nutrient values": a versioned PATCH, then the change log shows it.
  const nutrients = page.getByLabel('Nutrient values', { exact: true });
  await expect(nutrients).toBeChecked();
  await expect(page.getByText('Change nutrient values', { exact: true })).toBeVisible();
  await page.getByText('Nutrient values', { exact: true }).click();
  await expect(nutrients).not.toBeChecked();
  await expect.poll(() => api.patches.length).toBe(1);
  expect(api.patches).toEqual([{ expectedSettingsVersion: 3, permissions: { nutrients: false } }]);
  const changes = page.locator('section.ds-card', { has: page.getByRole('heading', { name: 'Settings changes', exact: true }) });
  await expect(changes.getByText(/^Nutrient values permission: On → Off · /)).toBeVisible();

  // Health AI usage card: totals and a feature row.
  const usage = page.locator('#ai-usage');
  await expect(usage.getByRole('heading', { name: 'AI usage', exact: true })).toBeVisible();
  const auditorRow = usage.getByRole('table', { name: 'Health AI cost by feature' }).getByRole('row', { name: /Nutrition auditor/ });
  await expect(auditorRow).toContainText('9');
  await expect(auditorRow).toContainText('$0.31');
  await expect(usage.getByRole('row', { name: /Voice logging/ })).toBeVisible();

  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath(`auditor-page-${width}.png`), fullPage: true });
  expect(api.unexpected).toEqual([]);
  expect(fixture.unexpected).toEqual([]);
});
