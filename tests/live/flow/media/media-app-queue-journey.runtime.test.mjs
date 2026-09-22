import { test, expect } from '@playwright/test';

const title = process.env.MEDIA_ACCEPTANCE_TITLE || 'Disclosure Day';
test.use({ viewport: { width: 1440, height: 900 }, trace: 'retain-on-failure', actionTimeout: 10000 });
test.setTimeout(90000);

function observePlaybackRequests(page) {
  const requests = [];
  page.on('request', request => {
    const path = new URL(request.url()).pathname;
    if (/\/api\/v1\/(?:play\/|proxy\/plex\/(?:stream|library\/parts|video\/:\/transcode))/.test(path)) requests.push(path);
  });
  return requests;
}

async function expectHeldQueueThenPlay(page, requests) {
  await expect(page.getByTestId('queue-panel').locator('.queue-item-title')).toHaveText([`1.${title}`]);
  // Observe an actual interval, not merely the render before async Add settles.
  const samples = await page.evaluate(async () => {
    const values = [];
    for (let i = 0; i < 10; i++) {
      values.push(document.querySelectorAll('video, dash-video').length);
      await new Promise(resolve => setTimeout(resolve, 200));
    }
    return values;
  });
  expect(samples).toEqual(Array(10).fill(0));
  expect(requests, 'Add must not request playback before explicit Play').toEqual([]);
  // A held queue has no current item, so its existing Play is in the mini-player.
  await page.getByTestId('mini-toggle').click();
  const video = page.getByTestId('now-playing-host').locator('video');
  await expect(video).toHaveCount(1, { timeout: 30000 });
  await expect.poll(() => video.evaluate(el => !el.paused && el.readyState >= 2), { timeout: 30000 }).toBe(true);
  const start = await video.evaluate(el => el.currentTime);
  await expect.poll(() => video.evaluate(el => el.currentTime)).toBeGreaterThan(start + 0.25);
  expect(requests.length).toBeGreaterThan(0);
}

test.afterEach(async ({ page }) => {
  // Release only this test's local playback through the ordinary UI.
  if (page.isClosed()) return;
  if (await page.getByRole('listbox').isVisible().catch(() => false)) await page.keyboard.press('Escape');
  const expandedStop = page.getByTestId('np-stop');
  const stop = await expandedStop.isVisible().catch(() => false) ? expandedStop : page.getByTestId('mini-stop');
  if (await stop.isVisible().catch(() => false)) await stop.click();
});

test('[FIND.1a/AC5] keyboard opens row actions and adds without clearing search or starting playback', async ({ page }) => {
  const requests = observePlaybackRequests(page);
  await page.goto('/media');
  const search = page.getByRole('textbox', { name: 'Search media…' });
  await expect(search).toBeVisible({ timeout: 30000 });
  await search.fill(title);
  const result = page.getByRole('option').filter({ hasText: title }).filter({ hasText: 'Movie' });
  await expect(result).toHaveCount(1, { timeout: 15000 });
  const more = result.getByRole('button', { name: 'More actions' });
  await more.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('menuitem', { name: 'Add to Queue', exact: true })).toBeVisible();
  for (const action of ['Play Now', 'Play Next', 'Play First', 'Add to Queue']) {
    await page.keyboard.press('ArrowDown');
    await expect(page.getByRole('menuitem', { name: action, exact: true })).toBeFocused();
  }
  await page.keyboard.press('Enter');
  await expect(search).toHaveValue(title);
  await expect(page.getByTestId('mini-player-open-nowplaying')).toHaveText('1 item ready');
  await expect(page.locator('video')).toHaveCount(0);
  await page.getByTestId('mini-player-open-nowplaying').click();
  // QueuePanel's title button includes its visible one-based index.
  await expect(page.getByTestId('queue-panel').locator('.queue-item-title')).toHaveText([`1.${title}`]);
  await expectHeldQueueThenPlay(page, requests);
});

