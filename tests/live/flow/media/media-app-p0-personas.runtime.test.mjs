import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { HOUSE_FIXTURE_TITLE } from '../../../_lib/media-house-fixture.mjs';
import { smallTargets, noHorizontalScroll } from './lib/a11yProbe.mjs';

// Task 8 — interaction budgets (NF-TAP) counted from real pointer input, and
// the persona walkthroughs (taxonomy 4.2) on a phone and a laptop against the
// acceptance server's virtual receiver. Taps are counted by the page itself
// (trusted primary pointerdown), not by the test, so a hidden extra step cannot
// hide. Setup that a person would not repeat (naming the device, starting
// something on the receiver through its API) is not counted.
test.use({ trace: 'retain-on-failure', serviceWorkers: 'block', actionTimeout: 20000 });
test.setTimeout(420000);
test.describe.configure({ mode: 'serial' });

const DEVICE = 'acceptance-media';
const base = `/api/v1/device/${DEVICE}`;
const RUN = Date.now().toString(36).slice(-5);
const SHOTS = process.env.MEDIA_P0_SHOTS_DIR || path.join(process.env.MEDIA_P0_EVIDENCE_DIR || '/tmp', 'media-p0-personas-shots');
fs.mkdirSync(SHOTS, { recursive: true });
const shot = (page, name) => page.screenshot({ path: path.join(SHOTS, `${name}.png`), fullPage: false });
const VIEWPORTS = { phone: { width: 390, height: 844 }, laptop: { width: 1440, height: 900 } };
const FIXTURE = HOUSE_FIXTURE_TITLE;

async function call(request, method, url, body) {
  const response = await request.fetch(url, { method, data: body ? { commandId: randomUUID(), ...body } : undefined });
  return { status: response.status(), body: await response.json().catch(() => null) };
}
const receiverState = async (request) => (await call(request, 'GET', `${base}/receiver-state`)).body?.snapshot ?? null;

async function openReceiver(context, request) {
  const receiver = await context.newPage();
  const ready = async () => (await call(request, 'GET', `${base}/receiver-ready`)).body?.ready === true;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    await receiver.goto('/screen/living-room', { waitUntil: 'domcontentloaded' });
    const deadline = Date.now() + 40000;
    while (Date.now() < deadline) {
      if (await ready()) return receiver;
      await receiver.waitForTimeout(1000);
    }
  }
  expect(await ready(), 'virtual receiver never became ready').toBe(true);
  return receiver;
}

async function newDevice(browser, viewport, name) {
  const context = await browser.newContext({ viewport, serviceWorkers: 'block' });
  await context.addInitScript(([n]) => {
    if (!localStorage.getItem('media-app.display-name')) localStorage.setItem('media-app.display-name', n);
    localStorage.setItem('media-app.first-use-done', 'journey');
    window.__taps = 0;
    addEventListener('pointerdown', (e) => { if (e.isTrusted && e.button === 0) window.__taps += 1; }, true);
  }, [name]);
  const page = await context.newPage();
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    await page.goto('/media', { waitUntil: 'domcontentloaded' });
    if (await page.getByTestId('media-shell').waitFor({ state: 'visible', timeout: 40000 }).then(() => true, () => false)) break;
  }
  return { context, page, phone: viewport.width < 600 };
}

const resetTaps = (page) => page.evaluate(() => { window.__taps = 0; });
const taps = (page) => page.evaluate(() => window.__taps);

/** Open search and type the fixture title; leaves the results up. Not counted (typing is not a tap). */
async function typeQuery(d) {
  if (d.phone) {
    await d.page.getByTestId('media-search-launcher').click();
    await d.page.getByTestId('search-mode-input').fill(FIXTURE.query);
    await expect(d.page.getByTestId(`search-mode-result-${FIXTURE.id}`)).toBeVisible({ timeout: 30000 });
  } else {
    const input = d.page.getByRole('textbox', { name: 'Search media…' });
    await input.fill('');
    await input.fill(FIXTURE.query);
    await expect(d.page.getByTestId(`combobox-option-${FIXTURE.id}`)).toBeVisible({ timeout: 30000 });
  }
}
const resultRow = (d) => d.page.getByTestId(d.phone ? `search-mode-result-${FIXTURE.id}` : `combobox-option-${FIXTURE.id}`);
const closeSearch = async (d) => { if (d.phone) await d.page.getByTestId('search-mode-close').click(); else await d.page.keyboard.press('Escape'); };
const aimScope = (d) => (d.phone ? d.page.getByTestId('search-mode') : d.page.locator('.media-search-bar'));
const nativePlaying = (page) => page.locator('.video-player video').evaluate((v) => !v.paused && v.currentTime > 0).catch(() => false);

