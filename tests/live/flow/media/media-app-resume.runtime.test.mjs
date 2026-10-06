import { test, expect } from '@playwright/test';

test.describe('MediaApp — Resume and Recents on Home', () => {
  test('home shows the resume card when a session has been paused', async ({ page }) => {
    await page.addInitScript(() => { if (!sessionStorage.getItem('cleared')) { localStorage.clear(); sessionStorage.setItem('cleared', '1'); } });
    await page.goto('/media');
    // Play, then pause, to leave a paused session (ordinary input only).
    const search = page.getByRole('textbox', { name: 'Search media…' });
    await expect(search).toBeVisible({ timeout: 30000 });
    await search.fill('Arrival');
    const arrival = page.getByRole('option').filter({ hasText: 'Arrival' }).filter({ hasText: 'Movie' });
    await expect(arrival).toHaveCount(1, { timeout: 15000 });
    await arrival.click();
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('mini-toggle')).toHaveAccessibleName('Pause', { timeout: 30000 });
    await page.getByTestId('mini-toggle').click();
    await expect(page.getByTestId('mini-toggle')).toHaveAccessibleName('Play');

    // Recent is the household's list (blocked by the acceptance server; answered here).
    await page.route('**/api/v1/media/household/recent*', route => route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({ items: [{ contentId: 'plex:55854', title: 'Arrival', type: 'movie', thumbnail: null,
        lastPlayed: '2026-10-03 08:00:00', finished: false, playedOn: null, spots: [], plays: [] }] }),
    }));
    await page.getByTestId('app-nav-browse').click();
    await page.getByTestId('app-nav-home').click();
    await expect(page.getByTestId('resume-card')).toBeVisible();
    await expect(page.getByTestId('home-row-recent')).toBeVisible({ timeout: 8000 });
  });
});

// RELY.7a — reload restores session, spot, queue, repeat/shuffle, aim and the
// area the person was in, PAUSED: no media element is mounted until Play.
test.describe('MediaApp — paused restore after reload', () => {
  test.use({ viewport: { width: 1440, height: 900 } });
  test.setTimeout(150000);

  test('[RELY.7a] a reload restores what was playing, its spot, queue, repeat, shuffle, aim and area — paused', async ({ page }) => {
    await page.goto('/media');
    const search = page.getByRole('textbox', { name: 'Search media…' });
    await expect(search).toBeVisible({ timeout: 30000 });
    await search.fill('Arrival');
    const arrival = page.getByRole('option').filter({ hasText: 'Arrival' }).filter({ hasText: 'Movie' });
    await expect(arrival).toHaveCount(1, { timeout: 15000 });
    await arrival.click();
    await page.getByTestId('mini-player-open-nowplaying').click();
    const video = page.getByTestId('now-playing-host').locator('video');
    await expect.poll(() => video.evaluate(el => !el.paused && el.readyState >= 2), { timeout: 30000 }).toBe(true);
    await page.getByRole('button', { name: 'Forward 10 seconds' }).click();
    await page.getByRole('button', { name: 'Forward 10 seconds' }).click();

    await search.fill('Disclosure Day');
    const next = page.getByRole('option').filter({ hasText: 'Disclosure Day' }).filter({ hasText: 'Movie' });
    await expect(next).toHaveCount(1, { timeout: 15000 });
    await next.getByRole('button', { name: 'More actions' }).click();
    await page.getByRole('menuitem', { name: 'Add to Queue', exact: true }).click();
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('queue-panel').locator('.queue-item')).toHaveCount(2);
    await page.getByTestId('queue-shuffle').click();
    await expect(page.getByTestId('queue-shuffle')).toHaveAttribute('aria-pressed', 'true');
    await page.getByTestId('queue-repeat').click();
    await expect(page.getByTestId('queue-repeat')).toHaveText('Repeat all');

    // Aim at the virtual receiver (never commanded in this journey).
    await page.getByTestId('cast-target-chip').click();
    await page.getByTestId('cast-mode-fork').check();
    await page.getByTestId('cast-target-checkbox-acceptance-media').check();
    await page.getByTestId('cast-target-chip').click();
    await expect(page.getByTestId('cast-popover')).toBeHidden();
    const aim = page.getByRole('button', { name: /^Aim: Acceptance receiver/ });
    await expect(aim.first()).toBeVisible();

    // Still playing; let the durable ≥5s position cadence write the spot.
    await expect.poll(() => video.evaluate(el => !el.paused && el.currentTime > 25), { timeout: 30000 }).toBe(true);
    await page.waitForTimeout(6000);
    const playedTo = await video.evaluate(el => el.currentTime);
    expect(await video.evaluate(el => el.paused)).toBe(false);
    const urlBefore = new URL(page.url());

    const mediaRequests = [];
    page.on('request', request => {
      const path = new URL(request.url()).pathname;
      // Playback resolution and media bytes only (artwork is not playback).
      if (path.startsWith('/api/v1/play/') || /^\/api\/v1\/proxy\/plex\/(?:stream|video|library\/parts)\//.test(path)) mediaRequests.push(path);
    });
    await page.reload();

    // Same area of the app.
    await expect(page.getByTestId('now-playing-view')).toBeVisible({ timeout: 30000 });
    expect(new URL(page.url()).search).toBe(urlBefore.search);
    await expect(page.getByTestId('now-playing-title')).toContainText('Arrival');
    // Paused, and nothing loading or sounding: no media element, no media reads.
    await page.waitForTimeout(4000);
    await expect(page.locator('video')).toHaveCount(0);
    expect(mediaRequests).toEqual([]);
    await expect(page.getByTestId('np-toggle')).toHaveAccessibleName('Play');
    // Queue, repeat, shuffle, aim.
    await expect(page.getByTestId('queue-panel').locator('.queue-item')).toHaveCount(2);
    await expect(page.getByTestId('queue-shuffle')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('queue-repeat')).toHaveText('Repeat all');
    await expect(page.getByRole('button', { name: /^Aim: Acceptance receiver/ }).first()).toBeVisible();

    // Play resumes at the restored spot.
    await page.getByTestId('np-toggle').click();
    const resumed = page.getByTestId('now-playing-host').locator('video');
    await expect.poll(() => resumed.evaluate(el => !el.paused && el.readyState >= 2), { timeout: 30000 }).toBe(true);
    const at = await resumed.evaluate(el => el.currentTime);
    expect(at).toBeGreaterThan(playedTo - 8);
    expect(at).toBeLessThan(playedTo + 15);
  });

  for (const [label, stored] of [
    ['malformed', '{"schemaVersion":1,"snapshot":{"sessionId":"x","queue":"nope"}'],
    ['older', JSON.stringify({ schemaVersion: 0, snapshot: { sessionId: 'old', state: 'playing' } })],
  ]) {
    test(`[RELY.7a] a ${label} saved session is discarded safely`, async ({ page }) => {
      await page.addInitScript((value) => {
        if (!sessionStorage.getItem('seeded')) {
          localStorage.clear();
          localStorage.setItem('media-app.session', value);
          sessionStorage.setItem('seeded', '1');
        }
      }, stored);
      await page.goto('/media');
      await expect(page.getByTestId('media-dock')).toBeVisible({ timeout: 30000 });
      await expect(page.getByTestId('media-mini-player')).toHaveCount(0);
      await expect(page.locator('video')).toHaveCount(0);
      await expect.poll(() => page.evaluate(() => localStorage.getItem('media-app.session'))).not.toBe(stored);
    });
  }
});