test('[RELY.4a/AC1][RELY.4a/AC2] Undo restores the previous paused native position and queue generation', async ({ page }) => {
  await page.goto('/media');
  const search = page.getByRole('textbox', { name: 'Search media…' });
  await expect(search).toBeVisible({ timeout: 30000 });
  await search.fill(title);
  const result = page.getByRole('option').filter({ hasText: title }).filter({ hasText: 'Movie' });
  await expect(result).toHaveCount(1, { timeout: 15000 });
  await result.click();
  await page.getByTestId('mini-player-open-nowplaying').click();
  const video = page.getByTestId('now-playing-host').locator('video');
  await expect.poll(() => video.evaluate(el => !el.paused && el.readyState >= 2), { timeout: 30000 }).toBe(true);
  await page.getByTestId('np-toggle').click();
  await page.getByRole('button', { name: 'Forward 10 seconds' }).click();
  await expect.poll(() => video.evaluate(el => el.paused && !el.seeking && el.currentTime > 5), { timeout: 15000 }).toBe(true);
  const priorPosition = await video.evaluate(el => el.currentTime);
  const priorVisit = await page.getByTestId('queue-panel').locator('.queue-item').first().getAttribute('data-testid');
  const other = title === 'Arrival' ? 'Disclosure Day' : 'Arrival';
  await search.fill(other);
  const next = page.getByRole('option').filter({ hasText: other }).filter({ hasText: 'Movie' });
  await expect(next).toHaveCount(1, { timeout: 15000 });
  await next.getByRole('button', { name: 'More actions' }).click();
  await page.getByRole('menuitem', { name: 'Add to Queue', exact: true }).click();
  await page.keyboard.press('Escape');
  const rows = page.getByTestId('queue-panel').locator('.queue-item');
  await expect(rows).toHaveCount(2);
  const tailVisit = await rows.nth(1).getAttribute('data-testid');

  // Both queue edits must offer ordinary Undo, preserve entry identities,
  // and retain the paused physical playback node.
  const native = await video.elementHandle();
  await rows.nth(1).getByRole('button', { name: 'Remove from queue' }).click();
  await expect(rows).toHaveCount(1);
  await page.getByTestId('item-action-undo').last().click();
  await expect(page.getByTestId(tailVisit)).toBeVisible();
  expect(await native.evaluate(el => el.isConnected && el.paused)).toBe(true);
  await page.getByTestId('queue-clear').click();
  await expect(page.getByTestId('queue-empty')).toBeVisible();
  await page.getByTestId('item-action-undo').last().click();
  await expect(page.getByTestId(priorVisit)).toBeVisible();
  await expect(page.getByTestId(tailVisit)).toBeVisible();

  await search.fill(other);
  await expect(next).toHaveCount(1, { timeout: 15000 });
  await next.click();
  await expect(page.getByTestId(priorVisit)).toHaveCount(0);
  await expect(page.getByTestId(tailVisit)).toBeVisible();
  // Undo is offered at tap time: do not wait out its window for a decoder.
  await page.getByTestId('item-action-undo').last().click();
  await expect(page.getByTestId(priorVisit)).toBeVisible();
  await expect(page.getByTestId(tailVisit)).toBeVisible();
  await expect.poll(() => video.evaluate((el, seconds) => el.paused && !el.seeking && el.readyState >= 2
    && Math.abs(el.currentTime - seconds) < 1, priorPosition), { timeout: 30000 }).toBe(true);
});

test('[FIND.1a/AC5] pointer Add retains search, then the first nonfocus outside click dismisses results', async ({ page }) => {
  const requests = observePlaybackRequests(page);
  await page.goto('/media');
  const search = page.getByRole('textbox', { name: 'Search media…' });
  await expect(search).toBeVisible({ timeout: 30000 });
  await search.fill(title);
  const result = page.getByRole('option').filter({ hasText: title }).filter({ hasText: 'Movie' });
  await expect(result).toHaveCount(1, { timeout: 15000 });
  await result.getByRole('button', { name: 'More actions' }).click();
  await page.getByRole('menuitem', { name: 'Add to Queue', exact: true }).click();
  await expect(search).toHaveValue(title);
  await expect(page.getByTestId('mini-player-open-nowplaying')).toHaveText('1 item ready');
  await expect(page.locator('video')).toHaveCount(0);
  // Observe the ordinary browser click target; never dispatch a synthetic
  // event or move focus to make a second blur conceal a stale close marker.
  await page.evaluate(() => {
    window.__outsideClickWasNonfocus = null;
    document.addEventListener('pointerdown', event => {
      window.__outsideClickWasNonfocus = !event.target.closest('button, input, select, textarea, a[href], [tabindex]');
    }, { once: true, capture: true });
  });
  await page.getByRole('main').click({ position: { x: 5, y: 5 } });
  expect(await page.evaluate(() => window.__outsideClickWasNonfocus)).toBe(true);
  await expect(result).not.toBeVisible();
  await page.getByTestId('mini-player-open-nowplaying').click();
  await expect(page.getByTestId('queue-panel').locator('.queue-item-title')).toHaveText([`1.${title}`]);
  await expectHeldQueueThenPlay(page, requests);
});

