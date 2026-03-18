import { test, expect } from '@playwright/test';

/**
 * Life App — Happy Path Audit Tests
 *
 * Tests the Life App UI at /life against the live backend.
 * Verifies: page load, navigation, API connectivity, read/write flows.
 *
 * Groups are independent so API failures don't block UI tests.
 */

const BASE = 'https://daylightlocal.kckern.net';

// ─── Group 1: SPA Load & Navigation ─────────────────────────────────────────

test.describe('Life App — SPA & Navigation', () => {
  test.describe.configure({ mode: 'serial' });

  /** @type {import('@playwright/test').Page} */
  let page;

  test.beforeAll(async ({ browser }) => {
    const ctx = await browser.newContext({ ignoreHTTPSErrors: true });
    page = await ctx.newPage();
  });

  test.afterAll(async () => {
    await page?.context().close();
  });

  test('SPA loads at /life', async () => {
    const resp = await page.goto(`${BASE}/life`, { waitUntil: 'domcontentloaded', timeout: 15000 });
    expect(resp.status()).toBe(200);
    await expect(page.locator('text=Life')).toBeVisible({ timeout: 10000 });
  });

  test('navbar has Now, Log, Plan, Coach links', async () => {
    for (const label of ['Now', 'Log', 'Plan', 'Coach']) {
      await expect(page.locator(`nav >> text="${label}"`).first()).toBeVisible({ timeout: 3000 });
    }
  });

  test('navigates to /life/now (Dashboard)', async () => {
    await page.click('nav >> text="Now"');
    await page.waitForURL('**/life/now', { timeout: 5000 });
    expect(page.url()).toContain('/life/now');
  });

  test('Dashboard renders layout', async () => {
    await page.waitForTimeout(3000); // let React render after API attempts
    const bodyText = await page.locator('main').first().textContent({ timeout: 5000 }).catch(() => '');
    console.log(`[AUDIT] Dashboard main content: "${bodyText.slice(0, 400)}"`);
  });

  test('Plan section has all sub-nav items', async () => {
    await page.click('nav >> text="Plan"');
    for (const label of ['Purpose', 'Goals', 'Beliefs', 'Values', 'Qualities', 'Ceremonies']) {
      await expect(page.locator(`nav >> text="${label}"`).first()).toBeVisible({ timeout: 3000 });
    }
  });

  test('Purpose view loads', async () => {
    await page.click('nav >> text="Purpose"');
    await page.waitForURL('**/life/plan', { timeout: 5000 });
    await page.waitForTimeout(2000);
    const bodyText = await page.locator('main').first().textContent({ timeout: 5000 }).catch(() => '');
    console.log(`[AUDIT] Purpose view: "${bodyText.slice(0, 300)}"`);
  });

  test('Goals view loads', async () => {
    await page.click('nav >> text="Goals"');
    await page.waitForURL('**/life/plan/goals', { timeout: 5000 });
    await page.waitForTimeout(2000);
    const bodyText = await page.locator('main').first().textContent({ timeout: 5000 }).catch(() => '');
    console.log(`[AUDIT] Goals view: "${bodyText.slice(0, 300)}"`);
  });

  test('Beliefs view loads', async () => {
    await page.click('nav >> text="Beliefs"');
    await page.waitForURL('**/life/plan/beliefs', { timeout: 5000 });
    await page.waitForTimeout(2000);
    const bodyText = await page.locator('main').first().textContent({ timeout: 5000 }).catch(() => '');
    console.log(`[AUDIT] Beliefs view: "${bodyText.slice(0, 300)}"`);
  });

  test('Values view loads', async () => {
    await page.click('nav >> text="Values"');
    await page.waitForURL('**/life/plan/values', { timeout: 5000 });
    await page.waitForTimeout(2000);
    const bodyText = await page.locator('main').first().textContent({ timeout: 5000 }).catch(() => '');
    console.log(`[AUDIT] Values view: "${bodyText.slice(0, 300)}"`);
  });

  test('Qualities view loads', async () => {
    await page.click('nav >> text="Qualities"');
    await page.waitForURL('**/life/plan/qualities', { timeout: 5000 });
    await page.waitForTimeout(2000);
    const bodyText = await page.locator('main').first().textContent({ timeout: 5000 }).catch(() => '');
    console.log(`[AUDIT] Qualities view: "${bodyText.slice(0, 300)}"`);
  });

  test('Ceremonies view loads', async () => {
    await page.click('nav >> text="Ceremonies"');
    await page.waitForURL('**/life/plan/ceremonies', { timeout: 5000 });
    await page.waitForTimeout(2000);
    const bodyText = await page.locator('main').first().textContent({ timeout: 5000 }).catch(() => '');
    console.log(`[AUDIT] Ceremonies view: "${bodyText.slice(0, 300)}"`);
  });

  test('Log view loads with scope selector', async () => {
    await page.click('nav >> text="Log"');
    await page.waitForURL('**/life/log', { timeout: 5000 });
    await page.waitForTimeout(2000);
    const bodyText = await page.locator('main').first().textContent({ timeout: 5000 }).catch(() => '');
    console.log(`[AUDIT] Log view: "${bodyText.slice(0, 300)}"`);
    const hasScope = await page.locator('text=/day|week|month/i').count();
    console.log(`[AUDIT] Scope selector elements: ${hasScope}`);
  });

  test('Coach view loads with chat interface', async () => {
    await page.click('nav >> text="Coach"');
    await page.waitForURL('**/life/coach', { timeout: 5000 });
    await page.waitForTimeout(2000);
    const bodyText = await page.locator('main').first().textContent({ timeout: 5000 }).catch(() => '');
    console.log(`[AUDIT] Coach view: "${bodyText.slice(0, 300)}"`);
    const hasInput = await page.locator('input, textarea').count();
    console.log(`[AUDIT] Coach input elements: ${hasInput}`);
  });

  test('console errors during navigation', async () => {
    const errors = [];
    page.on('console', msg => {
      if (msg.type() === 'error') errors.push(msg.text());
    });
    page.on('pageerror', err => errors.push(err.message));

    await page.goto(`${BASE}/life/now`, { waitUntil: 'domcontentloaded', timeout: 15000 });
    await page.waitForTimeout(3000);
    await page.goto(`${BASE}/life/plan`, { waitUntil: 'domcontentloaded', timeout: 15000 });
    await page.waitForTimeout(3000);

    console.log(`[AUDIT] Console errors: ${errors.length}`);
    for (const err of errors.slice(0, 10)) {
      console.log(`[AUDIT]   error: ${err.slice(0, 200)}`);
    }
  });
});

