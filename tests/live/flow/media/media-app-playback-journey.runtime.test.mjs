import { test, expect } from '@playwright/test';

// A real catalog → app → Player → media element → UI round trip.
// No fabricated responses, synthetic clicks, forced clicks, or fabricated session state.
// Each test has a fresh browser context and targets only its own local player.
const title = process.env.MEDIA_ACCEPTANCE_TITLE || 'Disclosure Day';

test.use({ viewport: { width: 1440, height: 900 }, trace: 'retain-on-failure', actionTimeout: 10000 });
test.setTimeout(90000);

test.afterEach(async ({ page }, testInfo) => {
  // Closing a browser context does not run React's unmount cleanup. Stop our
  // own local playback through the UI so each case releases its DASH session.
  if (page.isClosed()) return;
  const observations = await page.evaluate(() => ({
    events: window.__mediaJourneyEvents ?? [],
    videos: [...document.querySelectorAll('video, dash-video')].flatMap(el => {
      const video = el.tagName === 'DASH-VIDEO' ? el.shadowRoot?.querySelector('video') : el;
      return video ? [{ currentTime: video.currentTime, seeking: video.seeking,
        paused: video.paused, readyState: video.readyState, networkState: video.networkState,
        buffered: Array.from({ length: video.buffered.length }, (_, i) => [video.buffered.start(i), video.buffered.end(i)]),
      }] : [];
    }),
    slider: document.querySelector('[data-testid="np-seek"]')?.getAttribute('aria-valuenow') ?? null,
  }));
  await testInfo.attach('native-playback-observations', {
    body: JSON.stringify(observations, null, 2), contentType: 'application/json',
  });
  const stop = page.getByTestId('np-stop');
  if (!(await stop.isVisible())) {
    const open = page.getByTestId('mini-player-open-nowplaying');
    if (await open.isVisible()) await open.click();
  }
  if (await stop.isVisible()) await stop.click();
});

async function startMovie(page) {
  await page.goto('/media');
  return playMovie(page);
}

async function playMovie(page) {
  const mintOrigins = [];
  const observeMint = response => {
    if (/\/api\/v1\/proxy\/plex\/stream\//.test(response.url())) {
      mintOrigins.push(response.headers()['x-media-acceptance-mint'] ?? 'upstream');
    }
  };
  page.on('response', observeMint);
  await test.step('Find and start the movie with ordinary user input', async () => {
    const search = page.getByRole('textbox', { name: 'Search media…' });
    // Dev-module loading is separate from the interaction timeout; release
    // startup budgets are checked against the built app, not Vite transforms.
    await expect(search).toBeVisible({ timeout: 30000 });
    await search.fill(title);
    // Catalog titles may also name an album or track. Choose the leading
    // matching result normally; the actual video checks below remain required.
    const result = page.getByRole('option').filter({ hasText: title }).first();
    await expect(result).toBeVisible({ timeout: 15000 });
    await result.click();
    await page.getByTestId('mini-player-open-nowplaying').click();
  });
  const video = page.getByTestId('now-playing-host').locator('video');
  await expect(video).toHaveCount(1, { timeout: 30000 });
  await video.evaluate(el => {
    window.__mediaJourneyEvents = [];
    for (const name of ['seeking', 'seeked', 'timeupdate', 'pause', 'playing']) {
      el.addEventListener(name, () => {
        window.__mediaJourneyEvents.push({ event: name, at: performance.now(),
          currentTime: el.currentTime, seeking: el.seeking, paused: el.paused,
          readyState: el.readyState,
          buffered: Array.from({ length: el.buffered.length }, (_, i) => [el.buffered.start(i), el.buffered.end(i)]),
          slider: document.querySelector('[data-testid="np-seek"]')?.getAttribute('aria-valuenow') ?? null,
        });
        if (window.__mediaJourneyEvents.length > 80) window.__mediaJourneyEvents.shift();
      });
    }
  });
  await expect.poll(() => video.evaluate(el => ({
    paused: el.paused, ready: el.readyState >= 2, hasPosition: el.currentTime > 0,
    currentTime: el.currentTime, readyState: el.readyState,
    networkState: el.networkState, seeking: el.seeking, error: el.error?.code ?? null,
  })), {
    timeout: 30000, message: 'The real video must advance, not merely show its title',
  }).toMatchObject({ paused: false, ready: true, hasPosition: true });
  const observedAt = await video.evaluate(el => el.currentTime);
  await expect.poll(() => video.evaluate(el => el.currentTime), {
    timeout: 10000, message: 'Ready playback must actually advance beyond its first observed position',
  }).toBeGreaterThan(observedAt + 0.25);
  if (process.env.MEDIA_BRANCH_MINT === '1') {
    expect(mintOrigins, 'Playback must exercise the branch mint composition').toContain('worktree');
    expect(mintOrigins).not.toContain('upstream');
  }
  page.off('response', observeMint);
  return video;
}