test('[PLAY.6a/AC1][STEER.8a/AC2] add without interrupting, then jump to a same-title queue entry at zero', async ({ page }) => {
  await page.goto('/media');
  const search = page.getByRole('textbox', { name: 'Search media…' });
  await expect(search).toBeVisible({ timeout: 30000 });
  await search.fill(title);
  const result = page.getByRole('option').filter({ hasText: title }).filter({ hasText: 'Movie' });
  await expect(result).toHaveCount(1, { timeout: 15000 });
  await result.click();
  await page.getByTestId('mini-player-open-nowplaying').click();
  const video = page.getByTestId('now-playing-host').locator('video');
  await expect(video).toHaveCount(1, { timeout: 30000 });
  await expect.poll(() => video.evaluate(el => !el.paused && el.readyState >= 2 && el.currentTime > 0), { timeout: 30000 }).toBe(true);
  const startedAt = await video.evaluate(el => el.currentTime);
  await expect.poll(() => video.evaluate(el => el.currentTime), {
    message: 'The decoder must advance before testing queue actions',
  }).toBeGreaterThan(startedAt + 0.25);
  const originalVisit = await video.elementHandle();
  await page.getByTestId('np-toggle').click();
  await expect.poll(() => video.evaluate(el => el.paused)).toBe(true);
  await page.getByRole('button', { name: 'Forward 10 seconds' }).click();
  await expect.poll(() => video.evaluate(el => el.currentTime)).toBeGreaterThan(5);
  await expect.poll(() => video.evaluate(el => el.paused && !el.seeking && el.readyState >= 2), {
    timeout: 15000, message: 'The paused seek must complete before opening result actions',
  }).toBe(true);

  await search.fill(title);
  await expect(result).toHaveCount(1, { timeout: 15000 });
  await result.getByRole('button', { name: 'More actions' }).click();
  await page.getByRole('menuitem', { name: 'Add to Queue', exact: true }).click();
  await expect(search).toHaveValue(title);
  await expect.poll(() => video.evaluate(el => el.paused), {
    message: 'Opening actions and adding must not resume paused playback',
  }).toBe(true);
  await page.keyboard.press('Escape');
  const entries = page.getByTestId('queue-panel').locator('.queue-item-title');
  await expect(entries).toHaveCount(2);
  expect(await originalVisit.evaluate(el => el.isConnected && el.paused), 'Add must retain the paused physical visit').toBe(true);
  await entries.nth(1).click();
  await expect.poll(() => video.evaluate(el => !el.paused && el.readyState >= 2
    && el.currentTime > 0 && el.currentTime < 3), {
    timeout: 30000, message: 'A new same-title queue entry must actually restart, not only update the selected row',
  }).toBe(true);
  await expect.poll(() => originalVisit.evaluate(el => el.isConnected), {
    message: 'An explicit same-content queue visit must retire the previous native node, so its events cannot prove the new visit',
  }).toBe(false);

  // A one-visit autoplay barrier must not leak into the next ordinary title.
  const restartedSource = await video.evaluate(el => el.currentSrc);
  const nextTitle = title === 'Arrival' ? 'Disclosure Day' : 'Arrival';
  await search.fill(nextTitle);
  const nextResult = page.getByRole('option').filter({ hasText: nextTitle }).filter({ hasText: 'Movie' });
  await expect(nextResult).toHaveCount(1, { timeout: 15000 });
  await nextResult.click();
  await expect.poll(() => video.evaluate((el, priorSource) => el.currentSrc !== priorSource
    && !el.paused && !el.seeking && el.readyState >= 2, restartedSource), {
    timeout: 30000, message: 'An ordinary different title must play after the same-title restart',
  }).toBe(true);
  const nextStartedAt = await video.evaluate(el => el.currentTime);
  await expect.poll(() => video.evaluate(el => el.currentTime)).toBeGreaterThan(nextStartedAt + 0.25);
});

test('[PLAY.6a/AC2] Add keeps the actual playing video advancing without pause or reload', async ({ page }) => {
  await page.goto('/media');
  const search = page.getByRole('textbox', { name: 'Search media…' });
  await expect(search).toBeVisible({ timeout: 30000 });
  await search.fill(title);
  const result = page.getByRole('option').filter({ hasText: title }).filter({ hasText: 'Movie' });
  await expect(result).toHaveCount(1, { timeout: 15000 });
  await result.click();
  await page.getByTestId('mini-player-open-nowplaying').click();
  const video = page.getByTestId('now-playing-host').locator('video');
  await expect(video).toHaveCount(1, { timeout: 30000 });
  await expect.poll(() => video.evaluate(el => !el.paused && !el.seeking && el.readyState >= 2), { timeout: 30000 }).toBe(true);
  const initial = await video.evaluate(el => el.currentTime);
  await expect.poll(() => video.evaluate(el => el.currentTime)).toBeGreaterThan(initial + 0.25);
  await video.evaluate(el => {
    window.__queuePlayingNode = el;
    window.__queuePlaybackInterruptions = [];
    for (const event of ['pause', 'emptied', 'loadstart']) {
      el.addEventListener(event, () => window.__queuePlaybackInterruptions.push(event));
    }
  });
  const before = await video.evaluate(el => el.currentTime);
  const source = await video.evaluate(el => el.currentSrc);
  await search.fill(title);
  await result.getByRole('button', { name: 'More actions' }).click();
  await page.getByRole('menuitem', { name: 'Add to Queue', exact: true }).click();
  await expect(search).toHaveValue(title);
  await expect(page.getByTestId('queue-panel').locator('.queue-item-title')).toHaveCount(2);
  await expect.poll(() => video.evaluate(el => el.currentTime)).toBeGreaterThan(before + 0.25);
  expect(await video.evaluate(el => el === window.__queuePlayingNode && !el.paused && !el.seeking)).toBe(true);
  expect(await video.evaluate(el => el.currentSrc)).toBe(source);
  expect(await page.evaluate(() => window.__queuePlaybackInterruptions)).toEqual([]);
});
