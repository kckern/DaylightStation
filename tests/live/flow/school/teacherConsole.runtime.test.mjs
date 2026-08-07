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
 *  4. A wrong-PIN write refusal: claim a teacher via the console's soft
 *     sign-in picker (client-side claim, no PIN needed to claim), then
 *     attempt a pass-override Set with pin "0000" — NEVER the real PIN —
 *     and assert the PinPrompt/refusal path surfaces the server's error
 *     copy. This is the full UI ceremony (TeacherGate's bad-pin branch is
 *     also covered directly via the API in the setup assertions below).
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

  test('a wrong-PIN pass-override write is refused and surfaces the PIN prompt / error copy', async ({ page }) => {
    await page.goto(`${BASE_URL}/school/teacher`);
    await page.getByRole('button', { name: 'Planning', exact: true }).click();

    // Soft claim: tap the sign-in chip, pick a face. This is a client-side
    // claim — it needs no PIN. The PIN gate only bites on the WRITE.
    const chip = page.locator('.teacher-console__chip');
    await expect(chip).toHaveText('Sign in');
    await chip.click();

    const picker = page.getByRole('dialog', { name: "Who's teaching?" });
    await expect(picker).toBeVisible();
    const firstTeacherName = teachersPayload.teachers[0].name;
    await picker.locator('.piano-usercard', { hasText: firstTeacherName }).click();
    await expect(picker).toBeHidden();
    // toContainText — the chip also renders an avatar (image or initials
    // fallback), so the teacher's name is a substring, not the full text.
    await expect(chip).toContainText(firstTeacherName);

    // The curriculum browser's pass-override control — any published unit
    // works; the assertion is about the refusal path, not a specific unit.
    const overrideBlock = page.locator('.teacher-curriculum__pass').first();
    await expect(overrideBlock, 'curriculum must publish at least one unit with a pass-override control').toBeVisible({ timeout: 30000 });
    const input = overrideBlock.locator('input');
    const setButton = overrideBlock.getByRole('button', { name: 'Set' });

    await input.fill('77');
    await setButton.click();

    // First attempt has no PIN yet (claim alone never carries one) — the
    // server 403s and the console opens the PIN prompt automatically.
    const pinDialog = page.getByRole('dialog', { name: 'Teacher PIN' });
    await expect(pinDialog).toBeVisible({ timeout: 15000 });

    // NEVER the real PIN — 0000 is a deliberate wrong guess to exercise the
    // refusal path, not a working credential.
    await pinDialog.locator('input[aria-label="PIN"]').fill('0000');
    await pinDialog.getByRole('button', { name: 'Save' }).click();

    // The stashed write replays automatically with the new (still wrong)
    // pin, the server refuses again, and the panel surfaces the server's
    // own refusal copy — the exact TeacherGate bad-pin message.
    const error = overrideBlock.locator('.teacher-panel__error');
    await expect(error).toBeVisible({ timeout: 15000 });
    await expect(error).toContainText(/pin/i);

    // The refusal must not have silently "succeeded" — the console reopens
    // the PIN prompt rather than clearing the input as a success would.
    await expect(pinDialog).toBeVisible();
  });

  test('the API refuses a wrong-PIN pass-override write directly with 403 (defense in depth)', async ({ request }) => {
    // Direct API check of the same refusal path, independent of UI timing —
    // belt-and-suspenders for the headless ceremony above. Targets a unit id
    // that cannot collide with real curriculum data.
    const res = await request.put(`${BACKEND_URL}/api/v1/school/pass-overrides/__task19_smoke_probe__`, {
      data: { percent: 50, editedBy: teachersPayload.teachers[0].id, pin: '0000' },
    });
    expect(res.status()).toBe(403);
    const body = await res.json();
    expect(body.error).toMatch(/pin/i);
  });
});
