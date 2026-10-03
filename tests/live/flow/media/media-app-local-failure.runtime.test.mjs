import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

// RELY.5a — local playback problems, split by cause (2026-10-03 ruling):
//  * a REFUSED file (the Plex proxy's real 503 source-unreadable answer) is
//    waited out: a waiting notice + handle sign within seconds, Skip now and
//    Retry; it resumes when the file comes back, or is skipped as "file
//    unavailable" at Media's 60 s limit — never earlier;
//  * a FAILING stream whose file the backend calls readable belongs to the
//    stall ladder: skipped with a notice naming what plays instead.
// The acceptance preview refuses non-GET /api calls, so the backend check is
// answered here with the real response shape; nothing fabricates playback.
test.use({ viewport: { width: 1440, height: 900 }, trace: 'retain-on-failure' });
test.setTimeout(300000);

const ARRIVAL_PART = /\/api\/v1\/proxy\/plex\/(?:stream\/55854(?:\?|$)|library\/parts\/58864\/)/;

async function addToQueue(page, title) {
  const search = page.getByRole('textbox', { name: 'Search media…' });
  await search.fill(title);
  const row = page.getByRole('option').filter({ hasText: title }).filter({ hasText: 'Movie' });
  await expect(row).toHaveCount(1, { timeout: 15000 });
  await row.getByRole('button', { name: 'More actions' }).click();
  await page.getByRole('menuitem', { name: 'Add to Queue', exact: true }).click();
  await page.keyboard.press('Escape');
}

// playback.* console lines go into the evidence directory for diagnosis.
function recordPlaybackConsole(page, testInfo) {
  const lines = [];
  page.on('console', (message) => {
    const text = message.text();
    if (/playback|source-|resilience|stall|media\.source|outcome|playback\.problem/i.test(text)) lines.push(`${new Date().toISOString()} ${text.slice(0, 600)}`);
  });
  return async () => {
    await testInfo.attach('playback-console', { body: lines.join('\n'), contentType: 'text/plain' });
    const dir = process.env.MEDIA_P0_EVIDENCE_DIR;
    if (dir) fs.writeFileSync(path.join(dir, `console-${testInfo.title.replace(/[^a-z0-9]+/gi, '_').slice(0, 80)}-${testInfo.retry}-${Date.now()}.log`), lines.join('\n'));
  };
}

async function queueTwo(page) {
  await page.goto('/media');
  await expect(page.getByRole('textbox', { name: 'Search media…' })).toBeVisible({ timeout: 30000 });
  await addToQueue(page, 'Arrival');
  await addToQueue(page, 'Disclosure Day');
  await expect(page.getByTestId('mini-player-open-nowplaying')).toHaveText('2 items ready');
}

