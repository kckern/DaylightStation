import { readFile } from 'node:fs/promises';
import { test, expect } from '@playwright/test';

const film = '/api/v1/content-filter/77';
// A synthetic 16×16 black WebM clip keeps this decoder on the same timeline in each browser.
const video = await readFile(new URL('../../../_fixtures/media/video/content-filter-preview.webm', import.meta.url));
const row = {
  id: 'cue:w1', peekId: 'w1', members: ['w1'], kind: 'words', group: 'profanity', label: 'Fixture cue', modality: 'said',
  in: 10, out: 10.5, effect: 'bleep', unsure: [], reviewed: null, verdict: null,
};

function review(title, filmLevel) {
  return {
    title, certification: { level: 'machine' }, audit: { ok: true, fresh: true }, rows: [row],
    reviewed: 0, total: 1, job: null, signOff: { ready: false, missing: [], parent: null },
    bleepLevel: { profile: 0.3, film: filmLevel },
  };
}

test('Admin retries the saved bleep settings readback before replaying the cue', async ({ page }) => {
  const seeks = () => page.evaluate(() => window.reviewSeeks.filter(time => time === 6));
  await page.addInitScript(() => {
    const currentTime = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'currentTime');
    window.reviewSeeks = [];
    Object.defineProperty(HTMLMediaElement.prototype, 'currentTime', {
      ...currentTime, set(value) { window.reviewSeeks.push(value); currentTime.set.call(this, value); },
    });
  });
  const writes = [];
  let cascadeReads = 0;
  await page.routeWebSocket('**/*', () => {});
  // Seeking needs byte ranges: the review player retries a jump until the decoder lands on it.
  await page.route('**/review-fixture.webm', route => {
    const range = /^bytes=(\d+)-(\d*)$/.exec(route.request().headers().range || '');
    if (!range) return route.fulfill({ body: video, contentType: 'video/webm', headers: { 'accept-ranges': 'bytes' } });
    const first = Number(range[1]);
    const last = range[2] ? Math.min(Number(range[2]), video.length - 1) : video.length - 1;
    return route.fulfill({
      status: 206,
      contentType: 'video/webm',
      headers: { 'accept-ranges': 'bytes', 'content-range': `bytes ${first}-${last}/${video.length}` },
      body: video.subarray(first, last + 1),
    });
  });
  await page.route('**/api/**', route => {
    const request = route.request();
    const path = decodeURIComponent(new URL(request.url()).pathname);
    if (path.endsWith('/supervision/bootstrap')) return route.fulfill({ json: { enabled: false } });
    if (path === film + '/review') {
      return route.fulfill({ json: review('Fixture film', writes.at(-1)?.settings.bleepLevel ?? null) });
    }
    if (path === film + '/settings' && request.method() === 'PUT') {
      writes.push(request.postDataJSON());
      return route.fulfill({ json: {} });
    }
    if (path === film) {
      cascadeReads++;
      if (cascadeReads === 2) return route.fulfill({ status: 503, json: { error: 'Preview temporarily unavailable' } });
      return route.fulfill({ json: {
        edl: { cues: [], scenes: [] }, certification: { level: 'machine' }, profile: { name: 'family' },
      } });
    }
    if (path === '/api/v1/play/plex:77') return route.fulfill({ json: {
      id: 'plex:77', contentId: 'plex:77', assetId: 'plex:77', source: 'plex', type: 'movie',
      format: 'video', mediaType: 'video', mediaUrl: '/review-fixture.webm', title: 'Fixture film', duration: 15,
    } });
    return route.fulfill({ json: {} });
  });
  await page.goto('/admin/content/filter/77');
  await expect.poll(() => cascadeReads).toBe(1);
  await expect.poll(() => page.locator('.cf-review__player video').evaluate(node => node.readyState)).toBeGreaterThanOrEqual(1);
  await page.keyboard.press('ArrowRight');
  // The player retries a jump until the decoder lands on it, so a replay is one or more seeks.
  await expect.poll(seeks).not.toEqual([]);
  await page.evaluate(() => { window.reviewSeeks = []; });

  const refused = page.waitForResponse(response => new URL(response.url()).pathname === film && response.status() === 503);
  await page.keyboard.press(']');
  await refused;
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  expect(writes).toEqual([{ settings: { bleepLevel: 0.35 } }]);
  expect(await seeks()).toEqual([]);
  await expect(page.getByText('Bleep level saved. The preview could not refresh.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Bleep 35 %', exact: true })).toBeVisible();
  await expect(page.locator('body')).toBeFocused();
  await page.keyboard.press('Enter');
  await expect.poll(() => cascadeReads).toBe(3);
  await expect.poll(seeks).not.toEqual([]);
  expect(writes).toHaveLength(1);
});

test('Admin refreshes the reopened film after its earlier settings write is acknowledged', async ({ page }) => {
  const first = 'First fixture film';
  const second = 'Second fixture film';
  const reads = [];
  const writes = [];
  const release = Promise.withResolvers();
  let filmLevel = null;
  await page.routeWebSocket('**/*', () => {});
  await page.route('**/api/**', async route => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path.endsWith('/supervision/bootstrap')) return route.fulfill({ json: { enabled: false } });
    if (path === '/api/v1/content-filter/library') {
      return route.fulfill({ json: { films: [
        { ratingKey: '77', title: first, stage: 'parent' },
        { ratingKey: '88', title: second, stage: 'parent' },
      ] } });
    }
    if (path === film + '/review') {
      reads.push('77');
      return route.fulfill({ json: review(first, filmLevel) });
    }
    if (path === '/api/v1/content-filter/88/review') {
      reads.push('88');
      return route.fulfill({ json: review(second, 0.6) });
    }
    if (path === film + '/settings' && request.method() === 'PUT') {
      const body = request.postDataJSON();
      writes.push(body);
      await release.promise;
      filmLevel = body.settings.bleepLevel;
      return route.fulfill({ json: {} });
    }
    return route.fulfill({ json: {} });
  });

  await page.goto('/admin/content/filter/77');
  const level = value => page.getByRole('button', { name: `Bleep ${value} %`, exact: true });
  const openFilm = async title => {
    await page.getByRole('link', { name: /Films$/ }).click();
    await page.getByRole('link', { name: title }).click();
  };
  try {
    await expect(level(30)).toBeVisible();
    await page.keyboard.press(']');
    await expect.poll(() => writes).toEqual([{ settings: { bleepLevel: 0.35 } }]);
    await openFilm(second);
    await expect(level(60)).toBeVisible();
    await openFilm(first);
    await expect(level(30)).toBeVisible();
    expect(reads).toEqual(['77', '88', '77']);
  } finally {
    release.resolve();
  }
  await expect(level(35)).toBeVisible();
  expect(reads).toEqual(['77', '88', '77', '77']);
  expect(writes).toHaveLength(1);
});
