import { expect, test } from '@playwright/test';

const cleanup = '/api/v1/health/nutrition/cleanup';
const journal = cleanup + '/journal';
const moreRuns = journal + '?changed=1&offset=50';
const spend = cleanup + '/spend?days=30';
const log = cleanup + '/settings/log';
const history = cleanup + '/history?offset=0';
const aiUsage = '/api/v1/health/ai-usage?days=30';
const artwork = '/api/v1/health/nutrition/artwork-queue';
const at = '2026-11-20T00:00:00.000Z';
const detail = journal + '/first-run?at=' + encodeURIComponent(at);
const firstRow = { runId: 'first-run', at, model: 'First fixture run', costUsd: 2 };
const longTimeline = { rows: Array.from({ length: 12 }, (_, i) => ({ ...firstRow, runId: 'run-' + i })), total: 12 };
const status = {
  settingsVersion: 3, settings: { enabled: false, model: 'Fixture model', minGapMinutes: 0 },
  options: { models: ['Fixture model'], minGapMinutes: [0, 15, 60, 120] }, questions: [], runs: [],
};
const usage = {
  today: 0.2, week: 0.2, month: 0.2,
  byFeature: [{ feature: 'photo-log', calls: 1, costUsd: 0.2, avgUsd: 0.2 }],
  days: [{ date: '2026-11-20', total: 0.2, byFeature: { 'photo-log': 0.2 } }],
};
const emptyUsage = { byFeature: [] };

function retryFor(scope, label) {
  return scope.getByRole('alert').filter({ hasText: label + ' failed to load' })
    .getByRole('button', { name: 'Retry', exact: true });
}

async function mountWithFailedRead(page, endpoint, { path = '/health/auditor', responses = {} } = {}) {
  let armed = false;
  let pending;
  let recovered;
  const calls = [];
  const defaults = {
    [cleanup]: status, [journal]: { rows: [], total: 0 }, [spend]: { days: [] },
    [history]: { records: [], total: 0 }, [log]: { entries: [] },
    '/api/v1/health/context': { userId: 'fixture' },
  };
  await page.routeWebSocket('**/*', () => {});
  await page.route('**/api/**', async route => {
    const request = route.request();
    const { pathname, search } = new URL(request.url());
    const key = pathname + search;
    if (key === endpoint || pathname.startsWith(cleanup)) calls.push([request.method(), key]);
    if (key === endpoint) {
      if (recovered) return route.fulfill({ json: recovered });
      if (!armed) return route.fulfill({ status: 409, json: { error: 'Fixture unavailable' } });
      pending = route;
      return;
    }
    const payload = await (responses[key] ?? defaults[key] ?? { enabled: false });
    return route.fulfill({ json: payload });
  });
  await page.goto(path);

  return {
    async start(retry) {
      await expect(retry).toBeEnabled();
      await retry.scrollIntoViewIfNeeded();
      await retry.focus();
      await expect(retry).toBeFocused();
      expect(calls.filter(([, key]) => key === endpoint)).toEqual([['GET', endpoint]]);
      const before = calls.length;
      armed = true;
      await page.keyboard.press('Enter');
      await expect.poll(() => Boolean(pending)).toBe(true);
      await expect(retry).toHaveCount(0);
      expect(calls.slice(before).filter(([, key]) => key === endpoint)).toEqual([['GET', endpoint]]);
    },
    async finish(payload = defaults[endpoint]) {
      recovered = payload;
      await pending.fulfill({ json: payload });
      expect(calls.filter(([, key]) => key === endpoint)).toEqual([['GET', endpoint], ['GET', endpoint]]);
      expect(calls.every(([method]) => method === 'GET')).toBe(true);
    },
  };
}

async function expectPending(region) {
  await expect(region).toBeFocused();
  await expect(region).toHaveAttribute('aria-busy', 'true');
  await expect(region).toBeInViewport();
}

