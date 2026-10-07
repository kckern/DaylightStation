import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { markFirstUseDone } from './lib/firstUse.mjs';

// STEER.4a/AC3 — live content shows that it is live and offers "Go to live"
// instead of a position, on this device and on a steered screen, at the three
// device sizes. The live source is the acceptance server's real-time sliding-window
// HLS channel (`fixture:live`: ffmpeg writes it as it is requested); `isLive` rides its play descriptor exactly as a real live
// source's would. Ordinary pointer input only; the API calls only start the
// screen or read what it reports.
test.beforeEach(async ({ context }) => { await markFirstUseDone(context); });
test.use({ trace: 'retain-on-failure', serviceWorkers: 'block' });
test.setTimeout(240000);
test.describe.configure({ mode: 'serial' });

const DEVICE = 'acceptance-media';
const base = `/api/v1/device/${DEVICE}`;
const LIVE = 'fixture:live';
const EVIDENCE = process.env.MEDIA_P0_FEATURES_EVIDENCE_DIR || path.resolve('test-results', 'media-p0-features');
fs.mkdirSync(EVIDENCE, { recursive: true });
const VIEWPORTS = {
  phone: { width: 390, height: 844 },
  tablet: { width: 820, height: 1180 },
  laptop: { width: 1440, height: 900 },
};

async function call(request, method, url, body) {
  const response = await request.fetch(url, { method, data: body ? { commandId: randomUUID(), ...body } : undefined });
  return { status: response.status(), body: await response.json().catch(() => null) };
}
const state = async (request) => (await call(request, 'GET', `${base}/receiver-state`)).body?.snapshot ?? null;

async function openMedia(page, url, readyTestId) {
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    try { await expect(page.getByTestId(readyTestId)).toBeVisible({ timeout: 40000 }); return; } catch (error) { if (attempt === 3) throw error; }
  }
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

// How far the shown picture is behind the live edge (the end of what can be shown).
const gapBehindLive = (page) => page.evaluate(() => {
  const el = document.querySelector('video');
  if (!el) return null;
  const edge = el.seekable.length ? el.seekable.end(el.seekable.length - 1)
    : Math.max(Number.isFinite(el.duration) ? el.duration : 0, el.buffered.length ? el.buffered.end(el.buffered.length - 1) : 0);
  return { gap: edge - el.currentTime, paused: el.paused, time: el.currentTime, edge };
});

for (const [size, viewport] of Object.entries(VIEWPORTS)) {
  test(`[STEER.4a/AC3] ${size}: live content shows LIVE and Go to live brings it back to the live edge`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await openMedia(page, `/media?play=${LIVE}`, 'mini-player-open-nowplaying');
    await expect(page.getByTestId('mini-player-open-nowplaying')).toContainText('Acceptance live channel', { timeout: 40000 });
    await page.getByTestId('mini-player-open-nowplaying').click();

    // It says it is live, and offers no position to drag.
    await expect(page.getByText('LIVE', { exact: true })).toBeVisible({ timeout: 30000 });
    await expect(page.getByTestId('np-seek')).toHaveCount(0);
    const goLive = page.getByTestId('np-go-live');
    await expect(goLive).toBeVisible();
    await expect(goLive).toHaveText('Go to live');
    const box = await goLive.boundingBox();
    expect(box.height, '44 px target').toBeGreaterThanOrEqual(44);

    // Playing at the edge, then fall behind by pausing, and resume.
    await expect.poll(async () => (await gapBehindLive(page))?.paused, { timeout: 60000 }).toBe(false);
    await page.getByTestId('np-toggle').click();
    await expect.poll(async () => (await gapBehindLive(page))?.paused, { timeout: 15000 }).toBe(true);
    await page.waitForTimeout(8000);
    await page.getByTestId('np-toggle').click();
    await expect.poll(async () => (await gapBehindLive(page))?.paused, { timeout: 30000 }).toBe(false);
    await expect.poll(async () => (await gapBehindLive(page))?.gap, {
      timeout: 30000, message: 'after the pause the picture should be well behind the live edge',
    }).toBeGreaterThan(4);
    const behind = await gapBehindLive(page);
    await page.screenshot({ path: path.join(EVIDENCE, `live-${size}-behind.png`) });

    // Go to live: back at the edge and playing.
    await goLive.click();
    await expect.poll(async () => (await gapBehindLive(page))?.gap, { timeout: 30000 }).toBeLessThan(2.5);
    const back = await gapBehindLive(page);
    expect(back.time).toBeGreaterThan(behind.time + 3);
    await expect.poll(async () => (await gapBehindLive(page))?.paused, { timeout: 15000 }).toBe(false);
    await page.screenshot({ path: path.join(EVIDENCE, `live-${size}-at-live.png`) });
  });
}

test('[STEER.4a/AC3] a steered screen showing live content offers Go to live in its Remote and returns to the edge', async ({ browser, context, request }) => {
  const receiver = await openReceiver(context, request);
  const senderContext = await browser.newContext({ viewport: VIEWPORTS.tablet, serviceWorkers: 'block' });
  await markFirstUseDone(senderContext);
  const sender = await senderContext.newPage();
  try {
    expect((await call(request, 'GET', `${base}/load?play=${LIVE}&dispatchId=${randomUUID()}`)).body?.ok).toBe(true);
    await expect.poll(async () => {
      await receiver.evaluate(() => document.title);
      return (await state(request))?.state === 'playing' && (await gapBehindLive(receiver))?.paused === false;
    }, { timeout: 120000 }).toBe(true);

    await openMedia(sender, '/media', 'media-shell');
    await sender.getByTestId('app-nav-fleet').click();
    await sender.getByTestId(`fleet-peek-${DEVICE}`).click();
    const panel = sender.getByTestId('peek-panel');
    await expect(panel).toBeVisible();
    await expect(panel.getByText('LIVE', { exact: true })).toBeVisible({ timeout: 60000 });
    await expect(panel.getByTestId('np-seek')).toHaveCount(0);
    const goLive = panel.getByTestId('np-go-live');
    await expect(goLive).toBeVisible();

    // Fall behind: pause the screen from here, wait, resume.
    await panel.getByTestId('np-toggle').click();
    await expect.poll(async () => (await gapBehindLive(receiver))?.paused, { timeout: 30000 }).toBe(true);
    await receiver.waitForTimeout(8000);
    await panel.getByTestId('np-toggle').click();
    await expect.poll(async () => (await gapBehindLive(receiver))?.paused, { timeout: 30000 }).toBe(false);
    await expect.poll(async () => (await gapBehindLive(receiver))?.gap, { timeout: 30000 }).toBeGreaterThan(4);
    const behind = await gapBehindLive(receiver);

    await goLive.click();
    await expect.poll(async () => (await gapBehindLive(receiver))?.gap, { timeout: 30000 }).toBeLessThan(2.5);
    expect((await gapBehindLive(receiver)).time).toBeGreaterThan(behind.time + 3);
    await sender.screenshot({ path: path.join(EVIDENCE, 'live-remote-tablet.png') });
  } finally {
    await senderContext.close();
    await receiver.close();
  }
});