test('[PLACE.1a/AC3][PLACE.1a/AC4][STEER.1b] opening Office controls does not redirect local-aim playback', async ({ page }) => {
  const blockedCommands = [];
  // Safety boundary: observing Office is read-only. Any attempted device
  // mutation fails the test and is blocked before it can affect hardware.
  await page.route('**/api/v1/device/**', async route => {
    const request = route.request();
    if (request.method() !== 'GET' || /\/load(?:\?|$)/.test(request.url())) {
      blockedCommands.push({ method: request.method(), url: request.url() });
      await route.abort('blockedbyclient');
      return;
    }
    await route.continue();
  });
  await page.goto('/media');
  await expect(page.getByRole('navigation', { name: 'Primary' })).toBeVisible({ timeout: 30000 });
  await page.getByRole('navigation', { name: 'Primary' }).getByRole('button', { name: /^(?:\d+\s+)?Devices$/ }).click();
  await page.getByTestId('fleet-peek-office-tv').click();
  await expect(page.getByTestId('peek-panel')).toBeVisible();
  await playMovie(page);
  expect(blockedCommands, 'Steering must not redirect playback away from the fresh local aim').toEqual([]);
});

test('[PLAY.1b/AC1][STEER.4a/AC1] discovered movie duration and progress reach the visible seek bar', async ({ page }) => {
  const video = await startMovie(page);
  const slider = page.getByRole('slider', { name: 'Seek', exact: true });
  await expect(slider).not.toHaveAttribute('aria-disabled', 'true');
  const duration = await video.evaluate(el => el.duration);
  expect(duration).toBeGreaterThan(0);
  await expect.poll(async () => Math.abs(Number(await slider.getAttribute('aria-valuemax')) - duration)).toBeLessThanOrEqual(1);
  await expect.poll(async () => {
    const actual = await video.evaluate(el => el.currentTime);
    return Math.abs(Number(await slider.getAttribute('aria-valuenow')) - actual);
  }).toBeLessThanOrEqual(2);
  await page.getByTestId('np-toggle').click();
  await expect.poll(() => video.evaluate(el => el.paused)).toBe(true);
  const before = await video.evaluate(el => el.currentTime);
  await slider.focus();
  await page.keyboard.press('ArrowRight');
  await expect.poll(() => video.evaluate(el => el.currentTime), { timeout: 15000 }).toBeGreaterThan(before + 3);
  await expect.poll(async () => Math.abs(Number(await slider.getAttribute('aria-valuenow')) - await video.evaluate(el => el.currentTime))).toBeLessThanOrEqual(2);
  const bounds = await slider.boundingBox();
  expect(bounds).not.toBeNull();
  const destination = before + 90 < duration - 5 ? before + 90 : Math.max(0, before - 90);
  const y = bounds.y + bounds.height / 2;
  await page.mouse.move(bounds.x + bounds.width * (before / duration), y);
  await page.mouse.down();
  await page.mouse.move(bounds.x + bounds.width * (destination / duration), y, { steps: 5 });
  await expect.poll(async () => Math.abs(Number(await slider.getAttribute('aria-valuenow')) - destination))
    .toBeLessThanOrEqual(duration / bounds.width + 1);
  const requested = Number(await slider.getAttribute('aria-valuenow'));
  expect(Math.abs(requested - before), 'Dragging must display the requested position before release').toBeGreaterThan(30);
  await page.mouse.up();
  await expect.poll(async () => Math.abs(await video.evaluate(el => el.currentTime) - requested), { timeout: 15000 }).toBeLessThanOrEqual(2);
  await expect.poll(async () => Math.abs(Number(await slider.getAttribute('aria-valuenow')) - await video.evaluate(el => el.currentTime))).toBeLessThanOrEqual(2);
  await expect.poll(() => video.evaluate(el => ({
    seeking: el.seeking, ready: el.readyState >= 2, paused: el.paused,
  })), { timeout: 15000, message: 'The decoder must finish the seek and remain paused, not only accept a currentTime assignment' })
    .toEqual({ seeking: false, ready: true, paused: true });
});

