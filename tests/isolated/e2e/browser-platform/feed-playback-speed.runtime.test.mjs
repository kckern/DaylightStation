import { test, expect } from '@playwright/test';
import { silentWave } from '../../../_fixtures/media/silentWave.mjs';

test.use({ serviceWorkers: 'block', viewport: { width: 390, height: 850 } });

const tracks = ['41', '42'].map(id => ({
  id: 'plex:' + id, contentId: 'plex:' + id, source: 'plex', type: 'track',
  title: 'Track ' + id, image: '/icon-192.png', meta: { playable: true, duration: 30 },
}));

test.beforeEach(async ({ page }) => {
  await page.routeWebSocket('**/*', () => {});
  const audio = silentWave(30);
  await page.route('**/feed-speed-*.wav', route => {
    const range = /^bytes=(\d+)-(\d*)$/.exec(route.request().headers().range || '');
    if (!range) return route.fulfill({ contentType: 'audio/wav', body: audio });
    const first = Number(range[1]);
    const last = range[2] ? Math.min(Number(range[2]), audio.length - 1) : audio.length - 1;
    return route.fulfill({ status: 206, contentType: 'audio/wav',
      headers: { 'accept-ranges': 'bytes', 'content-range': `bytes ${first}-${last}/${audio.length}` },
      body: audio.subarray(first, last + 1),
    });
  });
  await page.route('**/api/**', route => {
    const path = decodeURIComponent(new URL(route.request().url()).pathname);
    const track = tracks.find(item => path.endsWith('/play/' + item.id));
    let json = {};
    if (path.endsWith('/supervision/bootstrap')) json = { enabled: false };
    else if (path.endsWith('/headlines/pages')) json = [];
    else if (path.includes('/scroll/sessions')) json = { items: tracks, sessionId: 'speed', hasMore: false };
    else if (track) json = {
      ...track, format: 'audio', mediaType: 'audio', duration: 30,
      mediaUrl: '/feed-speed-' + track.id.slice(5) + '.wav',
    };
    return route.fulfill({ json });
  });
});

function playTrack(page, id) {
  return page.locator(`[data-feed-item-id="plex:${id}"]`).getByRole('button', { name: 'Play', exact: true }).click();
}

function playingSettings(page, id) {
  return page.evaluate(id => {
    const audio = [...document.querySelectorAll('audio,video')]
      .find(media => media.currentSrc.includes('feed-speed-' + id + '.wav') && !media.paused && media.currentTime > 0);
    return audio ? { speed: audio.playbackRate, volume: audio.volume } : null;
  }, id);
}

test('Feed restores the saved speed and volume and retains a speed change on the replacement track', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('feedPlayer:speed', '1.5');
    localStorage.setItem('feedPlayer:volume', '0.65');
  });
  await page.goto('/feed/scroll');
  await playTrack(page, '41');
  // Native media backends may quantize the volume readback.
  const volume = expect.closeTo(0.65, 4);
  await expect.poll(() => playingSettings(page, '41')).toEqual({ speed: 1.5, volume });
  await page.getByRole('button', { name: 'Playback speed 1.5x' }).click();
  await expect(page.getByRole('button', { name: 'Playback speed 1.75x' })).toBeVisible();
  await expect.poll(() => playingSettings(page, '41')).toEqual({ speed: 1.75, volume });
  await playTrack(page, '42');
  await expect.poll(() => playingSettings(page, '42')).toEqual({ speed: 1.75, volume });

  const original = await page.locator('audio[src$="feed-speed-42.wav"]').elementHandle();
  await page.setViewportSize({ width: 1440, height: 850 });
  await page.getByRole('button', { name: 'Open player: Track 42', exact: true }).press('Enter');
  const dialog = page.getByRole('dialog', { name: 'Track 42', exact: true });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Mute', exact: true }).click();
  await expect.poll(() => original.evaluate(audio => audio.isConnected && audio.volume)).toBe(0);
  await dialog.getByRole('button', { name: 'Unmute', exact: true }).click();
  await expect.poll(() => original.evaluate(audio => audio.isConnected && audio.volume)).toBeCloseTo(0.65, 4);
});

