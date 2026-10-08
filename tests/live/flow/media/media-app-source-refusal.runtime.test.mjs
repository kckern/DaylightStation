import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { A, ITEM, call, openReceiver, resetControls, stopReceiver, receiverState } from './lib/receivers.mjs';
import { resetHouseholdAt } from './lib/household.mjs';

// RELY.7a (source refusal): Plex refuses a media file for a few seconds (the NFS
// `Permission denied (13)` window that made `remote-controls` "Faith audio" fail).
// The Player must ask /media-source/check, wait, and start the audio the moment the
// file reads again, instead of giving up on the first 503. The acceptance server used
// to answer that check 403, which is why only this fixture title failed, and only
// when Plex happened to refuse it.
test.use({ trace: 'retain-on-failure', serviceWorkers: 'block', actionTimeout: 30000 });
test.setTimeout(180000);
test.beforeEach(async ({ request, baseURL }) => { await resetHouseholdAt(request, baseURL); });

test('[RELY.7a] a track Plex refuses for a few seconds starts playing once it reads again', async ({ browser, request }) => {
  const receiver = await openReceiver(browser, request, A);
  await resetControls(request, A);
  const REFUSED_FOR_MS = 6000;
  let firstRefusal = null;
  let refusals = 0;
  const checks = [];
  receiver.page.on('response', (response) => {
    if (response.url().includes('/api/v1/media-source/check')) checks.push(response.status());
  });
  await receiver.page.route('**/api/v1/proxy/plex/stream/584614**', async (route) => {
    firstRefusal ??= Date.now();
    if (Date.now() - firstRefusal < REFUSED_FOR_MS) {
      refusals += 1;
      return route.fulfill({
        status: 503, contentType: 'application/json', headers: { 'retry-after': '5', 'cache-control': 'no-store' },
        body: JSON.stringify({ error: 'Media file temporarily unreadable', reason: 'source-unreadable' }),
      });
    }
    return route.continue();
  });
  // While Plex refuses the file the source check says so too (the real incident: stream and
  // check both see the refusal); once it reads again the check goes to the acceptance
  // server's own read-only probe, which must answer 200 rather than the old 403.
  await receiver.page.route('**/api/v1/media-source/check', async (route) => {
    if (firstRefusal && Date.now() - firstRefusal < REFUSED_FOR_MS) {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ state: 'unreadable', steps: [] }) });
    }
    return route.continue();
  });
  const loaded = await call(request, 'GET', `/api/v1/device/${A}/load?play=${encodeURIComponent(ITEM.FAITH)}&dispatchId=${randomUUID()}`);
  expect(loaded.status).toBe(200);
  const audio = receiver.page.locator('.audio-player audio');
  await expect.poll(() => audio.evaluate((el) => !el.paused && el.readyState >= 2 && el.currentTime > 0).catch(() => false),
    { timeout: 90000, message: 'the refused track starts once the file reads again' }).toBe(true);
  expect(refusals, 'the file really was refused first').toBeGreaterThan(0);
  expect(checks.length, 'the Player asked the source check').toBeGreaterThan(0);
  expect(checks.every((status) => status === 200), `source check answered ${checks.join(',')}`).toBe(true);
  expect((await receiverState(request, A))?.currentItem?.contentId).toBe(ITEM.FAITH);
  await stopReceiver(request, A);
  await receiver.context.close();
});