test('[STEER.3a/AC1][STEER.3a/AC3] pause and resume reflect the real player without a false startup stall', async ({ page }) => {
  const video = await startMovie(page);
  const toggle = page.getByTestId('np-toggle');
  await expect(toggle).toHaveAccessibleName('Pause');
  await toggle.click();
  await expect.poll(() => video.evaluate(el => el.paused)).toBe(true);
  await expect(toggle).toHaveAccessibleName('Play');
  const pausedAt = await video.evaluate(el => el.currentTime);
  await toggle.click();
  await expect.poll(() => video.evaluate((el, position) => !el.paused && el.currentTime > position, pausedAt), { timeout: 15000 }).toBe(true);
  await expect(toggle).toHaveAccessibleName('Pause');
  // Pass the historical 15-second watchdog boundary while observing actual
  // progress. Time passing alone cannot satisfy this assertion.
  await expect.poll(() => video.evaluate(el => el.currentTime), { timeout: 25000 }).toBeGreaterThan(pausedAt + 16);
  await expect(page.getByTestId('np-state')).toHaveAttribute('data-state', 'playing');
  await expect(toggle).toHaveAccessibleName('Pause');
});

test('[STEER.4a/AC2] forward and back controls seek the real video', async ({ page }) => {
  const video = await startMovie(page);
  await page.getByTestId('np-toggle').click();
  await expect.poll(() => video.evaluate(el => el.paused)).toBe(true);
  const before = await video.evaluate(el => el.currentTime);
  await page.getByRole('button', { name: 'Forward 10 seconds' }).click();
  await expect.poll(async () => Math.abs(await video.evaluate(el => el.currentTime) - (before + 10)), { timeout: 15000 }).toBeLessThanOrEqual(2);
  await page.getByRole('button', { name: 'Back 10 seconds' }).click();
  await expect.poll(async () => Math.abs(await video.evaluate(el => el.currentTime) - before), { timeout: 15000 }).toBeLessThanOrEqual(2);
});

