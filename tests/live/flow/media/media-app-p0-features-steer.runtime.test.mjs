import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { markFirstUseDone } from './lib/firstUse.mjs';

// Steering a screen from anywhere (P0 features), against a REAL mounted virtual
// receiver (a screen page) and the real Media app:
//   STEER.1a/AC4  the handle also covers the screen last sent to or steered
//   RELY.5a/AC4   a failure the steered screen raises on its own reaches the sender
test.beforeEach(async ({ context }) => { await markFirstUseDone(context); });
test.use({ trace: 'retain-on-failure', serviceWorkers: 'block' });
test.setTimeout(420000);
test.describe.configure({ mode: 'serial' });

const DEVICE = 'acceptance-media';
const base = `/api/v1/device/${DEVICE}`;
const HOSPITAL = 'plex:266151';
const FAITH = 'plex:584614';
const KEEPY_UPPY = 'plex:266152';
const EVIDENCE = process.env.MEDIA_P0_FEATURES_EVIDENCE_DIR || path.resolve('test-results', 'media-p0-features');
fs.mkdirSync(EVIDENCE, { recursive: true });
const VIEWPORTS = { phone: { width: 390, height: 844 }, laptop: { width: 1440, height: 900 } };

async function call(request, method, url, body) {
  const response = await request.fetch(url, { method, data: body ? { commandId: randomUUID(), ...body } : undefined });
  return { status: response.status(), body: await response.json().catch(() => null) };
}
const state = async (request) => (await call(request, 'GET', `${base}/receiver-state`)).body?.snapshot ?? null;

async function openMedia(page, url = '/media') {
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

async function goTo(page, area) {
  const rail = page.getByTestId(`app-nav-${area}`);
  if (await rail.isVisible().catch(() => false)) await rail.click();
  else await page.getByTestId(`app-tab-${area}`).click();
}

/** Send an item to the receiver from its house row (a real person's tap sequence). */
async function sendFromHouseRow(page, query, id) {
  await goTo(page, 'fleet');
  await expect(page.getByTestId(`fleet-card-${DEVICE}`)).toBeVisible({ timeout: 30000 });
  await page.getByTestId(`fleet-play-${DEVICE}`).click();
  await page.getByTestId(`fleet-play-input-${DEVICE}`).fill(query);
  await page.getByTestId(`fleet-play-result-${id}`).click();
}

for (const [size, viewport] of Object.entries(VIEWPORTS)) {
  test(`[STEER.1a/AC4] ${size}: after sending to a screen, its handle follows me through the app and pauses/resumes it in one tap`, async ({ context, page, request }) => {
    await page.setViewportSize(viewport);
    const receiver = await openReceiver(context, request);
    await openMedia(page);
    await expect(page.getByTestId('screen-handle')).toHaveCount(0); // nothing sent yet

    await sendFromHouseRow(page, 'hospital', HOSPITAL);
    await expect.poll(async () => (await state(request))?.state, { timeout: 120000 }).toBe('playing');

    // Another part of the app: the handle for the screen is still there, naming it.
    await goTo(page, 'browse');
    const handle = page.getByTestId('screen-handle');
    await expect(handle).toBeVisible({ timeout: 30000 });
    await expect(handle.getByTestId('screen-handle-name')).toContainText('Acceptance receiver');
    await expect(handle).toContainText('Hospital');
    const toggle = handle.getByTestId('screen-handle-toggle');
    const box = await toggle.boundingBox();
    expect(box.height, '44 px target').toBeGreaterThanOrEqual(44);
    await page.screenshot({ path: path.join(EVIDENCE, `screen-handle-${size}.png`) });

    // "Pausing the TV when the phone rings is one tap."
    await toggle.click();
    await expect.poll(async () => (await state(request))?.state, { timeout: 30000 }).toBe('paused');
    await expect(handle.getByTestId('screen-handle-name')).toContainText('Paused');
    await expect(toggle).toHaveAccessibleName('Resume Acceptance receiver');
    await toggle.click();
    await expect.poll(async () => (await state(request))?.state, { timeout: 30000 }).toBe('playing');

    // Tapping the title opens that screen's full controls, and the bar steps aside.
    await handle.getByTestId('screen-handle-open').click();
    await expect(page.getByTestId('peek-panel')).toBeVisible();
    await expect(page.getByTestId('screen-handle')).toHaveCount(0);
    await receiver.close();
  });
}

test('[RELY.5a/AC4] laptop: a skip the steered screen makes on its own is reported on the sender, naming the item, the screen and what plays instead', async ({ context, page, request }) => {
  await page.setViewportSize(VIEWPORTS.laptop);
  const receiver = await openReceiver(context, request);
  // The screen's own network hands back something its audio element cannot play for Faith
  // (the failure happens on the screen, not on the sender).
  await receiver.route('**/api/v1/proxy/plex/stream/584614**', (route) => route.fulfill({
    status: 415, contentType: 'text/plain', body: 'Unsupported Media Type',
  }));
  await openMedia(page);
  // Hospital plays on the screen (sent from its house row); Faith and Keepy Uppy are queued behind it,
  // the way a person adds: aim at the screen, Add to queue.
  await sendFromHouseRow(page, 'hospital', HOSPITAL);
  await expect.poll(async () => (await state(request))?.state, { timeout: 120000 }).toBe('playing');
  await page.getByTestId('cast-target-chip').click();
  await page.getByTestId(`cast-target-checkbox-${DEVICE}`).check();
  await page.getByTestId('cast-target-chip').click();
  const search = page.getByRole('textbox', { name: 'Search media…' });
  for (const [query, id] of [['faith', FAITH], ['keepy uppy', KEEPY_UPPY]]) {
    await search.fill(query);
    await page.getByTestId(`result-more-${id}`).click();
    await page.getByTestId(`result-action-add-${id}`).click();
  }
  await page.keyboard.press('Escape');
  await expect.poll(async () => (await state(request))?.queue?.items?.map((i) => i.contentId), { timeout: 30000 }).toEqual([HOSPITAL, FAITH, KEEPY_UPPY]);

  // The person steers the screen on to the next item; Faith then fails ON THE SCREEN, by itself.
  await page.getByTestId('screen-handle-open').click();
  await page.getByTestId('np-next').click();
  await goTo(page, 'browse');
  const tray = page.getByTestId('dispatch-tray');
  await expect(tray).toContainText(/Faith (stopped making progress|skipped)|Couldn.t keep playing Faith/, { timeout: 240000 });
  await expect(tray).toContainText('Acceptance receiver');
  await expect(tray).toContainText('Now playing Keepy Uppy');
  await page.screenshot({ path: path.join(EVIDENCE, 'remote-problem-laptop.png') });
  await expect.poll(async () => (await state(request))?.currentItem?.contentId, { timeout: 60000 }).toBe(KEEPY_UPPY);
  await receiver.close();
});