for (const branch of ['comes back', 'stays refused']) {
  test(`[RELY.5a] refused file: waiting notice and sign, then it ${branch === 'comes back' ? 'resumes when the file comes back' : 'is skipped as unavailable at 60 s, not before'}`, async ({ page }, testInfo) => {
    const flush = recordPlaybackConsole(page, testInfo);
    let readable = false;
    const refusals = [];
    const checks = [];
    await page.route(ARRIVAL_PART, async (route) => {
      if (readable) return route.continue();
      refusals.push(Date.now());
      return route.fulfill({
        status: 503, headers: { 'retry-after': '5', 'content-type': 'application/json' },
        body: JSON.stringify({ error: 'Source unreadable', reason: 'source-unreadable' }),
      });
    });
    await page.route('**/api/v1/media-source/check', async (route) => {
      const body = route.request().postDataJSON();
      checks.push({ at: Date.now(), contentId: body?.contentId });
      const state = body?.contentId === 'plex:55854' && !readable ? 'unreadable' : 'readable';
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ state, contentId: body?.contentId, steps: [] }) });
    });
    try {
      await queueTwo(page);
      await page.getByTestId('mini-toggle').click();
      await page.getByTestId('app-nav-fleet').click();

      const waiting = page.locator('[data-testid^="dispatch-row-"][data-phase="waiting"]').filter({ hasText: 'Waiting for Arrival — the file is being repaired' });
      await expect(waiting).toBeVisible({ timeout: 20000 });
      expect(refusals.length).toBeGreaterThan(0);
      const firstCheck = checks.find((c) => c.contentId === 'plex:55854');
      expect(firstCheck, 'the Player asked the backend about the refused file').toBeTruthy();
      const signShownAt = Date.now();
      expect(signShownAt - firstCheck.at, 'waiting notice within 5 s of the wait opening').toBeLessThan(5000 + 2000);
      await expect(page.getByTestId('mini-problem')).toHaveAccessibleName(/waiting for the file of Arrival/);
      await expect(waiting.getByRole('button', { name: 'Skip now' })).toBeVisible();
      await expect(waiting.getByRole('button', { name: /Retry/ })).toBeVisible();

      if (branch === 'comes back') {
        readable = true;
        await expect.poll(() => page.evaluate(() => [...document.querySelectorAll('video')].some((v) => !v.paused && v.readyState >= 2 && v.currentTime > 0)), { timeout: 60000 }).toBe(true);
        await expect(page.getByTestId('mini-player-open-nowplaying')).toContainText('Arrival');
        await expect(page.getByTestId('mini-problem')).toHaveCount(0);
        await expect(waiting).toHaveCount(0);
        await expect(page.getByTestId('dispatch-tray')).not.toContainText('file unavailable');
      } else {
        // Never skipped before Media's 60 s limit.
        const firstWaitAt = firstCheck.at;
        await page.waitForTimeout(Math.max(0, firstWaitAt + 52000 - Date.now()));
        await expect(page.getByTestId('mini-player-open-nowplaying')).toContainText('Arrival');
        await expect(page.getByTestId('dispatch-tray')).not.toContainText('file unavailable');
        const skipped = page.locator('[data-testid^="dispatch-row-"]').filter({ hasText: 'Arrival skipped — file unavailable' });
        await expect(skipped).toBeVisible({ timeout: 25000 });
        const skippedAt = Date.now() - firstWaitAt;
        expect(skippedAt).toBeGreaterThanOrEqual(58000);
        expect(skippedAt).toBeLessThan(75000);
        await expect(skipped).toContainText('Now playing Disclosure Day');
        await expect(skipped.getByRole('button', { name: /Retry/ })).toBeVisible();
        await expect(waiting).toHaveCount(0);
        await expect(page.getByTestId('mini-player-open-nowplaying')).toContainText('Disclosure Day');
      }
    } finally {
      await flush();
    }
  });
}

test('[RELY.5a] failing stream on a readable file: the stall ladder skips it with a notice and a handle sign until the next item plays', async ({ page }, testInfo) => {
  const flush = recordPlaybackConsole(page, testInfo);
  // The backend says the file itself is readable, so the stall ladder owns
  // a broken stream deterministically (no refused-source wait).
  await page.route('**/api/v1/media-source/check', async (route) => {
    const body = route.request().postDataJSON();
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ state: 'readable', contentId: body?.contentId, steps: [] }) });
  });
  try {
    await queueTwo(page);
    await page.getByTestId('mini-toggle').click();
    await page.getByTestId('mini-player-open-nowplaying').click();
    const video = page.getByTestId('now-playing-host').locator('video');
    await expect.poll(() => video.evaluate((el) => !el.paused && el.readyState >= 2 && el.currentTime > 1), { timeout: 60000 }).toBe(true);

    // The network stops delivering Arrival's bytes and the person jumps past
    // what is buffered.
    const withheld = [];
    await page.route(ARRIVAL_PART, async (route) => { withheld.push(route.request().url()); await route.abort('failed'); });
    const seek = page.getByTestId('np-seek');
    const box = await seek.boundingBox();
    await page.mouse.click(box.x + box.width * 0.6, box.y + box.height / 2);
    await page.getByTestId('now-playing-back').click();

    const notice = page.locator('[data-testid^="dispatch-row-"]').filter({ hasText: 'Arrival' }).filter({ hasText: 'this device' });
    await expect(notice).toBeVisible({ timeout: 180000 });
    await expect(notice).toContainText('Now playing Disclosure Day');
    await expect(notice).toHaveAttribute('data-phase', 'skipped');
    await expect(notice.getByRole('button', { name: /Retry/ })).toBeVisible();
    await expect(page.getByTestId('media-mini-player')).toHaveClass(/mini-player--problem/);
    expect(withheld.length).toBeGreaterThan(0);
    await expect(page.getByTestId('mini-player-open-nowplaying')).toContainText('Disclosure Day');
    await expect.poll(() => page.evaluate(() => [...document.querySelectorAll('video')].some((v) => !v.paused && v.readyState >= 2 && v.currentTime > 0)), { timeout: 60000 }).toBe(true);
    await expect(page.getByTestId('mini-problem')).toHaveCount(0, { timeout: 30000 });
    await expect(notice).toBeVisible();
    await notice.getByRole('button', { name: 'Dismiss' }).click();
    await expect(notice).toHaveCount(0);
  } finally {
    await flush();
  }
});
