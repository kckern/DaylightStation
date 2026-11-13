/**
 * Teacher Console — live smoke (school-production-hardening Task 19).
 *
 * Drives /school/teacher headless against WHATEVER server the configured
 * app port serves (reuseExistingServer — on this host that's the live
 * daylight-station container, not a test fixture). Assertions are anchored
 * to the LIVE roster/teachers reads, never hardcoded fixture data: if the
 * roster fetch fails, the test fails loudly rather than passing vacuously.
 *
 * Covers:
 *  1. The four tab buttons render.
 *  2. Today shows every roster kid BY NAME (RosterStrip joins
 *     GET /teacher/today rows against the roster for display names).
 *  3. Planning shows the SchoolMatrix ("The whole school") table, one row
 *     per roster kid.
 */
import { test, expect } from '@playwright/test';
import { FRONTEND_URL, BACKEND_URL } from '#fixtures/runtime/urls.mjs';

const BASE_URL = FRONTEND_URL;

test.describe.configure({ mode: 'serial' });

test.describe('Teacher Console — live smoke', () => {
  test.setTimeout(120000);

  /** @type {Array<{id: string, name: string}>} */
  let roster;
  /** @type {{configured: boolean, teachers: Array<{id: string, name: string}>}} */
  let teachersPayload;

  test.beforeAll(async ({ request }) => {
    // No-excuses live reads: a failure here must fail the suite, not degrade
    // into "skip the name assertions."
    const rosterRes = await request.get(`${BACKEND_URL}/api/v1/school/roster`);
    expect(rosterRes.ok(), `GET /api/v1/school/roster must succeed (got ${rosterRes.status()})`).toBeTruthy();
    roster = await rosterRes.json();
    expect(Array.isArray(roster) && roster.length > 0, 'live roster must be a non-empty array').toBeTruthy();

    const teachersRes = await request.get(`${BACKEND_URL}/api/v1/school/teachers`);
    expect(teachersRes.ok(), `GET /api/v1/school/teachers must succeed (got ${teachersRes.status()})`).toBeTruthy();
    teachersPayload = await teachersRes.json();
    expect(teachersPayload.configured, 'this install must have teachers: configured for the console to be claimable').toBeTruthy();
    expect(Array.isArray(teachersPayload.teachers) && teachersPayload.teachers.length > 0, 'live teachers list must be non-empty').toBeTruthy();
  });

  test('renders the four tabs and Today shows every live roster kid by name', async ({ page }) => {
    await page.goto(`${BASE_URL}/school/teacher`);

    const tabs = page.locator('.teacher-console__tab');
    await expect(tabs).toHaveCount(4);
    // toContainText (not toHaveText) — Today's tab can carry a live backlog
    // badge number appended to its label; the label substring is the contract.
    const labels = ['Today', 'Planning', 'Records', 'Repair'];
    for (let i = 0; i < labels.length; i += 1) {
      await expect(tabs.nth(i)).toContainText(labels[i]);
    }

    // Today is the default tab — RosterStrip joins GetTeacherToday rows
    // against the roster for names; when wired it's one row per roster kid.
    const today = page.locator('.teacher-panel', { has: page.locator('.teacher-panel__title', { hasText: 'Today' }) });
    await expect(today).toHaveAttribute('data-state', 'ok', { timeout: 30000 });

    for (const kid of roster) {
      await expect(
        page.locator('.teacher-roster__name', { hasText: kid.name }),
        `Today roster must show live roster kid "${kid.name}" by name`,
      ).toBeVisible();
    }
    await expect(page.locator('.teacher-roster__name')).toHaveCount(roster.length);
  });

  test('Planning shows the whole-school matrix with every roster kid as a row', async ({ page }) => {
    await page.goto(`${BASE_URL}/school/teacher`);
    await page.getByRole('button', { name: 'Planning', exact: true }).click();

    const matrixPanel = page.locator('.teacher-panel', { has: page.locator('.teacher-panel__title', { hasText: 'The whole school' }) });
    await expect(matrixPanel.locator('.teacher-panel__title')).toHaveText('The whole school');
    await expect(matrixPanel).toHaveAttribute('data-state', 'ok', { timeout: 30000 });

    const matrix = page.locator('[data-testid="school-matrix"]');
    await expect(matrix.locator('table.teacher-matrix__grid')).toBeVisible();
    for (const kid of roster) {
      await expect(
        matrix.locator('tbody th', { hasText: kid.name }),
        `matrix must have a row for live roster kid "${kid.name}"`,
      ).toBeVisible();
    }
  });

  test('phone journey expands a learner with an accessible disclosure and keeps panels in one column', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${BASE_URL}/school/teacher/dashboard`);
    const today = page.locator('.teacher-panel', { has: page.locator('.teacher-panel__title', { hasText: 'Today' }) });
    await expect(today).toHaveAttribute('data-state', 'ok', { timeout: 30000 });

    const disclosure = page.locator('.teacher-roster__card').first();
    await expect(disclosure).toHaveAttribute('aria-expanded', 'false');
    const controls = await disclosure.getAttribute('aria-controls');
    expect(controls).toMatch(/^teacher-day-/);
    await disclosure.focus();
    await page.keyboard.press('Enter');
    await expect(disclosure).toHaveAttribute('aria-expanded', 'true');
    await expect(page.locator(`#${controls}`)).toBeVisible();

    const panels = page.locator('.teacher-view > .teacher-panel');
    if (await panels.count() > 1) {
      const first = await panels.nth(0).boundingBox();
      const second = await panels.nth(1).boundingBox();
      expect(second.y).toBeGreaterThanOrEqual(first.y + first.height - 1);
    }
  });
});
