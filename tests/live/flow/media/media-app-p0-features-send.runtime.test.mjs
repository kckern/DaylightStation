import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { markFirstUseDone } from './lib/firstUse.mjs';
import { searchFor, isPhone } from './lib/mediaDriver.mjs';

// Sending something to another screen while this device plays (P0 features):
//   PLACE.6a/AC2  item-level Play on… asks Move or Keep, pre-set to the remembered choice
//   HOUSE.2a/AC2+AC4, PLACE.7a/AC1+AC2+AC4  the house row's Move here, and its failure
//
// Against the acceptance server's one virtual receiver (a REAL mounted screen
// page) and its offline fixture screen. This device plays the acceptance live
// channel (a real HLS stream) so something is genuinely playing HERE; the item
// sent is a real catalog title. Ordinary pointer input only; API calls only
// start the screen or read what it reports.
test.beforeEach(async ({ context }) => { await markFirstUseDone(context); });
test.use({ trace: 'retain-on-failure', serviceWorkers: 'block' });
test.setTimeout(420000);
test.describe.configure({ mode: 'serial' });

const DEVICE = 'acceptance-media';
const OFFLINE = 'acceptance-offline';
const base = `/api/v1/device/${DEVICE}`;
const ARRIVAL = 'plex:55854';
const DISCLOSURE = 'plex:697368';
const HOSPITAL = 'plex:266151';
const KEEPY_UPPY = 'plex:266152';
const EVIDENCE = process.env.MEDIA_P0_FEATURES_EVIDENCE_DIR || path.resolve('test-results', 'media-p0-features');
fs.mkdirSync(EVIDENCE, { recursive: true });
const VIEWPORTS = {
  phone: { width: 390, height: 844 },
  laptop: { width: 1440, height: 900 },
};

async function call(request, method, url, body) {
  const response = await request.fetch(url, { method, data: body ? { commandId: randomUUID(), ...body } : undefined });
  return { status: response.status(), body: await response.json().catch(() => null) };
}
const state = async (request) => (await call(request, 'GET', `${base}/receiver-state`)).body?.snapshot ?? null;
const routineLoad = (request, query) => call(request, 'GET', `${base}/load?${query}&dispatchId=${randomUUID()}`);

async function openMedia(page, url) {
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    if (await page.getByTestId('media-shell').waitFor({ state: 'visible', timeout: 40000 }).then(() => true, () => false)) return;
  }
  await expect(page.getByTestId('media-shell')).toBeVisible({ timeout: 1000 });
}

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

const media = (page) => page.evaluate(() => {
  const el = document.querySelector('video');
  return el ? { paused: el.paused, time: el.currentTime } : null;
});

/** This device plays the live channel; wait until it is genuinely playing. */
async function playLiveHere(page, url = '/media?play=fixture:live') {
  await openMedia(page, url);
  await expect(page.getByTestId('mini-player-open-nowplaying')).toContainText('Acceptance live channel', { timeout: 40000 });
  await expect.poll(async () => (await media(page))?.paused, { timeout: 60000 }).toBe(false);
}

/** The phone's full-screen search stays open after a send; close it to reach the handle. */
async function closeSearchIfOpen(page) {
  const close = page.getByTestId('search-mode-close');
  if (await close.isVisible().catch(() => false)) await close.click();
}

/** Reload the app: the local session comes back paused; Resume plays it again. */
async function reloadAndResumeHere(page) {
  await openMedia(page, '/media');
  await expect(page.getByTestId('mini-player-open-nowplaying')).toContainText('Acceptance live channel', { timeout: 40000 });
  await page.getByTestId('mini-toggle').click();
  await expect.poll(async () => (await media(page))?.paused, { timeout: 60000 }).toBe(false);
}

async function openPlayOn(page, text, id) {
  await searchFor(page, text);
  await page.getByTestId(`result-more-${id}`).click();
  await page.getByTestId(`result-action-playOn-${id}`).click();
  await expect(page.getByTestId('dispatch-target-picker')).toBeVisible();
}