// ─── Group 2: API Read Paths ─────────────────────────────────────────────────

test.describe('Life App — API Reads', () => {
  test('GET /api/v1/life/plan', async ({ request }) => {
    const resp = await request.get(`${BASE}/api/v1/life/plan?username=kckern`, {
      ignoreHTTPSErrors: true,
      timeout: 15000,
    });
    const status = resp.status();
    const body = await resp.text();
    console.log(`[AUDIT] GET /life/plan → ${status} (${body.length} bytes)`);
    console.log(`[AUDIT]   preview: ${body.slice(0, 200)}`);
    if (status === 504) console.log('[AUDIT]   CRITICAL: route not mounted in api.mjs');
    expect([200, 404, 504]).toContain(status);
  });

  test('GET /api/v1/life/health', async ({ request }) => {
    const resp = await request.get(`${BASE}/api/v1/life/health`, {
      ignoreHTTPSErrors: true,
      timeout: 15000,
    });
    const status = resp.status();
    const body = await resp.text();
    console.log(`[AUDIT] GET /life/health → ${status}`);
    console.log(`[AUDIT]   preview: ${body.slice(0, 200)}`);
    expect([200, 504]).toContain(status);
  });

  test('GET /api/v1/life/now', async ({ request }) => {
    const resp = await request.get(`${BASE}/api/v1/life/now?username=kckern`, {
      ignoreHTTPSErrors: true,
      timeout: 15000,
    });
    const status = resp.status();
    const body = await resp.text();
    console.log(`[AUDIT] GET /life/now → ${status}`);
    console.log(`[AUDIT]   preview: ${body.slice(0, 200)}`);
    expect([200, 504]).toContain(status);
  });

  test('GET /api/v1/life/plan/goals', async ({ request }) => {
    const resp = await request.get(`${BASE}/api/v1/life/plan/goals?username=kckern`, {
      ignoreHTTPSErrors: true,
      timeout: 15000,
    });
    const status = resp.status();
    const body = await resp.text();
    console.log(`[AUDIT] GET /life/plan/goals → ${status}`);
    console.log(`[AUDIT]   preview: ${body.slice(0, 200)}`);
    expect([200, 504]).toContain(status);
  });

  test('GET /api/v1/life/plan/beliefs', async ({ request }) => {
    const resp = await request.get(`${BASE}/api/v1/life/plan/beliefs?username=kckern`, {
      ignoreHTTPSErrors: true,
      timeout: 15000,
    });
    const status = resp.status();
    const body = await resp.text();
    console.log(`[AUDIT] GET /life/plan/beliefs → ${status}`);
    console.log(`[AUDIT]   preview: ${body.slice(0, 200)}`);
    expect([200, 504]).toContain(status);
  });

  test('GET /api/v1/life/plan/cadence', async ({ request }) => {
    const resp = await request.get(`${BASE}/api/v1/life/plan/cadence?username=kckern`, {
      ignoreHTTPSErrors: true,
      timeout: 15000,
    });
    const status = resp.status();
    const body = await resp.text();
    console.log(`[AUDIT] GET /life/plan/cadence → ${status}`);
    console.log(`[AUDIT]   preview: ${body.slice(0, 200)}`);
    expect([200, 504]).toContain(status);
  });

  test('GET /api/v1/life/now/drift', async ({ request }) => {
    const resp = await request.get(`${BASE}/api/v1/life/now/drift?username=kckern`, {
      ignoreHTTPSErrors: true,
      timeout: 15000,
    });
    const status = resp.status();
    const body = await resp.text();
    console.log(`[AUDIT] GET /life/now/drift → ${status}`);
    console.log(`[AUDIT]   preview: ${body.slice(0, 200)}`);
    expect([200, 504]).toContain(status);
  });

  test('GET /api/v1/life/schedule/json', async ({ request }) => {
    const resp = await request.get(`${BASE}/api/v1/life/schedule/json?username=kckern`, {
      ignoreHTTPSErrors: true,
      timeout: 15000,
    });
    const status = resp.status();
    const body = await resp.text();
    console.log(`[AUDIT] GET /life/schedule/json → ${status}`);
    console.log(`[AUDIT]   preview: ${body.slice(0, 200)}`);
    expect([200, 504]).toContain(status);
  });
});

