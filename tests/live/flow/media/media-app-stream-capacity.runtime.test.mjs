import { test, expect } from '@playwright/test';

// Explicit operational probe, not a short movie seek or full story verdict.
test.use({ viewport: { width: 1440, height: 900 }, trace: 'on', actionTimeout: 10000 });
test.setTimeout(300000);

test('verified 60fps source sustains virtual playback under the selected branch policy', async ({ page }, testInfo) => {
  test.skip(process.env.MEDIA_CAPACITY_PROBE !== '1', 'Run explicitly and serialize decoder load');
  const samples = [];
  const requests = [];
  const mints = [];
  const deviceCommands = [];
  const hlsSessions = new Set();
  const stoppedSessions = new Map();
  await page.route('**/api/v1/device/**', async route => {
    if (route.request().method() !== 'GET' || /\/load(?:\?|$)/.test(route.request().url())) {
      deviceCommands.push(route.request().method());
      return route.abort('blockedbyclient');
    }
    return route.continue();
  });
  page.on('response', response => {
    const url = new URL(response.url());
    if (url.origin === new URL(page.url()).origin) {
      const session = /^\/api\/v1\/proxy\/plex\/video\/:\/transcode\/universal\/session\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\//i.exec(url.pathname);
      const sessionId = session?.[1].toLowerCase();
      if (sessionId && response.ok() && !hlsSessions.has(sessionId)) {
        hlsSessions.add(sessionId);
        // Safe correlation for a read-only host process sample during the run.
        console.log(JSON.stringify({ ownedHlsSession: sessionId }));
      }
      if (url.pathname === '/api/v1/proxy/plex/video/:/transcode/universal/stop') {
        stoppedSessions.set(url.searchParams.get('session')?.toLowerCase(), response.status());
      }
    }
    if (/\/api\/v1\/proxy\/plex\/stream\//.test(url.pathname)) {
      mints.push({ path: url.pathname, origin: response.headers()['x-media-acceptance-mint'],
        policy: response.headers()['x-media-acceptance-policy'] });
    }
  });
  page.on('requestfinished', request => {
    const url = new URL(request.url());
    if (!/\/api\/v1\/proxy\/plex\//.test(url.pathname)) return;
    requests.push({ path: url.pathname, timing: request.timing(),
      session: url.searchParams.get('X-Plex-Session-Identifier') ?? url.searchParams.get('session') });
  });
  try {
    await page.goto('/media');
    const search = page.getByRole('textbox', { name: 'Search media…' });
    await expect(search).toBeVisible({ timeout: 30000 });
    await search.fill('Mario Kart Arcade GP');
    const result = page.getByRole('option').filter({ hasText: 'Mario Kart Arcade GP',
      has: page.getByTestId('result-more-plex:675677') });
    await expect(result).toHaveCount(1, { timeout: 15000 });
    // Verify exact catalog identity before issuing the ordinary Play tap.
    await expect(result.locator('[data-testid="result-more-plex:675677"]')).toHaveCount(1);
    await result.click();
    await page.getByTestId('mini-player-open-nowplaying').click();
    const video = page.getByTestId('now-playing-host').locator('video');
    await expect(video).toHaveCount(1, { timeout: 30000 });
    await video.evaluate(el => {
      window.__capacityEvents = [];
      for (const event of ['playing', 'waiting', 'stalled', 'seeking', 'seeked', 'pause', 'error']) {
        el.addEventListener(event, () => window.__capacityEvents.push({ event,
          at: performance.now(), position: el.currentTime, ready: el.readyState }));
      }
    });
    await expect.poll(() => video.evaluate(el => !el.paused && !el.seeking && el.readyState >= 2), {
      timeout: 60000, message: 'Actual benchmark decoder must become ready',
    }).toBe(true);
    const firstPosition = await video.evaluate(el => el.currentTime);
    await expect.poll(() => video.evaluate(el => el.currentTime)).toBeGreaterThan(firstPosition + 0.25);
    if (process.env.MEDIA_EXPECT_HLS === '1') {
      await expect.poll(() => page.evaluate(() => (window.__hlsAcceptance ?? []).some(row => row.kind === 'INIT_PTS_FOUND'))).toBe(true);
      expect(hlsSessions.size).toBeGreaterThan(0);
    }
    const steadyStart = Date.now();
    while (Date.now() - steadyStart < 180000) {
      samples.push(await video.evaluate(el => {
        const quality = el.getVideoPlaybackQuality?.();
        const ranges = Array.from({ length: el.buffered.length }, (_, i) => [el.buffered.start(i), el.buffered.end(i)]);
        const active = ranges.find(([start, end]) => start <= el.currentTime && end >= el.currentTime);
        return { at: performance.now(), position: el.currentTime, ready: el.readyState,
          seeking: el.seeking, paused: el.paused, bufferAhead: active ? active[1] - el.currentTime : 0,
          totalFrames: quality?.totalVideoFrames ?? null, droppedFrames: quality?.droppedVideoFrames ?? null };
      }));
      await page.waitForTimeout(1000);
    }
    const elapsed = (samples.at(-1).at - samples[0].at) / 1000;
    const advanced = samples.at(-1).position - samples[0].position;
    expect(advanced, 'Advancement must track wall time across the sustained window').toBeGreaterThan(elapsed - 5);
    await page.getByTestId('np-toggle').click();
    await expect.poll(() => video.evaluate(el => el.paused)).toBe(true);
    const beforeSeek = await video.evaluate(el => el.currentTime);
    await page.getByRole('button', { name: 'Forward 10 seconds' }).click();
    await expect.poll(() => video.evaluate(el => ({ paused: el.paused, seeking: el.seeking,
      ready: el.readyState >= 2 })), { timeout: 30000 })
      .toEqual({ paused: true, seeking: false, ready: true });
    expect(Math.abs((await video.evaluate(el => el.currentTime)) - beforeSeek - 10)).toBeLessThan(2);
    expect(mints.length).toBeGreaterThan(0);
    expect(mints.every(mint => mint.path.endsWith('/675677') && mint.origin === 'worktree')).toBe(true);
    expect(mints.every(mint => mint.policy === (process.env.MEDIA_ACCEPTANCE_POLICY || 'branch'))).toBe(true);
    expect(deviceCommands).toEqual([]);
  } finally {
    const events = await page.evaluate(() => window.__capacityEvents ?? []).catch(() => []);
    await testInfo.attach('stream-capacity-observations', {
      body: JSON.stringify({ samples, events, mints, requests, deviceCommands }, null, 2),
      contentType: 'application/json',
    });
    const stop = page.getByTestId('np-stop');
    if (await stop.isVisible().catch(() => false)) await stop.click().catch(() => {});
    if (process.env.MEDIA_EXPECT_HLS === '1' && hlsSessions.size) {
      await expect.poll(() => [...hlsSessions].every(id => {
        const status = stoppedSessions.get(id);
        return status >= 200 && status < 300;
      }), { timeout: 15000 }).toBe(true);
      await testInfo.attach('owned-hls-stop-responses', {
        body: JSON.stringify([...hlsSessions].map(id => ({ sessionId: id, status: stoppedSessions.get(id) }))),
        contentType: 'application/json',
      });
    }
  }
});