for (const [size, viewport] of Object.entries(VIEWPORTS)) {
  test(`[PLACE.6a/AC2] ${size}: Play on… asks Move or Keep; Keep keeps this device playing, Move stops it only after the screen confirms playing; the choice is remembered`, async ({ context, page, request }) => {
    await page.setViewportSize(viewport);
    const receiver = await openReceiver(context, request);
    await playLiveHere(page);

    // ---- Keep ----
    await openPlayOn(page, 'Arrival', ARRIVAL);
    const move = page.getByTestId('picker-mode-transfer');
    const keep = page.getByTestId('picker-mode-fork');
    await expect(move).toContainText(/stop playing here/i);
    await expect(keep).toHaveText('Keep playing here too');
    await expect(move).toHaveAttribute('aria-checked', 'true'); // pre-set to the usual (default) choice
    const box = await keep.boundingBox();
    expect(box.height, '44 px target').toBeGreaterThanOrEqual(44);
    await keep.click();
    await expect(keep).toHaveAttribute('aria-checked', 'true');
    await page.getByTestId(`picker-device-${DEVICE}`).click();
    await page.screenshot({ path: path.join(EVIDENCE, `play-on-ask-${size}.png`) });
    await page.getByTestId('picker-submit').click();
    await expect.poll(async () => (await state(request))?.currentItem?.contentId, { timeout: 120000 }).toBe(ARRIVAL);
    await expect.poll(async () => (await state(request))?.state, { timeout: 120000 }).toBe('playing');
    // This device did exactly what the choice said: it kept playing.
    await page.waitForTimeout(4000);
    expect((await media(page))?.paused).toBe(false);
    await expect(page.getByTestId('mini-toggle')).toHaveAccessibleName('Pause');

    // ---- Remembered, then Move ----
    await reloadAndResumeHere(page);
    await openPlayOn(page, 'Disclosure Day', DISCLOSURE);
    await expect(page.getByTestId('picker-mode-fork')).toHaveAttribute('aria-checked', 'true'); // last choice, shown before confirming
    await page.getByTestId('picker-mode-transfer').click();
    await expect(page.getByTestId('picker-mode-transfer')).toHaveAttribute('aria-checked', 'true');
    await page.getByTestId(`picker-device-${DEVICE}`).click();
    await page.getByTestId('picker-submit').click();
    await expect.poll(async () => (await state(request))?.currentItem?.contentId, { timeout: 120000 }).toBe(DISCLOSURE);
    await expect.poll(async () => (await media(page))?.paused ?? true, { timeout: 30000, message: 'Move should stop this device once the screen accepted' }).toBe(true);
    await expect(page.getByTestId('mini-state')).not.toContainText(/Playing on/);
    await page.screenshot({ path: path.join(EVIDENCE, `play-on-moved-${size}.png`) });

    // ---- Failure-safe: a screen that cannot take it leaves this device playing ----
    // Move stopped this device (queue kept); play the channel here again.
    await closeSearchIfOpen(page);
    await page.getByTestId('mini-toggle').click();
    await expect.poll(async () => (await media(page))?.paused, { timeout: 60000 }).toBe(false);
    await openPlayOn(page, 'Arrival', ARRIVAL);
    await page.getByTestId('picker-mode-transfer').click();
    await page.getByTestId(`picker-device-${OFFLINE}`).click();
    await page.getByTestId('picker-submit').click();
    await expect(page.getByTestId('dispatch-tray')).toContainText('Acceptance guest room TV', { timeout: 30000 });
    // That screen never plays it (it is not there), so Move must not have stopped this device.
    await page.waitForTimeout(20000);
    await expect(page.getByTestId('dispatch-tray')).not.toContainText(/Playing on Acceptance guest room TV/);
    expect((await media(page))?.paused, 'this device keeps playing when the screen never confirmed').toBe(false);
    await expect(page.getByTestId('mini-toggle')).toHaveAccessibleName('Pause');
    await receiver.close();
  });
}