test('Feed uses playable defaults for malformed speed and out-of-range volume', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('feedPlayer:speed', '1.5junk');
    localStorage.setItem('feedPlayer:volume', '1.7');
  });
  await page.goto('/feed/scroll');
  await playTrack(page, '41');
  await expect(page.getByRole('button', { name: 'Playback speed 1x' })).toBeVisible();
  await expect.poll(() => playingSettings(page, '41')).toEqual({ speed: 1, volume: 1 });
});

const readWatched = (page, id) => page.evaluate(id => {
  const raw = localStorage.getItem(`watchedDuration:plex:${id}`);
  return raw === null ? null : JSON.parse(raw);
}, id);

test('Feed applies each legacy or current watched-duration record on its own track', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('watchedDuration:plex:41', '17');
    localStorage.setItem('watchedDuration:plex:42', JSON.stringify({ value: 8, updatedAt: 1 }));
  });
  await page.goto('/feed/scroll');
  await playTrack(page, '41');
  await expect.poll(() => playingSettings(page, '41')).not.toBeNull();
  await expect.poll(async () => (await readWatched(page, '41'))?.value, { timeout: 10000 }).toBeGreaterThanOrEqual(17);
  expect((await readWatched(page, '42')).updatedAt).toBe(1);
  await playTrack(page, '42');
  await expect.poll(() => playingSettings(page, '42')).not.toBeNull();
  await expect.poll(async () => (await readWatched(page, '42'))?.updatedAt, { timeout: 10000 }).toBeGreaterThan(1);
  expect((await readWatched(page, '42')).value).toBeGreaterThanOrEqual(8);
  expect((await readWatched(page, '42')).value).toBeLessThan(17);

  const track = page.locator('audio[src$="feed-speed-42.wav"]');
  await track.evaluate(audio => { audio.currentTime = audio.duration - 0.05; });
  await expect.poll(() => readWatched(page, '42'), { timeout: 10000 }).toBeNull();
  expect((await readWatched(page, '41')).value).toBeGreaterThanOrEqual(17);
});

test('Feed plays with watched-duration storage denied', async ({ page }) => {
  await page.addInitScript(() => {
    window.deniedWatchStorageCalls = [];
    for (const method of ['getItem', 'setItem', 'removeItem']) {
      const real = Storage.prototype[method];
      Storage.prototype[method] = function(key, ...args) {
        if (this === localStorage && String(key).startsWith('watchedDuration:')) {
          window.deniedWatchStorageCalls.push([method, key]);
          throw new DOMException('fixture unavailable', 'SecurityError');
        }
        return real.call(this, key, ...args);
      };
    }
  });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/feed/scroll');
  await playTrack(page, '41');
  await expect.poll(() => playingSettings(page, '41')).not.toBeNull();
  await playTrack(page, '42');
  await expect.poll(() => playingSettings(page, '42')).not.toBeNull();
  await expect.poll(() => page.evaluate(() => window.deniedWatchStorageCalls)).toEqual(expect.arrayContaining([
    ['getItem', 'watchedDuration:plex:41'],
    ['setItem', 'watchedDuration:plex:41'],
    ['getItem', 'watchedDuration:plex:42'],
    ['setItem', 'watchedDuration:plex:42'],
  ]));
  const track = page.locator('audio[src$="feed-speed-42.wav"]');
  await track.evaluate(audio => { audio.currentTime = audio.duration - 0.05; });
  await expect.poll(() => page.evaluate(() => window.deniedWatchStorageCalls))
    .toContainEqual(['removeItem', 'watchedDuration:plex:42']);
  expect(errors).toEqual([]);
});

