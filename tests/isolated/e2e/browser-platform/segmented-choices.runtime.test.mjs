import { expect, test } from '@playwright/test';

test.use({ serviceWorkers: 'block', hasTouch: true, viewport: { width: 390, height: 850 } });

const cleanup = '/api/v1/health/nutrition/cleanup';
const auditor = {
  settingsVersion: 3,
  settings: { enabled: false, model: 'Fixture model', minGapMinutes: 0 },
  options: { models: ['Fixture model'], minGapMinutes: [0, 15, 60, 120] },
  questions: [], runs: [],
};
const review = {
  title: 'Fixture film', certification: { level: 'machine' }, audit: { ok: true, fresh: true, failures: [] },
  rows: [{
    id: 'cue:w1', peekId: 'w1', members: ['w1'], kind: 'words', group: 'profanity', label: 'Fixture cue', modality: 'said',
    in: 10, out: 10.5, effect: 'bleep', unsure: [], reviewed: null, verdict: null,
  }],
  reviewed: 0, total: 1, job: null, signOff: { ready: false, missing: [], parent: null },
};

async function installChoices(page, baseURL) {
  const origin = new URL(baseURL).origin;
  const writes = [];
  await page.context().route('**/*', route => (
    new URL(route.request().url()).origin === origin ? route.fallback() : route.abort()
  ));
  await page.routeWebSocket('**/*', () => {});
  await page.route('**/api/**', route => {
    const request = route.request();
    const { pathname } = new URL(request.url());
    if (request.method() === 'PATCH' && pathname === cleanup + '/settings') {
      const patch = request.postDataJSON();
      writes.push(patch);
      return route.fulfill({ json: {
        ...auditor, settingsVersion: 4, settings: { ...auditor.settings, minGapMinutes: patch.minGapMinutes },
      } });
    }
    let json = {};
    if (pathname.endsWith('/supervision/bootstrap')) json = { enabled: false };
    if (pathname.endsWith('/health/context')) json = { userId: 'fixture' };
    if (pathname.endsWith('/health/nutrition/templates')) json = { templates: [{
      id: 'lunch', name: 'Fixture meal', components: [
        { name: 'Rice', grams: 100, role: 'core' }, { name: 'Beans', grams: 40, role: 'variant' },
      ],
    }] };
    if (pathname.endsWith('/health/goals')) json = { goals: { targetWeightLbs: 170, watchMicros: [
      { key: 'sodium', direction: 'ceiling', limit: 2300 },
      { key: 'fiber', direction: 'floor', limit: 25 },
    ] } };
    if (pathname === cleanup) json = auditor;
    if (pathname === cleanup + '/journal') json = { rows: [], total: 0 };
    if (pathname === cleanup + '/history') json = { records: [], total: 0 };
    if (pathname.endsWith('/77/review')) json = review;
    return route.fulfill({ json });
  });
  return writes;
}

async function expectFullSegments(group) {
  await expect(group).toBeVisible();
  const sizes = await group.locator('label').evaluateAll(labels => labels.map(label => {
    const { width, height } = label.getBoundingClientRect();
    return Math.min(width, height);
  }));
  expect(sizes.length).toBeGreaterThan(1);
  for (const size of sizes) expect(Math.round(size * 100) / 100).toBeGreaterThanOrEqual(44);
}

test('Health Progress names each direction group and keeps native radio selection', async ({ page, baseURL }) => {
  await installChoices(page, baseURL);
  await page.goto('/health/progress');
  await page.getByRole('button', { name: 'Edit goals' }).press('Enter');
  const dialog = page.getByRole('dialog');
  const sodium = dialog.getByRole('radiogroup', { name: 'Sodium direction', exact: true });
  const fiber = dialog.getByRole('radiogroup', { name: 'Fiber direction', exact: true });

  await expectFullSegments(dialog.getByRole('radiogroup', { name: 'Sex for budget calculation' }));
  await expectFullSegments(sodium);
  await expectFullSegments(fiber);
  const reachSodium = sodium.getByRole('radio', { name: 'Reach', exact: true });
  const stayUnder = sodium.getByRole('radio', { name: 'Stay under', exact: true });
  const reachFiber = fiber.getByRole('radio', { name: 'Reach', exact: true });
  await expect(stayUnder).toBeChecked();
  await expect(reachFiber).toBeChecked();
  await stayUnder.press('ArrowRight');
  await expect(reachSodium).toBeChecked();
  await expect(reachSodium).toBeFocused();
  await expect(reachFiber).toBeChecked();
});

test('Health Auditor associates its visible label and accepts a full-size gap choice', async ({ page, baseURL }) => {
  const writes = await installChoices(page, baseURL);
  await page.goto('/health/auditor');
  const group = page.getByRole('radiogroup', { name: 'Minimum gap between automatic runs', exact: true });
  await expectFullSegments(group);
  await group.locator('label', { hasText: '15 min' }).tap({ position: { x: 2, y: 36 } });
  await expect(group.getByRole('radio', { name: '15 min', exact: true })).toBeChecked();
  await expect.poll(() => writes).toEqual([{ expectedSettingsVersion: 3, minGapMinutes: 15 }]);
});

test('Health Saved meals names the inclusion choices for each component', async ({ page, baseURL }) => {
  await installChoices(page, baseURL);
  await page.goto('/health');
  await page.getByRole('button', { name: 'Saved meals for Dinner', exact: true }).press('Enter');
  const dialog = page.getByRole('dialog', { name: 'Meals & templates' });
  await dialog.getByRole('button', { name: 'Edit Fixture meal', exact: true }).press('Enter');
  const rice = dialog.getByRole('radiogroup', { name: 'Rice meal inclusion', exact: true });
  const beans = dialog.getByRole('radiogroup', { name: 'Beans meal inclusion', exact: true });
  await expectFullSegments(rice);
  await expectFullSegments(beans);
  await expect(rice.getByRole('radio', { name: 'Always' })).toBeChecked();
  await expect(beans.getByRole('radio', { name: 'Optional' })).toBeChecked();
});

test('Admin Content Review uses the same full-size segmented targets', async ({ page, baseURL }) => {
  await installChoices(page, baseURL);
  await page.goto('/admin/content/filter/77');
  // The word ruling sits behind the part's effect menu (the Kind switch left the page in fa33bcb541).
  await page.getByRole('button', { name: /^Effect: .*Change it/ }).click();
  await page.getByRole('menuitem', { name: /^More for this word/ }).click();
  const group = page.getByRole('radiogroup', { name: 'This word in this film', exact: true });
  await expectFullSegments(group);
  const ruling = page.waitForRequest(request => request.method() === 'PUT' && /\/77\/words\//.test(request.url()));
  await group.locator('label', { hasText: 'Mute' }).tap({ position: { x: 2, y: 36 } });
  expect((await ruling).postDataJSON()).toEqual({ value: 'mute' });
});