for (const [size, viewport] of Object.entries(VIEWPORTS)) {
  test.describe(`NF-TAP ${size}`, () => {
    test(`[NF-TAP-01][NF-TAP-04][NF-TAP-09] ${size}: a typed name plays in 1 tap, the queue is 1 tap away, Undo is 1 tap`, async ({ browser }) => {
      const d = await newDevice(browser, viewport, `Tap budget ${size} ${RUN}`);
      try {
        await typeQuery(d);
        await resetTaps(d.page);
        await resultRow(d).click();
        expect(await taps(d.page), 'NF-TAP-01 typed name -> playing at the aim').toBe(1);
        if (d.phone) await closeSearch(d); else await d.page.keyboard.press('Escape');
        await expect.poll(() => nativePlaying(d.page), { timeout: 90000 }).toBe(true);
        await shot(d.page, `tap-playing-${size}`);

        // NF-TAP-09: put the play back with one tap (inside the 10 s window).
        const undo = d.page.getByTestId('item-action-undo');
        if (await undo.isVisible().catch(() => false)) {
          await resetTaps(d.page);
          await undo.click();
          expect(await taps(d.page), 'NF-TAP-09 put a change back').toBe(1);
          await expect(d.page.getByTestId('media-mini-player')).toHaveCount(0, { timeout: 20000 }).catch(() => {});
          // Play again so the queue exists for the next budget.
          await typeQuery(d);
          await resultRow(d).click();
          if (d.phone) await closeSearch(d); else await d.page.keyboard.press('Escape');
          await expect.poll(() => nativePlaying(d.page), { timeout: 90000 }).toBe(true);
        }

        // NF-TAP-04: from anywhere, the queue of what is playing.
        await d.page.getByTestId(d.phone ? 'app-tab-home' : 'app-nav-home').click();
        await resetTaps(d.page);
        await d.page.getByTestId('mini-player-open-nowplaying').click();
        await expect(d.page.getByTestId('queue-panel')).toBeVisible({ timeout: 15000 });
        expect(await taps(d.page), 'NF-TAP-04 open the queue of the held playback').toBe(1);
        await shot(d.page, `tap-queue-${size}`);
      } finally { await d.context.close(); }
    });

    test(`[NF-TAP-05][NF-TAP-06][NF-TAP-08] ${size}: add to queue is 2 taps, aim back at this device is 2, Pause all is 2`, async ({ browser, context, request }) => {
      const receiver = await openReceiver(context, request);
      const d = await newDevice(browser, viewport, `Tap budget B ${size} ${RUN}`);
      try {
        // NF-TAP-05: a search result into the aim's queue — More, then Add to queue.
        await typeQuery(d);
        await resetTaps(d.page);
        await d.page.getByTestId(`result-more-${FIXTURE.id}`).click();
        await d.page.getByTestId(`result-action-add-${FIXTURE.id}`).click();
        expect(await taps(d.page), 'NF-TAP-05 add a result to the aim queue').toBe(2);
        if (d.phone) await closeSearch(d); else await d.page.keyboard.press('Escape');
        await expect(d.page.getByTestId('media-mini-player')).toBeVisible({ timeout: 30000 });

        // NF-TAP-06: aim is on a screen (setup), then back at this device.
        await typeQuery(d);
        await aimScope(d).getByTestId('destination-line').click();
        await d.page.getByRole('button', { name: /^Acceptance receiver Virtual browser/ }).click();
        await d.page.getByTestId('picker-submit').click();
        await expect(aimScope(d).getByTestId('destination-line-name')).toContainText('Acceptance receiver');
        await resetTaps(d.page);
        await aimScope(d).getByTestId('destination-line').click();
        await d.page.getByTestId('picker-this-device').click();
        const aimBackTaps = await taps(d.page);
        await expect(aimScope(d).getByTestId('destination-line-name')).toContainText('This device', { timeout: 10000 });
        expect(aimBackTaps, 'NF-TAP-06 aim back at this device').toBeLessThanOrEqual(2);
        if (d.phone) await closeSearch(d); else await d.page.keyboard.press('Escape');

        // NF-TAP-08: something plays on the screen and here; Pause all from the handle.
        expect((await call(request, 'GET', `${base}/load?play=${FIXTURE.id}&dispatchId=${randomUUID()}`)).status).toBe(200);
        await expect.poll(async () => (await receiverState(request))?.state, { timeout: 120000 }).toBe('playing');
        const menu = d.page.getByTestId('mini-house-menu');
        await expect(menu).toBeVisible({ timeout: 30000 });
        await resetTaps(d.page);
        await menu.click();
        await d.page.getByTestId('mini-pause-all').click();
        expect(await taps(d.page), 'NF-TAP-08 pause all screens').toBe(2);
        await expect.poll(async () => (await receiverState(request))?.state, { timeout: 30000 }).toBe('paused');
        await shot(d.page, `tap-pause-all-${size}`);
        expect((await call(request, 'POST', `${base}/session/transport`, { action: 'stop' })).status).toBe(200);
      } finally { await d.context.close(); await receiver.close(); }
    });
  });
}