test('Feed resumes both interrupted tracks at their captured positions', async ({ page }) => {
  await page.goto('/feed/scroll');
  const audio = id => page.locator('audio[src$="feed-speed-' + id + '.wav"]');
  const listen = async (id, seconds) => {
    await expect.poll(() => playingSettings(page, id)).not.toBeNull();
    await expect.poll(() => audio(id).evaluate(el => el.currentTime), { timeout: 10_000 })
      .toBeGreaterThanOrEqual(seconds);
  };
  await playTrack(page, '41');
  await listen('41', 4);
  await playTrack(page, '42');
  await listen('42', 3);
  await page.getByRole('button', { name: 'Resume previous' }).click();
  await expect.poll(() => playingSettings(page, '41')).not.toBeNull();
  expect(await audio('41').evaluate(el => el.currentTime)).toBeGreaterThanOrEqual(4);

  await page.getByRole('button', { name: 'Resume previous' }).click();
  await expect.poll(() => playingSettings(page, '42')).not.toBeNull();
  expect(await audio('42').evaluate(el => el.currentTime)).toBeGreaterThanOrEqual(3);
});

const collectionReads = [
  { stage: 'descriptor', path: '/api/v1/play/plex:41', response: { id: 'plex:41', format: 'list' } },
  { stage: 'queue', path: '/api/v1/queue/plex:41', response: { items: [{ contentId: 'plex:43' }] } },
  { stage: 'child', path: '/api/v1/play/plex:43', response: {
    id: 'plex:43', title: 'Child track', format: 'audio', mediaType: 'audio', duration: 30, mediaUrl: '/feed-speed-43.wav',
  } },
];

async function routeCollection(page, heldStage) {
  const reads = [];
  const release = Promise.withResolvers();
  const settled = Promise.withResolvers();
  let heldRequest;
  let canceled = false;
  page.on('requestfailed', request => {
    if (request === heldRequest) canceled = true;
  });
  await page.route('**/api/**', async route => {
    const request = route.request();
    const url = new URL(request.url());
    const limit = url.searchParams.get('limit');
    const read = collectionReads.find(({ path, stage }) => path === decodeURIComponent(url.pathname)
      && (stage !== 'queue' || limit === '1'));
    if (!read) return route.fallback();
    reads.push({ stage: read.stage, method: request.method(), limit });
    if (read.stage !== heldStage) return route.fulfill({ json: read.response });
    heldRequest = request;
    await release.promise;
    try {
      await route.fulfill({ json: read.response });
    } catch (error) {
      if (!canceled) throw error;
    } finally {
      settled.resolve();
    }
  });
  return { reads, release: release.resolve, settled: settled.promise, isCanceled: () => canceled };
}

test('Feed plays the first child of an active collection', async ({ page }) => {
  const { reads } = await routeCollection(page);
  await page.goto('/feed/scroll');
  await playTrack(page, '41');
  await expect.poll(() => playingSettings(page, '43')).not.toBeNull();
  expect(reads).toEqual([
    { stage: 'descriptor', method: 'GET', limit: null },
    { stage: 'queue', method: 'GET', limit: '1' },
    { stage: 'child', method: 'GET', limit: null },
  ]);
});

for (const [stageIndex, { stage }] of collectionReads.entries()) {
  test(`Feed cancels a replaced collection's ${stage} read while its successor plays`, async ({ page }) => {
    const { reads, release, settled, isCanceled } = await routeCollection(page, stage);
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    try {
      await page.goto('/feed/scroll');
      await playTrack(page, '41');
      await expect.poll(() => reads.at(-1)?.stage).toBe(stage);
      await playTrack(page, '42');
      await expect.poll(() => playingSettings(page, '42')).not.toBeNull();
      await expect.poll(isCanceled).toBe(true);
    } finally {
      release();
    }
    await settled;
    expect(reads.map(read => read.stage)).toEqual(collectionReads.slice(0, stageIndex + 1).map(read => read.stage));
    expect(await playingSettings(page, '42')).not.toBeNull();
    expect(errors).toEqual([]);
  });
}