test('[HOUSE.2a/AC2+AC4, PLACE.7a/AC1+AC2] the house row\'s Move here brings that screen\'s playback here, same item, same moment, same queue; the screen stops', async ({ browser, context, request }) => {
  const receiver = await openReceiver(context, request);
  const senderContext = await browser.newContext({ viewport: VIEWPORTS.laptop, serviceWorkers: 'block' });
  await markFirstUseDone(senderContext);
  const sender = await senderContext.newPage();
  try {
    // The screen plays Hospital with Keepy Uppy queued behind it, built the way a person would:
    // aim at the screen, play one, add the next.
    await openMedia(sender, '/media');
    await sender.getByTestId('cast-target-chip').click();
    await sender.getByTestId(`cast-target-checkbox-${DEVICE}`).check();
    await sender.getByTestId('cast-target-chip').click();
    const search = sender.getByRole('textbox', { name: 'Search media…' });
    await search.fill('hospital');
    await sender.getByTestId(`combobox-option-${HOSPITAL}`).click();
    await expect.poll(async () => (await state(request))?.currentItem?.contentId, { timeout: 120000 }).toBe(HOSPITAL);
    await expect.poll(async () => (await state(request))?.state, { timeout: 120000 }).toBe('playing');
    await search.fill('keepy uppy');
    await sender.getByTestId(`result-more-${KEEPY_UPPY}`).click();
    await sender.getByTestId(`result-action-add-${KEEPY_UPPY}`).click();
    await expect.poll(async () => (await state(request))?.queue?.items?.map((i) => i.contentId), { timeout: 30000 }).toEqual([HOSPITAL, KEEPY_UPPY]);
    await receiver.waitForTimeout(6000); // let it be somewhere past the start
    const before = await state(request);

    await sender.getByTestId('app-nav-fleet').click();
    const button = sender.getByTestId(`fleet-takeover-${DEVICE}`);
    await expect(button).toBeVisible({ timeout: 30000 });
    await expect(button).toBeEnabled();
    await expect(button).toHaveText('Move here');
    const box = await button.boundingBox();
    expect(box.height, '44 px target').toBeGreaterThanOrEqual(44);
    await sender.screenshot({ path: path.join(EVIDENCE, 'house-row-move-here.png') });
    await button.click();
    // The outcome says what happened, naming the item.
    await expect(sender.getByTestId('dispatch-tray')).toContainText(/(Moving|Moved) Hospital here/, { timeout: 60000 });

    // This device starts the same item, at the same moment, with the same queue.
    await expect(sender.getByTestId('mini-player-open-nowplaying')).toContainText('Hospital', { timeout: 120000 });
    await expect.poll(async () => (await media(sender))?.paused, { timeout: 60000 }).toBe(false);
    const here = await media(sender);
    expect(here.time, 'continues from where the screen was').toBeGreaterThanOrEqual(before.position - 2);
    await expect.poll(async () => (await state(request))?.state, { timeout: 60000 }).not.toBe('playing');
    await sender.getByTestId('mini-player-open-nowplaying').click();
    await expect(sender.getByTestId('np-queue-item-1')).toContainText('Keepy Uppy').catch(async () => {
      await expect(sender.getByTestId('queue-panel')).toContainText('Keepy Uppy');
    });
  } finally {
    await senderContext.close();
    await receiver.close();
  }
});

test('[PLACE.7a/AC4] if it cannot move, the person is told why and the other screen keeps playing', async ({ browser, context, request }) => {
  const receiver = await openReceiver(context, request);
  const senderContext = await browser.newContext({ viewport: VIEWPORTS.laptop, serviceWorkers: 'block' });
  await markFirstUseDone(senderContext);
  const sender = await senderContext.newPage();
  try {
    expect((await routineLoad(request, `play=${HOSPITAL}`)).body?.ok).toBe(true);
    await expect.poll(async () => (await state(request))?.state, { timeout: 120000 }).toBe('playing');
    // This device's network refuses the stream: it genuinely cannot start the item here.
    await sender.route('**/api/v1/proxy/plex/stream/**', (route) => route.abort());
    await openMedia(sender, '/media');
    await sender.getByTestId('app-nav-fleet').click();
    await sender.getByTestId(`fleet-takeover-${DEVICE}`).click();
    await expect(sender.getByTestId('dispatch-tray')).toContainText(/Couldn.t move Hospital here/, { timeout: 90000 });
    await expect(sender.getByTestId('dispatch-tray')).toContainText(/the other screen keeps playing/i);
    await sender.screenshot({ path: path.join(EVIDENCE, 'move-here-failed.png') });
    expect((await state(request))?.state, 'the other screen keeps playing').toBe('playing');
    expect((await state(request))?.currentItem?.contentId).toBe(HOSPITAL);
  } finally {
    await senderContext.close();
    await receiver.close();
  }
});
