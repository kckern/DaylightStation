import { test, expect } from '@playwright/test';

// A real catalog → app → Player → media element → UI round trip.
// No fabricated responses, synthetic clicks, forced clicks, or fabricated session state.
// Each test has a fresh browser context and targets only its own local player.
const title = process.env.MEDIA_ACCEPTANCE_TITLE || 'Disclosure Day';
const device = process.env.MEDIA_ACCEPTANCE_VIEWPORT || 'desktop';
const viewports = { desktop: { width: 1440, height: 900 }, tablet: { width: 820, height: 1180 }, phone: { width: 390, height: 844 } };
if (!viewports[device]) throw new Error('MEDIA_ACCEPTANCE_VIEWPORT must be desktop, tablet, or phone');
const pageEvidence = new WeakMap();
const sessionEvidence = new WeakMap();

test.use({ viewport: viewports[device], trace: 'retain-on-failure', actionTimeout: 10000 });
test.setTimeout(90000);

test.beforeEach(async ({ page }) => {
  const evidence = { observed: new Set(), stopped: new Map() };
  sessionEvidence.set(page, evidence);
  page.on('response', response => {
    const url = new URL(response.url());
    if (url.origin !== new URL(page.url()).origin) return;
    const match = /^\/api\/v1\/proxy\/plex\/video\/:\/transcode\/universal\/session\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\//i.exec(url.pathname);
    if (match && response.ok()) evidence.observed.add(match[1].toLowerCase());
    if (url.pathname === '/api/v1/proxy/plex/video/:/transcode/universal/stop') {
      evidence.stopped.set(url.searchParams.get('session')?.toLowerCase(), response.status());
    }
  });
});

test.afterEach(async ({ page }, testInfo) => {
  // Closing a browser context does not run React's unmount cleanup. Stop our
  // own local playback through the UI. For HLS, separately verify the exact
  // observed server-session stop response; native unmount alone is not proof.
  if (page.isClosed()) return;
  const closeSearch = page.getByTestId('search-mode-close');
  if (await closeSearch.isVisible()) await closeSearch.click();
  const observations = await page.evaluate(() => ({
    events: window.__mediaJourneyEvents ?? [],
    hls: window.__hlsAcceptance ?? [],
    videos: [...document.querySelectorAll('video, dash-video')].flatMap(el => {
      const video = el.tagName === 'DASH-VIDEO' ? el.shadowRoot?.querySelector('video') : el;
      return video ? [{ currentTime: video.currentTime, seeking: video.seeking,
        paused: video.paused, readyState: video.readyState, networkState: video.networkState,
        buffered: Array.from({ length: video.buffered.length }, (_, i) => [video.buffered.start(i), video.buffered.end(i)]),
      }] : [];
    }),
    slider: document.querySelector('[data-testid="np-seek"]')?.getAttribute('aria-valuenow') ?? null,
  }));
  observations.descriptors = pageEvidence.get(page)?.descriptors ?? [];
  await testInfo.attach('native-playback-observations', {
    body: JSON.stringify(observations, null, 2), contentType: 'application/json',
  });
  const stop = page.getByTestId('np-stop');
  if (!(await stop.isVisible())) {
    const open = page.getByTestId('mini-player-open-nowplaying');
    if (await open.isVisible()) await open.click();
  }
  if (await stop.isVisible()) await stop.click();
  const sessions = sessionEvidence.get(page);
  if (process.env.MEDIA_EXPECT_HLS === '1' && sessions?.observed.size) {
    await expect.poll(() => [...sessions.observed].every(id => {
      const status = sessions.stopped.get(id);
      return status >= 200 && status < 300;
    }), { timeout: 15000, message: 'Ordinary Stop must receive a successful stop response for every observed HLS session' }).toBe(true);
    await testInfo.attach('owned-hls-session-stop-responses', {
      body: JSON.stringify([...sessions.observed].map(id => ({ sessionId: id, status: sessions.stopped.get(id) }))),
      contentType: 'application/json',
    });
  }
});

async function startMovie(page) {
  await page.goto('/media');
  return playMovie(page);
}

