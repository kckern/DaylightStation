import { readFile } from 'node:fs/promises';
import { test, expect } from '@playwright/test';

const film = '/api/v1/content-filter/77';
// A synthetic 16×16 black WebM clip keeps this decoder on the same timeline in each browser.
const video = await readFile(new URL('../../../_fixtures/media/video/content-filter-preview.webm', import.meta.url));

test('Admin retries the saved bleep settings readback before replaying the cue', async ({ page }) => {
  const seeks = () => page.evaluate(() => window.reviewSeeks.filter(time => time === 6));
  await page.addInitScript(() => {
    const currentTime = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'currentTime');
    window.reviewSeeks = [];
    Object.defineProperty(HTMLMediaElement.prototype, 'currentTime', {
      ...currentTime, set(value) { window.reviewSeeks.push(value); currentTime.set.call(this, value); },
    });
  });
  const row = {
    id: 'cue:w1', peekId: 'w1', members: ['w1'], kind: 'words', group: 'profanity', label: 'Fixture cue', modality: 'said',
    in: 10, out: 10.5, effect: 'bleep', unsure: [], reviewed: null, verdict: null,
  };
  const writes = [];
  let cascadeReads = 0;
  await page.routeWebSocket('**/*', () => {});
  await page.route('**/review-fixture.webm', route => route.fulfill({ body: video, contentType: 'video/webm' }));
  await page.route('**/api/**', route => {
    const request = route.request();
    const path = decodeURIComponent(new URL(request.url()).pathname);
    if (path.endsWith('/supervision/bootstrap')) return route.fulfill({ json: { enabled: false } });
    if (path === film + '/review') return route.fulfill({ json: {
      title: 'Fixture film', certification: { level: 'machine' }, audit: { ok: true, fresh: true }, rows: [row],
      reviewed: 0, total: 1, job: null, signOff: { ready: false, missing: [], parent: null },
      bleepLevel: { profile: 0.3, film: writes.at(-1)?.settings.bleepLevel ?? null },
    } });
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
  await expect.poll(seeks).toHaveLength(1);
  await page.evaluate(() => { window.reviewSeeks = []; });

  const refused = page.waitForResponse(response => new URL(response.url()).pathname === film && response.status() === 503);
  await page.keyboard.press(']');
  await refused;
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  expect(writes).toEqual([{ settings: { bleepLevel: 0.35 } }]);
  expect(await seeks()).toEqual([]);
  await expect(page.getByText('Bleep level saved. The preview could not refresh.')).toBeVisible();
  await expect(page.getByText('bleep 35%', { exact: false })).toBeVisible();
  await expect(page.locator('body')).toBeFocused();
  await page.keyboard.press('Enter');
  await expect.poll(() => cascadeReads).toBe(3);
  await expect.poll(seeks).toEqual([6]);
  expect(writes).toHaveLength(1);
});