for (const width of [390, 1440]) {
  test.describe(`Auditor reads at ${width}px`, () => {
    test.use({ viewport: { width, height: 850 }, serviceWorkers: 'block' });

    for (const section of ['Auditor status', 'Auditor settings']) {
      test(`${section} keeps the initiating section focused through the shared cleanup GET`, async ({ page }) => {
        const read = await mountWithFailedRead(page, cleanup);
        const region = page.getByRole('region', { name: section, exact: true });
        const sibling = section === 'Auditor status' ? 'Auditor settings' : 'Auditor status';
        await expect(retryFor(page, sibling)).toBeVisible();
        await read.start(retryFor(page, section));
        await expectPending(region);
        await expect(retryFor(page, sibling)).toHaveCount(0);
        await expect(page.getByText('No runs in this range', { exact: true })).toBeVisible();
        await expect(page.getByRole('link', { name: 'Today', exact: true })).toBeEnabled();
        await read.finish();
        await expect(region.getByRole('heading', { name: section === 'Auditor status' ? 'Nutrition auditor' : section, exact: true })).toBeVisible();
        await expect(region).not.toHaveAttribute('aria-busy', 'true');
        await expect(region).toBeFocused();
      });
    }

    test('Cleanup settings Retry leaves food log display controls available', async ({ page }) => {
      const read = await mountWithFailedRead(page, cleanup, { path: '/health/settings' });
      const region = page.getByRole('region', { name: 'Cleanup settings', exact: true });
      const display = page.getByRole('radio', { name: 'Before food name', exact: true });
      await read.start(retryFor(page, 'Cleanup settings'));
      await expectPending(region);
      await expect(display).toBeEnabled();
      await display.focus();
      await read.finish();
      await expect(region.getByRole('button', { name: 'Open auditor', exact: true })).toBeEnabled();
      await expect(region).not.toHaveAttribute('aria-busy', 'true');
      await expect(display).toBeFocused();
    });

    test('Run timeline Retry can settle to its existing empty result', async ({ page }) => {
      const read = await mountWithFailedRead(page, journal);
      const region = page.getByRole('region', { name: 'Run timeline', exact: true });
      await read.start(retryFor(page, 'Run timeline'));
      await expectPending(region);
      await expect(page.getByRole('textbox', { name: 'Min cost ($)', exact: true })).toBeEnabled();
      await read.finish();
      await expect(region.getByText('No runs in this range', { exact: true })).toBeVisible();
      await expect(region).not.toHaveAttribute('aria-busy', 'true');
      await expect(region).toBeFocused();
    });

    test('Run timeline Retry keeps a filtered later page local when it has no visible rows', async ({ page }) => {
      const read = await mountWithFailedRead(page, moreRuns, {
        responses: { [journal + '?changed=1']: { rows: [firstRow], total: 51 } },
      });
      const changedFilter = page.getByRole('switch', { name: 'Changed something', exact: true });
      const costFilter = page.getByRole('textbox', { name: 'Min cost ($)', exact: true });
      await changedFilter.press('Space');
      await costFilter.fill('1');
      await page.getByRole('button', { name: 'Load more', exact: true }).click();
      const region = page.getByRole('region', { name: 'Run timeline, page 2', exact: true });
      const first = page.getByRole('button', { name: /First fixture run/ });
      await read.start(retryFor(page, 'Run timeline'));
      await expectPending(region);
      await expect(first).toBeVisible();
      await expect(changedFilter).toBeChecked();
      await expect(costFilter).toHaveValue('1');
      await read.finish({ rows: [{ ...firstRow, runId: 'second-run', model: 'Filtered fixture run', costUsd: 0.1 }], total: 51 });
      await expect(region.getByRole('status')).toHaveText('No matching runs on this page.');
      await expect(region).not.toHaveAttribute('aria-busy', 'true');
      await expect(region).toBeInViewport();
      await expect(region).toBeFocused();
      await expect(page.getByRole('button', { name: /Filtered fixture run/ })).toHaveCount(0);
      await costFilter.focus();
      await expect(region).toHaveCount(0);
      await expect(first).toBeVisible();
    });

    test('Settings changes Retry stays in its card on empty recovery', async ({ page }) => {
      const read = await mountWithFailedRead(page, log);
      const region = page.getByRole('region', { name: 'Settings changes', exact: true });
      await read.start(retryFor(page, 'Settings changes'));
      await expectPending(region);
      await expect(page.getByRole('button', { name: 'Run cleanup now', exact: true })).toBeEnabled();
      await read.finish();
      await expect(region.getByText('No settings changes yet.', { exact: true })).toBeVisible();
      await expect(region).not.toHaveAttribute('aria-busy', 'true');
      await expect(region).toBeFocused();
    });

    for (const [index, section] of ['Auditor spend summary', 'Auditor spend'].entries()) {
      test(`${section} keeps focus at the originating spend control`, async ({ page }) => {
        const read = await mountWithFailedRead(page, spend);
        const region = page.getByRole('region', { name: section, exact: true });
        await expect(retryFor(page, 'Auditor spend')).toHaveCount(2);
        await read.start(retryFor(page, 'Auditor spend').nth(index));
        await expectPending(region);
        await expect(retryFor(page, 'Auditor spend')).toHaveCount(0);
        await expect(page.getByRole('heading', { name: 'Nutrition auditor', exact: true })).toBeVisible();
        await expect(page.getByText('Next eligible', { exact: true })).toBeVisible();
        await expect(region.getByText('Next eligible', { exact: true })).toHaveCount(0);
        await read.finish({ days: [], week: 1, month: 2 });
        await expect(region.getByText(index === 0 ? 'Last 7 days' : 'No auditor runs in the last 30 days', { exact: true })).toBeVisible();
        await expect(region).not.toHaveAttribute('aria-busy', 'true');
        await expect(region).toBeFocused();
      });
    }

    test('Repair history Retry stays inside the open disclosure', async ({ page }) => {
      const read = await mountWithFailedRead(page, history);
      const summary = page.getByText('View repairs (—)', { exact: true });
      await summary.click();
      const region = page.getByRole('region', { name: 'Repair history', exact: true });
      await read.start(retryFor(page, 'This section'));
      await expectPending(region);
      await expect(summary).toBeVisible();
      await read.finish();
      await expect(region.getByText('No repairs have been made.', { exact: true })).toBeVisible();
      await expect(region).not.toHaveAttribute('aria-busy', 'true');
      await expect(region).toBeFocused();
    });

    test('Run detail Retry keeps the open sheet and its close control available', async ({ page }) => {
      const read = await mountWithFailedRead(page, detail, { responses: { [journal]: { rows: [firstRow], total: 1 } } });
      await page.getByRole('button', { name: /First fixture run/ }).click();
      const dialog = page.getByRole('dialog');
      const region = dialog.getByRole('region', { name: 'Run detail', exact: true });
      await read.start(retryFor(dialog, 'Run detail'));
      await expectPending(region);
      await expect(dialog.getByRole('button', { name: 'Close', exact: true })).toBeEnabled();
      await read.finish({ ...firstRow, summary: 'Recovered fixture run detail' });
      await expect(region.getByText('Recovered fixture run detail', { exact: true })).toBeVisible();
      await expect(region).not.toHaveAttribute('aria-busy', 'true');
      await expect(region).toBeFocused();
    });

    test('AI usage Retry keeps focus in the full card after empty recovery', async ({ page }) => {
      const read = await mountWithFailedRead(page, aiUsage, { path: '/health/auditor#ai-usage' });
      const region = page.getByRole('region', { name: 'AI usage', exact: true });
      await read.start(retryFor(page, 'AI usage'));
      await expectPending(region);
      await expect(page.getByRole('heading', { name: 'Runs', exact: true })).toBeVisible();
      await read.finish(emptyUsage);
      await expect(region.getByText('No Health AI use in the last 30 days', { exact: true })).toBeVisible();
      await expect(region).not.toHaveAttribute('aria-busy', 'true');
      await expect(region).toBeFocused();
      await expect(region).toBeInViewport();
    });

    test('AI usage Retry restores the compact card and See all reaches the anchored chart', async ({ page }) => {
      const timeline = Promise.withResolvers();
      const read = await mountWithFailedRead(page, aiUsage, { path: '/health/settings', responses: { [journal]: timeline.promise } });
      const region = page.getByRole('region', { name: 'AI usage', exact: true });
      await read.start(retryFor(page, 'AI usage'));
      await expectPending(region);
      await expect(page.getByRole('heading', { name: 'Food log display', exact: true })).toBeVisible();
      await read.finish(usage);
      await expect(region.getByText('Photo logging', { exact: true })).toBeVisible();
      await expect(region).not.toHaveAttribute('aria-busy', 'true');
      await expect(region).toBeFocused();
      await page.getByRole('link', { name: 'See all', exact: true }).press('Enter');
      await expect(page).toHaveURL(/\/health\/auditor#ai-usage$/);
      const card = page.getByRole('region', { name: 'AI usage', exact: true });
      await expect(card.getByRole('img', { name: /Daily Health AI cost/ })).toBeVisible();
      await expect(page.getByRole('button', { name: /First fixture run/ })).toHaveCount(0);
      timeline.resolve(longTimeline);
      await expect(page.getByRole('button', { name: /First fixture run/ })).toHaveCount(12);
      await expect(page.getByRole('heading', { name: 'AI usage', exact: true })).toBeInViewport();
    });

    test('Artwork queue Retry keeps focus in the result and leaves its description available', async ({ page }) => {
      const read = await mountWithFailedRead(page, artwork, { path: '/health/settings' });
      const region = page.getByRole('region', { name: 'Artwork queue', exact: true });
      const description = 'Food whose icon or photo could not be shown.';
      await read.start(retryFor(page, 'Artwork queue'));
      await expectPending(region);
      await expect(page.getByText(description)).toBeVisible();
      await expect(region.getByText(description)).toHaveCount(0);
      await read.finish({ open: [], recentlyResolved: [] });
      await expect(region.getByText('Nothing waiting — every food has artwork.', { exact: true })).toBeVisible();
      await expect(region).not.toHaveAttribute('aria-busy', 'true');
      await expect(region).toBeFocused();
    });
  });
}

test('Anchored AI usage Retry preserves the viewport after focus moves to a timeline filter', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 650 });
  const read = await mountWithFailedRead(page, aiUsage, {
    path: '/health/auditor#ai-usage',
    responses: { [journal]: longTimeline },
  });
  await read.start(retryFor(page, 'AI usage'));
  const filter = page.getByRole('textbox', { name: 'Min cost ($)', exact: true });
  await filter.scrollIntoViewIfNeeded();
  await filter.focus();
  await expect(filter).toBeInViewport();
  await read.finish(emptyUsage);
  await expect(page.getByText('No Health AI use in the last 30 days', { exact: true })).toBeAttached();
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await expect(filter).toBeFocused();
  await expect(filter).toBeInViewport();
});

for (const control of ['Min cost ($)', 'Health settings']) {
  test(`Pending AI usage navigation preserves the viewport after focus moves to ${control}`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 650 });
    const timeline = Promise.withResolvers();
    await mountWithFailedRead(page, null, {
      path: '/health/auditor#ai-usage',
      responses: { [journal]: timeline.promise, [aiUsage]: usage },
    });
    const card = page.getByRole('region', { name: 'AI usage', exact: true });
    await expect(card.getByRole('img', { name: /Daily Health AI cost/ })).toBeVisible();
    const filter = page.getByRole('textbox', { name: 'Min cost ($)', exact: true });
    const focusTarget = control === 'Health settings' ? page.getByRole('button', { name: control, exact: true }) : filter;
    await filter.scrollIntoViewIfNeeded();
    await focusTarget.focus();
    await expect(filter).toBeInViewport();
    timeline.resolve(longTimeline);
    await expect(page.getByRole('button', { name: /First fixture run/ })).toHaveCount(12);
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await expect(focusTarget).toBeFocused();
    await expect(filter).toBeInViewport();
  });
}