async function expectPausedSeekComplete(video) {
  await expect.poll(() => video.evaluate(el => ({
    seeking: el.seeking, ready: el.readyState >= 2, paused: el.paused,
  })), { timeout: 15000, message: 'The decoder must finish the seek and remain paused, not only accept a currentTime assignment' })
    .toEqual({ seeking: false, ready: true, paused: true });
}

async function playMovie(page) {
  const mintOrigins = [];
  const descriptors = [];
  pageEvidence.set(page, { descriptors });
  const observeMint = async response => {
    if (/\/api\/v1\/proxy\/plex\/stream\//.test(response.url())) {
      mintOrigins.push(response.headers()['x-media-acceptance-mint'] ?? 'upstream');
    }
    if (/\/api\/v1\/play\/(?:plex:|plex\/)\d+$/.test(new URL(response.url()).pathname)) {
      const body = await response.json().catch(() => null);
      if (body) descriptors.push({ id: body.id, mediaType: body.mediaType, format: body.format,
        duration: body.duration, resume_position: body.resume_position,
        mediaPath: body.mediaUrl ? new URL(body.mediaUrl, response.url()).pathname : null,
        origin: response.headers()['x-media-acceptance-read'] ?? 'upstream' });
    }
  };
  page.on('response', observeMint);
  await test.step('Find and start the movie with ordinary user input', async () => {
    if (device === 'phone') {
      await expect(page.getByTestId('media-search-launcher')).toBeVisible({ timeout: 30000 });
      await page.getByTestId('media-search-launcher').click();
      const search = page.getByRole('dialog', { name: 'Search media', exact: true });
      await search.getByRole('searchbox', { name: 'Search media', exact: true }).fill(title);
      await search.getByRole('button', { name: 'Video', exact: true }).click();
      const result = search.getByTestId('search-mode-results').getByText(title, { exact: true });
      await expect(result).toHaveCount(1, { timeout: 15000 });
      await result.click();
      await expect(search).toBeVisible();
      await page.getByTestId('search-mode-close').click();
      await page.getByTestId('mini-player-open-nowplaying').click();
      return;
    }
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
  if (process.env.MEDIA_BRANCH_MINT === '1' || process.env.MEDIA_BRANCH_READ === '1' || process.env.MEDIA_EXPECT_HLS === '1') {
    // response.json() observation is asynchronous; settle it before deciding
    // whether this is an intentional original MP4 or a minted stream.
    await expect.poll(() => descriptors.length).toBeGreaterThan(0);
  }
  if (process.env.MEDIA_BRANCH_MINT === '1') {
    const descriptor = descriptors.at(-1);
    if (descriptor?.mediaType === 'video' && descriptor.mediaPath?.startsWith('/api/v1/proxy/plex/library/parts/')) {
      // A branch-qualified original MP4 intentionally does not mint a
      // transcoder session. Verify its descriptor and actual native source.
      expect(descriptor.origin).toBe('worktree');
      expect(await video.evaluate(el => new URL(el.currentSrc).pathname)).toBe(descriptor.mediaPath);
    } else {
      expect(mintOrigins, 'Stream playback must exercise the branch mint composition').toContain('worktree');
      expect(mintOrigins).not.toContain('upstream');
    }
  }
  if (process.env.MEDIA_BRANCH_READ === '1') {
    expect(descriptors.every(descriptor => descriptor.origin === 'worktree')).toBe(true);
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
  await expect.poll(async () => Math.abs(await video.evaluate(el => el.currentTime) - Math.min(duration, before + 5)), { timeout: 15000 })
    .toBeLessThanOrEqual(2);
  await expectPausedSeekComplete(video);
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
  await expectPausedSeekComplete(video);
});

test('[STEER.4a] a deep paused seek completes on the full-content timeline', async ({ page }) => {
  const video = await startMovie(page);
  const descriptor = pageEvidence.get(page)?.descriptors.at(-1);
  if (process.env.MEDIA_EXPECT_HLS === '1') {
    expect(descriptor?.mediaType).toBe('hls_video');
    await expect.poll(() => page.evaluate(() => (window.__hlsAcceptance ?? []).some(row => row.kind === 'INIT_PTS_FOUND'))).toBe(true);
  }
  const resume = descriptor?.resume_position ?? 0;
  if (resume > 0) {
    const actual = await video.evaluate(el => el.currentTime);
    expect(actual).toBeGreaterThanOrEqual(resume - 2);
    expect(actual).toBeLessThan(resume + 15);
  }
  await page.getByTestId('np-toggle').click();
  await expect.poll(() => video.evaluate(el => el.paused)).toBe(true);
  const slider = page.getByRole('slider', { name: 'Seek', exact: true });
  const duration = await video.evaluate(el => el.duration);
  const bounds = await slider.boundingBox();
  expect(bounds).not.toBeNull();
  const before = await video.evaluate(el => ({ position: el.currentTime,
    ranges: Array.from({ length: el.buffered.length }, (_, i) => [el.buffered.start(i), el.buffered.end(i)]) }));
  // Earlier real probes may have saved a deep spot. Choose a distant target
  // without rewriting saved state or manufacturing a resume DTO to force setup.
  const fraction = before.position > duration * 0.4 ? 0.2 : 0.6;
  const destination = Math.floor(duration * fraction);
  expect(before.ranges.some(([start, end]) => destination >= start && destination <= end)).toBe(false);
  await page.mouse.click(bounds.x + bounds.width * fraction, bounds.y + bounds.height / 2);
  await expect.poll(async () => Math.abs(Number(await slider.getAttribute('aria-valuenow')) - destination))
    .toBeLessThanOrEqual(duration / bounds.width + 1);
  const requested = Number(await slider.getAttribute('aria-valuenow'));
  expect(Math.abs(requested - destination)).toBeLessThanOrEqual(duration / bounds.width + 1);
  await expect.poll(async () => Math.abs(await video.evaluate(el => el.currentTime) - requested), { timeout: 15000 }).toBeLessThanOrEqual(2);
  await expectPausedSeekComplete(video);
  await expect.poll(async () => Math.abs(Number(await slider.getAttribute('aria-valuenow')) - await video.evaluate(el => el.currentTime))).toBeLessThanOrEqual(2);
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
  await expectPausedSeekComplete(video);
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

test('[STEER.2a/AC3] expanded audio keeps its actual node while showing artwork and title', async ({ page }) => {
  const audioId = 'plex:584614';
  const audioTitle = 'Faith';
  const playbackReads = [];
  page.on('response', response => {
    const url = new URL(response.url());
    if (url.pathname === '/api/v1/play/plex:584614') playbackReads.push(response.status());
  });
  await page.goto('/media');
  if (device === 'phone') {
    await page.getByTestId('media-search-launcher').click();
    const search = page.getByRole('dialog', { name: 'Search media', exact: true });
    await search.getByRole('searchbox', { name: 'Search media', exact: true }).fill(audioTitle);
    const result = search.getByTestId(`search-mode-result-${audioId}`);
    await expect(result).toBeVisible({ timeout: 15000 });
    await result.click();
    await page.getByTestId('search-mode-close').click();
  } else {
    const search = page.getByRole('textbox', { name: 'Search media…' });
    await expect(search).toBeVisible({ timeout: 30000 });
    await search.fill(audioTitle);
    const result = page.getByRole('option').filter({ has: page.getByTestId(`result-more-${audioId}`) });
    await expect(result).toHaveCount(1, { timeout: 15000 });
    await result.click();
  }
  await page.getByTestId('mini-player-open-nowplaying').click();

  const audioNodes = page.getByTestId('now-playing-host').locator('audio');
  await expect.poll(() => audioNodes.evaluateAll(els => els.findIndex(el => !el.paused && el.readyState >= 2 && el.currentTime > 0)), {
    timeout: 30000, message: 'One rendered audio node must be actual local playback',
  }).toBeGreaterThanOrEqual(0);
  const audio = audioNodes.nth(await audioNodes.evaluateAll(els => els.findIndex(el => !el.paused && el.readyState >= 2 && el.currentTime > 0)));
  await expect(page.getByTestId('now-playing-title')).toHaveAttribute('data-content-id', audioId);
  expect(playbackReads).toContain(200);
  const original = await audio.elementHandle();
  const before = await audio.evaluate(el => el.currentTime);

  await page.getByRole('button', { name: 'Expand audio', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Shrink audio', exact: true })).toBeVisible();
  await expect(page.getByTestId('np-meta-art')).toBeVisible();
  await expect(page.getByTestId('np-meta-title')).toHaveText(audioTitle);
  await page.getByRole('button', { name: 'Shrink audio', exact: true }).click();
  await expect.poll(() => original.evaluate((el, position) => el.isConnected && !el.paused && el.currentTime > position, before)).toBe(true);
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

test('[STEER.6a/AC2] Stop explicitly says how many queue items were kept', async ({ page }) => {
  await startMovie(page);
  await page.getByTestId('np-stop').click();
  await expect.poll(() => page.locator('video, audio').evaluateAll(els => els.every(el => el.paused || el.ended))).toBe(true);
  const feedback = page.getByText('Queue kept: 1 item', { exact: true });
  await expect(feedback).toBeVisible();
  await expect(feedback).toBeInViewport();
  expect(await feedback.evaluate(el => {
    const box = el.getBoundingClientRect();
    return box.top >= 0 && box.bottom <= innerHeight
      && el.contains(document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2));
  }), 'Queue feedback must not sit under fixed compact controls/navigation').toBe(true);
  await page.getByTestId('now-playing-back').click();
  await expect(feedback).toBeVisible();
  await page.getByTestId('mini-player-open-nowplaying').click();
  await expect(feedback).toBeVisible();
  await expect(page.getByTestId('queue-panel')).toContainText(title);
});

test('[STEER.5a/AC1] volume step buttons change actual playback and show its level', async ({ page }) => {
  const video = await startMovie(page);
  await page.getByTestId('np-volume').focus();
  await page.keyboard.press('End');
  await expect.poll(() => video.evaluate(el => el.volume)).toBe(1);
  await page.getByRole('button', { name: /decrease volume|volume down/i }).click();
  await expect.poll(() => video.evaluate(el => el.volume)).toBeLessThan(1);
  const reduced = await video.evaluate(el => Math.round(el.volume * 100));
  await expect(page.getByTestId('np-volume-level')).toHaveText(`${reduced}%`);
  await page.getByRole('button', { name: /increase volume|volume up/i }).click();
  await expect.poll(() => video.evaluate(el => el.volume)).toBe(1);
  await expect(page.getByTestId('np-volume-level')).toHaveText('100%');
});

test('[STEER.1a/AC3] full local controls hide duplicate compact controls without losing playback', async ({ page }) => {
  const video = await startMovie(page);
  const original = await video.elementHandle();
  const before = await video.evaluate(el => el.currentTime);
  await expect(page.getByTestId('np-toggle')).toBeVisible();
  await expect(page.getByTestId('media-mini-player')).not.toBeVisible();
  await page.getByTestId('now-playing-back').click();
  await expect(page.getByTestId('media-mini-player')).toBeVisible();
  await expect.poll(() => original.evaluate((el, position) => el.isConnected && !el.paused && el.currentTime > position + 0.25, before)).toBe(true);
});

test('[STEER.5a/AC2] chosen playback speed survives Stop and retained-queue restart', async ({ page }) => {
  const video = await startMovie(page);
  await page.getByTestId('np-rate').click();
  await expect.poll(() => video.evaluate(el => el.playbackRate)).toBe(1.25);
  await expect(page.getByTestId('np-rate')).toHaveText('1.25×');
  await page.getByTestId('np-stop').click();
  await expect(page.getByTestId('mini-toggle')).toBeVisible();
  await page.getByTestId('mini-toggle').click();
  const restarted = page.getByTestId('now-playing-host').locator('video');
  await expect(restarted).toHaveCount(1, { timeout: 30000 });
  await expect.poll(() => restarted.evaluate(el => !el.paused && el.readyState >= 2), { timeout: 30000 }).toBe(true);
  const before = await restarted.evaluate(el => el.currentTime);
  await expect.poll(() => restarted.evaluate(el => el.currentTime)).toBeGreaterThan(before + 0.25);
  await expect.poll(() => restarted.evaluate(el => el.playbackRate)).toBe(1.25);
  await expect(page.getByTestId('np-rate')).toHaveText('1.25×');
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