test('[STEER.2a/AC1][STEER.2a/AC2] focused video expands and shrinks without replacing or restarting media', async ({ page }) => {
  const video = await startMovie(page);
  const original = await video.elementHandle();
  const before = await video.evaluate(el => el.currentTime);
  const source = await video.evaluate(el => {
    el.dataset.journeyPauseEvents = '0';
    el.addEventListener('pause', () => {
      el.dataset.journeyPauseEvents = String(Number(el.dataset.journeyPauseEvents) + 1);
    });
    return el.currentSrc;
  });
  await expect(page.getByRole('button', { name: 'Expand video', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Expand video', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Shrink video', exact: true })).toBeVisible();
  await expect(page.locator('.video-player.focused')).toBeVisible();
  await expect.poll(() => page.getByTestId('now-playing-view').evaluate(el => {
    const bounds = el.getBoundingClientRect();
    return Math.abs(bounds.left) <= 1 && Math.abs(bounds.top) <= 1
      && Math.abs(bounds.width - window.innerWidth) <= 1
      && Math.abs(bounds.height - window.innerHeight) <= 1;
  }), { message: 'Expanded player surface fills the viewport, not a centered content column' }).toBe(true);
  for (const control of ['np-toggle', 'np-stop', 'np-seek']) {
    expect(await page.getByTestId(control).evaluate(el => {
      const bounds = el.getBoundingClientRect();
      return bounds.width > 0 && bounds.height > 0 && bounds.left >= 0 && bounds.top >= 0
        && bounds.right <= window.innerWidth && bounds.bottom <= window.innerHeight;
    }), `${control} remains on-screen while expanded`).toBe(true);
  }
  await expect.poll(() => original.evaluate((el, position) => el.isConnected && !el.paused && el.currentTime >= position, before)).toBe(true);
  await page.getByRole('button', { name: 'Shrink video', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Expand video', exact: true })).toBeVisible();
  await expect.poll(() => original.evaluate((el, position) => el.isConnected && !el.paused && el.currentTime >= position, before)).toBe(true);
  await page.getByTestId('now-playing-back').click();
  await expect(page.getByTestId('mini-player-open-nowplaying')).toBeVisible();
  await expect.poll(() => original.evaluate((el, position) => el.isConnected && !el.paused && el.currentTime >= position, before)).toBe(true);
  expect(await original.evaluate(el => el.currentSrc)).toBe(source);
  expect(await original.evaluate(el => Number(el.dataset.journeyPauseEvents))).toBe(0);
});

test('[STEER.6a/AC1][STEER.6a/AC2][STEER.7a/AC2] stop ends actual playback and keeps the queue reachable', async ({ page }) => {
  await startMovie(page);
  await page.getByTestId('np-stop').click();
  await expect.poll(() => page.locator('video, audio').evaluateAll(els => els.every(el => el.paused || el.ended))).toBe(true);
  await expect(page.getByTestId('mini-player-open-nowplaying')).toBeVisible();
  await page.getByTestId('now-playing-back').click();
  await page.getByTestId('mini-player-open-nowplaying').click();
  await expect(page.getByTestId('now-playing-view')).toContainText(title);
  await page.getByTestId('mini-toggle').click();
  const restartedVideo = page.getByTestId('now-playing-host').locator('video');
  await expect(restartedVideo).toHaveCount(1, { timeout: 30000 });
  await expect.poll(() => restartedVideo.evaluate(el => !el.paused && el.currentTime > 0 && el.readyState >= 2), {
    timeout: 30000, message: 'Restarting the retained queue must actually play its item',
  }).toBe(true);
});

test('[PLAY.1a] selecting another title does not restart the previously paused movie', async ({ page }) => {
  const firstVideo = await startMovie(page);
  await page.getByTestId('np-toggle').click();
  await expect.poll(() => firstVideo.evaluate(el => el.paused)).toBe(true);
  const original = await firstVideo.elementHandle();
  const oldSource = await original.evaluate(el => {
    const source = el.currentSrc;
    el.dataset.oldSourcePlayEvents = '0';
    el.addEventListener('play', () => {
      if (el.currentSrc === source) {
        el.dataset.oldSourcePlayEvents = String(Number(el.dataset.oldSourcePlayEvents) + 1);
      }
    });
    return source;
  });
  const secondTitle = process.env.MEDIA_ACCEPTANCE_SECOND_TITLE || 'Arrival';
  await page.getByRole('textbox', { name: 'Search media…' }).fill(secondTitle);
  // The catalog ranks the film first; the title also names albums/tracks.
  // Actual new video playback below is required, not merely title selection.
  const second = page.getByRole('option').filter({ hasText: secondTitle }).first();
  await expect(second).toBeVisible({ timeout: 15000 });
  await second.click();
  const nextVideo = page.getByTestId('now-playing-host').locator('video');
  await expect.poll(() => nextVideo.evaluate((el, priorSource) => el.currentSrc !== priorSource
    && !el.paused && el.readyState >= 2 && el.currentTime > 0, oldSource), { timeout: 30000 }).toBe(true);
  expect(await original.evaluate(el => Number(el.dataset.oldSourcePlayEvents)),
    'Selecting another title must never play the paused old source again').toBe(0);
});
