/**
 * Weekly Review — Durable Recording Flow Test
 *
 * Proves the durability contract end-to-end:
 * 1. Chunks are POSTed every 5s with monotonic seq numbers per sessionId.
 * 2. A page reload mid-recording surfaces the resume-draft overlay.
 * 3. "Finalize Previous" completes and clears the overlay.
 *
 * Navigation path: /tv?list=menu:fhe → Arrow right x2 → Enter → Weekly Review widget
 *
 * Environment notes:
 * - Requires Chrome flags for fake audio in headless mode:
 *   --use-fake-ui-for-media-stream --use-fake-device-for-media-stream
 *   Add to playwright.config.mjs launchOptions.args if mic prompts block the test.
 * - The test grants microphone permission via browser context, but the MediaRecorder
 *   will silently produce zero-byte chunks without a real (or fake) audio device.
 *   In CI, enable fake device flags; on kckern-server the real mic may not be present.
 * - Menu position: Weekly Review is index 2 in fhe.yml (0=Opening Hymn, 1=Spotlight,
 *   2=Weekly Review). ArrowRight twice from the initial focused position selects it.
 * - The resume-draft overlay requires that the backend has at least one chunk stored
 *   for the session. If chunks are zero-byte (no fake device), the overlay may not
 *   appear because the server draft will exist but totalBytes=0. The test still
 *   validates the overlay's presence — it will fail clearly if draft recovery is broken.
 */

import { test, expect } from '@playwright/test';
import { FRONTEND_URL } from '#fixtures/runtime/urls.mjs';

const FHE_MENU_URL = `${FRONTEND_URL}/tv?list=menu:fhe`;

test.describe('Weekly Review durable recording', () => {
  test.setTimeout(90_000); // override suite default — we wait up to 12s + 30s finalize

  test('chunks are uploaded every 5s and survive a page reload', async ({ browser }) => {
    // Grant microphone — Chrome will use a fake silent track in headless mode
    // only if --use-fake-device-for-media-stream is passed (see playwright.config.mjs).
    const context = await browser.newContext({ permissions: ['microphone'] });
    const page = await context.newPage();

    // ── Intercept chunk POSTs ────────────────────────────────────────────────
    const chunkPosts = [];
    await page.route('**/api/v1/weekly-review/recording/chunk', async (route) => {
      const req = route.request();
      let body = {};
      try { body = JSON.parse(req.postData() || '{}'); } catch { /* ignore */ }
      chunkPosts.push({
        sessionId: body.sessionId,
        seq: body.seq,
        week: body.week,
        bytes: body.chunkBase64?.length || 0,
      });
      await route.continue();
    });

    // ── Open FHE menu ────────────────────────────────────────────────────────
    await page.goto(FHE_MENU_URL, { waitUntil: 'networkidle', timeout: 30_000 });

    // Wait for the menu to render — look for any menu item text
    await page.waitForSelector('[class*="menu"], [class*="grid"], [data-uid]', { timeout: 15_000 });

    // Navigate to Weekly Review: index 2 = 2× ArrowRight from initial focus (index 0)
    await page.keyboard.press('ArrowRight');
    await page.waitForTimeout(300);
    await page.keyboard.press('ArrowRight');
    await page.waitForTimeout(300);

    // Open the item
    await page.keyboard.press('Enter');

    // ── Wait for WeeklyReview widget bootstrap ───────────────────────────────
    // The init overlay is shown while not recording and never recorded.
    await page.waitForSelector('.weekly-review-init-overlay', { timeout: 15_000 });

    // ── Start recording ──────────────────────────────────────────────────────
    // Press Enter to trigger startRecording() via the keydown handler.
    // The init overlay is also clickable; keyboard is more reliable in headless.
    await page.keyboard.press('Enter');

    // The init overlay should disappear and the grid should appear.
    await expect(page.locator('.weekly-review-init-overlay')).not.toBeVisible({ timeout: 8_000 });
    await page.waitForSelector('.weekly-review-grid', { timeout: 8_000 });

    // ── Wait for at least 2 chunks (timeslice = 5s, so ~12s gives ≥2) ────────
    // We poll until we have ≥2 chunk POSTs or 14s elapsed.
    const chunkDeadline = Date.now() + 14_000;
    while (chunkPosts.length < 2 && Date.now() < chunkDeadline) {
      await page.waitForTimeout(1_000);
    }

    // Assert chunk contract
    expect(chunkPosts.length, 'Expected at least 2 chunk POSTs in ~12 seconds').toBeGreaterThanOrEqual(2);
    expect(chunkPosts[0].seq, 'First chunk seq should be 0').toBe(0);
    expect(chunkPosts[1].seq, 'Second chunk seq should be 1').toBe(1);

    const firstSessionId = chunkPosts[0].sessionId;
    expect(firstSessionId, 'sessionId must match URL-safe base64/UUID pattern').toMatch(/^[A-Za-z0-9_-]{8,64}$/);

    // All chunks must share the same sessionId
    for (const c of chunkPosts) {
      expect(c.sessionId, 'All chunks must share one sessionId').toBe(firstSessionId);
    }

    // ── Reload mid-recording ─────────────────────────────────────────────────
    // This is the critical regression scenario: browser closes while recording is active.
    // The beforeunload handler calls uploaderBeaconFlush() which fires any pending chunks.
    await page.reload({ waitUntil: 'networkidle', timeout: 30_000 });

    // ── Navigate back to Weekly Review ───────────────────────────────────────
    // After reload, the menu is back at its initial state.
    await page.waitForSelector('[class*="menu"], [class*="grid"], [data-uid]', { timeout: 15_000 });
    await page.keyboard.press('ArrowRight');
    await page.waitForTimeout(300);
    await page.keyboard.press('ArrowRight');
    await page.waitForTimeout(300);
    await page.keyboard.press('Enter');

    // Bootstrap must complete before draft check runs
    await page.waitForSelector('.weekly-review-init-overlay', { timeout: 15_000 });

    // ── Expect the resume-draft overlay ─────────────────────────────────────
    // The overlay appears after bootstrap completes and the draft check finds the
    // session from the previous run. It contains "not finalized" in its message.
    const resumeOverlay = page.locator('.weekly-review-confirm-overlay').filter({ hasText: 'not finalized' });
    await expect(resumeOverlay, 'Resume-draft overlay should appear after reload').toBeVisible({ timeout: 15_000 });

    // ── Click "Finalize Previous" ────────────────────────────────────────────
    await page.getByText('Finalize Previous').click();

    // Wait for the finalize HTTP response
    await page.waitForResponse(
      r => r.url().includes('/recording/finalize') && r.status() === 200,
      { timeout: 30_000 }
    );

    // The overlay must disappear
    await expect(resumeOverlay, 'Resume-draft overlay should clear after finalize').not.toBeVisible({ timeout: 8_000 });

    await context.close();
  });
});