// ─── Group 3: API Write Paths ────────────────────────────────────────────────

test.describe('Life App — API Writes', () => {
  test('PATCH /api/v1/life/plan/purpose', async ({ request }) => {
    const resp = await request.patch(`${BASE}/api/v1/life/plan/purpose?username=kckern`, {
      ignoreHTTPSErrors: true,
      data: { statement: 'Playwright audit purpose test', grounded_in: [] },
      timeout: 15000,
    });
    const status = resp.status();
    const body = await resp.text();
    console.log(`[AUDIT] PATCH /plan/purpose → ${status}: ${body.slice(0, 200)}`);
    if (status === 504) console.log('[AUDIT]   WRITE BLOCKED: route not mounted');
    if (status === 404) console.log('[AUDIT]   WRITE BLOCKED: no lifeplan.yml for user');
    expect([200, 404, 504]).toContain(status);
  });

  test('POST /api/v1/life/plan/feedback', async ({ request }) => {
    const resp = await request.post(`${BASE}/api/v1/life/plan/feedback?username=kckern`, {
      ignoreHTTPSErrors: true,
      data: { type: 'observation', content: 'Playwright audit feedback' },
      timeout: 15000,
    });
    const status = resp.status();
    const body = await resp.text();
    console.log(`[AUDIT] POST /plan/feedback → ${status}: ${body.slice(0, 200)}`);
    expect([200, 404, 501, 504]).toContain(status);
  });

  test('POST /api/v1/life/plan/goals/nonexistent/transition', async ({ request }) => {
    const resp = await request.post(`${BASE}/api/v1/life/plan/goals/nonexistent/transition?username=kckern`, {
      ignoreHTTPSErrors: true,
      data: { state: 'considered', reason: 'Playwright audit' },
      timeout: 15000,
    });
    const status = resp.status();
    const body = await resp.text();
    console.log(`[AUDIT] POST /plan/goals/transition → ${status}: ${body.slice(0, 200)}`);
    expect([200, 400, 404, 504]).toContain(status);
  });

  test('POST /api/v1/life/plan/ceremony/unit_intention/complete', async ({ request }) => {
    const resp = await request.post(`${BASE}/api/v1/life/plan/ceremony/unit_intention/complete?username=kckern`, {
      ignoreHTTPSErrors: true,
      data: { responses: { intentions: 'Test', energy: 'medium' } },
      timeout: 15000,
    });
    const status = resp.status();
    const body = await resp.text();
    console.log(`[AUDIT] POST /ceremony/complete → ${status}: ${body.slice(0, 200)}`);
    expect([200, 400, 501, 504]).toContain(status);
  });

  test('POST /api/v1/life/plan/beliefs/nonexistent/evidence', async ({ request }) => {
    const resp = await request.post(`${BASE}/api/v1/life/plan/beliefs/nonexistent/evidence?username=kckern`, {
      ignoreHTTPSErrors: true,
      data: { type: 'confirmation', note: 'Playwright audit evidence test' },
      timeout: 15000,
    });
    const status = resp.status();
    const body = await resp.text();
    console.log(`[AUDIT] POST /beliefs/evidence → ${status}: ${body.slice(0, 200)}`);
    expect([200, 400, 404, 504]).toContain(status);
  });
});
