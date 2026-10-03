import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

// Batch B — the handle and the one controls surface, against REAL mounted
// screen pages served by `tests/_lib/media-redesign-server.mjs` (BASE_URL):
// two virtual receivers (`acceptance-media`, `acceptance-media-b`); no
// household screen is commanded. Setup (starting something on a receiver) may
// use the device API; every criterion under test is exercised through the
// Media app with ordinary pointer/keyboard input.
test.use({ trace: 'retain-on-failure', serviceWorkers: 'block' });
test.setTimeout(420000);
test.describe.configure({ mode: 'serial' });

const A = 'acceptance-media';
const B = 'acceptance-media-b';
const A_NAME = 'Acceptance receiver';
const B_NAME = 'Acceptance second';
const SCREEN = { [A]: 'living-room', [B]: 'acceptance-second' };
const DISCLOSURE = 'plex:697368';
const EP_HOSPITAL = 'plex:266151';
const EP_KEEPY = 'plex:266152';
const FAITH = 'plex:584614';

const VIEWPORTS = {
  phone: { width: 390, height: 844 },
  tablet: { width: 820, height: 1180 },
  laptop: { width: 1440, height: 900 },
};
const SHOTS = process.env.MEDIA_BATCH_B_SHOTS || path.join(process.env.MEDIA_P0_EVIDENCE_DIR || '/tmp', 'media-batch-b-shots');
fs.mkdirSync(SHOTS, { recursive: true });
const shot = (page, name) => page.screenshot({ path: path.join(SHOTS, `${name}.png`), fullPage: false });

async function call(request, method, url, body, headers = undefined) {
  const response = await request.fetch(url, { method, data: body ? { commandId: randomUUID(), ...body } : undefined, headers });
  const json = await response.json().catch(() => null);
  return { status: response.status(), body: json };
}
const receiverState = async (request, id) => (await call(request, 'GET', `/api/v1/device/${id}/receiver-state`)).body?.snapshot ?? null;

async function openReceiver(browser, request, id) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 }, serviceWorkers: 'block' });
  const page = await context.newPage();
  const ready = async () => (await call(request, 'GET', `/api/v1/device/${id}/receiver-ready`)).body?.ready === true;
  // Always open the page: a receiver closed by the previous journey can still
  // read as ready for a moment (its socket close not yet processed).
  let mounted = false;
  for (let attempt = 1; attempt <= 3 && !mounted; attempt += 1) {
    await page.goto(`/screen/${SCREEN[id]}`, { waitUntil: 'domcontentloaded' });
    const deadline = Date.now() + 40000;
    while (Date.now() < deadline && !mounted) {
      mounted = (await page.locator('#root *').count().catch(() => 0)) > 0 && await ready();
      if (!mounted) await page.waitForTimeout(1000);
    }
  }
  expect(mounted, `virtual receiver ${id} never became ready`).toBe(true);
  // Give the old page's socket time to be gone, so commands reach this one.
  await page.waitForTimeout(1500);
  return { context, page };
}

async function startOn(request, id, contentId, { queue = [] } = {}) {
  const loaded = await call(request, 'GET', `/api/v1/device/${id}/load?play=${encodeURIComponent(contentId)}&dispatchId=${randomUUID()}`);
  expect(loaded.status).toBe(200);
  await expect.poll(async () => {
    const snap = await receiverState(request, id);
    return snap?.state === 'playing' && snap?.currentItem?.contentId === contentId;
  }, { timeout: 120000 }).toBe(true);
  // The ordinary add path (a load with `queue=`), the way any device adds.
  for (const next of queue) {
    expect((await call(request, 'GET', `/api/v1/device/${id}/load?queue=${encodeURIComponent(next)}&op=add&dispatchId=${randomUUID()}`)).status).toBe(200);
    await expect.poll(async () => (await receiverState(request, id))?.queue?.items?.some((it) => it.contentId === next), { timeout: 30000 }).toBe(true);
  }
}

async function resetControls(request, id) {
  for (const [p, body] of [['add-only', { enabled: false }], ['end-of-queue', { mode: 'stop' }], ['stop-after-current', { enabled: false }]]) {
    await call(request, 'PUT', `/api/v1/device/${id}/session/${p}`, body);
  }
  await call(request, 'POST', `/api/v1/device/${id}/session/sleep-timer/cancel`, {});
}

async function stopReceiver(request, id) {
  await call(request, 'POST', `/api/v1/device/${id}/session/transport`, { action: 'stop' });
}

// A cold dev server optimizes dependencies on its first Media load; warm it
// once so no journey measures bootstrap instead of behaviour.
test.beforeAll(async ({ browser }) => {
  const context = await browser.newContext({ viewport: VIEWPORTS.laptop, serviceWorkers: 'block' });
  const page = await context.newPage();
  await gotoMedia(page);
  await context.close();
});

// Opening a dev-server page can lose module fetches and park the page in the
// app's chunk-reload cooldown (see screen-session-controls journey). That is
// bootstrap, not behaviour: navigation is retried a bounded number of times;
// the journey still fails if the Media shell never mounts.
async function gotoMedia(page) {
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    await page.goto('/media', { waitUntil: 'domcontentloaded' });
    if (await page.getByTestId('media-shell').isVisible({ timeout: 45000 }).catch(() => false)) return;
  }
  await expect(page.getByTestId('media-shell')).toBeVisible();
}

// A tap at 99% of the position bar: a few seconds before the end of a short episode.
async function seekNearEnd(page, scope) {
  const track = scope.getByTestId('np-seek');
  await expect(track).toBeVisible({ timeout: 30000 });
  await expect.poll(async () => Number(await track.getAttribute('aria-valuemax')), { timeout: 30000 }).toBeGreaterThan(0);
  const box = await track.boundingBox();
  await page.mouse.click(box.x + box.width * 0.99, box.y + box.height / 2);
}

async function openRemote(page, id, viewport) {
  await gotoMedia(page);
  const nav = viewport.width < 768 ? page.getByTestId('app-tab-fleet') : page.getByTestId('app-nav-fleet');
  await expect(nav).toBeVisible({ timeout: 30000 });
  await nav.click();
  await expect(page.getByTestId(`fleet-peek-${id}`)).toBeVisible({ timeout: 30000 });
  await page.getByTestId(`fleet-peek-${id}`).click();
  await expect(page.getByTestId('peek-panel')).toBeVisible();
  await expect(page.getByTestId('session-controls-panel')).toBeVisible();
}

for (const [label, viewport] of Object.entries(VIEWPORTS)) {
  test(`STEER.1b/PLAY.10a/STEER.13b/STEER.10a — a screen's Remote has the same session controls, one step each (${label})`, async ({ browser, request }) => {
    const receiver = await openReceiver(browser, request, A);
    await resetControls(request, A);
    await startOn(request, A, EP_HOSPITAL);
    const context = await browser.newContext({ viewport, serviceWorkers: 'block' });
    const page = await context.newPage();
    await openRemote(page, A, viewport);
    const panel = page.getByTestId('session-controls-panel');

    // Add only: one step, and the screen publishes it (PLAY.10a/AC1).
    await expect(panel.getByTestId('add-only-toggle')).toHaveText('Add only: off');
    await panel.getByTestId('add-only-toggle').click();
    await expect(panel.getByTestId('add-only-toggle')).toHaveText('Add only: on', { timeout: 15000 });
    await expect.poll(async () => (await receiverState(request, A))?.controls?.addOnly, { timeout: 15000 }).toBe(true);

    // Stop after this one, from a Remote (STEER.13b/AC2).
    await panel.getByTestId('stop-after-current').click();
    await expect(panel.getByTestId('stop-after-current')).toHaveAttribute('aria-pressed', 'true', { timeout: 15000 });
    await expect.poll(async () => (await receiverState(request, A))?.controls?.stopAfterCurrent, { timeout: 15000 }).toBe(true);

    // Sleep timer: minutes, shown with time left (STEER.10a/AC1 remote).
    await panel.getByTestId('sleep-timer-button').click();
    await expect(page.getByTestId('sleep-option-end')).toBeVisible();
    await page.getByTestId('sleep-option-30').click();
    await expect(panel.getByTestId('sleep-timer-left')).toHaveText(/^Sleep in (30:00|29:\d\d)$/, { timeout: 15000 });
    await expect.poll(async () => (await receiverState(request, A))?.controls?.sleepTimer?.minutes, { timeout: 15000 }).toBe(30);

    // End of queue, at the bottom of the queue, with the current choice (STEER.13a/AC1–2).
    const choice = page.getByTestId('queue-end-choice');
    await choice.scrollIntoViewIfNeeded();
    await expect(choice.getByTestId('queue-end-stop')).toHaveAttribute('aria-checked', 'true');
    await choice.getByTestId('queue-end-similar').click();
    await expect(choice.getByTestId('queue-end-similar')).toHaveAttribute('aria-checked', 'true', { timeout: 15000 });
    await expect.poll(async () => (await receiverState(request, A))?.controls?.endOfQueue, { timeout: 15000 }).toBe('similar');

    // Anyone can turn Add only off (PLAY.10a/AC4).
    await panel.scrollIntoViewIfNeeded();
    await panel.getByTestId('add-only-toggle').click();
    await expect(panel.getByTestId('add-only-toggle')).toHaveText('Add only: off', { timeout: 15000 });
    await panel.getByTestId('sleep-timer-button').click();
    await page.getByTestId('sleep-option-off').click();
    await expect(panel.getByTestId('sleep-timer-button')).toHaveText('Sleep timer', { timeout: 15000 });
    await panel.scrollIntoViewIfNeeded();
    await shot(page, `remote-session-controls-${label}`);
    // Nothing is hidden by width: every control is in the viewport's reach.
    for (const id of ['sleep-timer-button', 'stop-after-current', 'add-only-toggle']) {
      const box = await panel.getByTestId(id).boundingBox();
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(viewport.width);
      expect(box.height).toBeGreaterThanOrEqual(44);
    }

    await resetControls(request, A);
    await stopReceiver(request, A);
    await context.close();
    await receiver.context.close();
  });
}

test('RELY.4b/STEER.1b — a pause from this Remote leaves a note on the screen; any Remote offers Put it back, which restores item, spot and queue', async ({ browser, request }) => {
  const receiver = await openReceiver(browser, request, A);
  await resetControls(request, A);
  await startOn(request, A, DISCLOSURE, { queue: [EP_HOSPITAL] });
  const before = await receiverState(request, A);
  const context = await browser.newContext({ viewport: VIEWPORTS.laptop, serviceWorkers: 'block' });
  const page = await context.newPage();
  await openRemote(page, A, VIEWPORTS.laptop);

  // Ordinary Pause on the Remote.
  await page.getByTestId('peek-panel').getByTestId('np-toggle').click();
  await expect.poll(async () => (await receiverState(request, A))?.state, { timeout: 20000 }).toBe('paused');
  // The screen itself names the change and where it came from (STEER.1b/AC5, RELY.4b/AC1).
  await expect(receiver.page.getByTestId('screen-note-label')).toHaveText(/^Paused by .+/, { timeout: 15000 });
  await expect(receiver.page.getByTestId('screen-note-put-back')).toBeVisible();
  // ... and so does any device's Remote for that screen (RELY.4b/AC2).
  const note = page.getByTestId('screen-notes');
  await expect(note.getByTestId('remote-note-label').first()).toHaveText(/^Paused by .+/, { timeout: 15000 });
  await shot(page, 'remote-note-put-back-laptop');
  await shot(receiver.page, 'screen-note-on-receiver');

  // Something else replaces it, then Put it back from the Remote (RELY.4b/AC3).
  await call(request, 'POST', `/api/v1/device/${A}/session/transport`, { action: 'play' });
  await expect.poll(async () => (await receiverState(request, A))?.state, { timeout: 20000 }).toBe('playing');
  await page.getByTestId('peek-panel').getByTestId('np-toggle').click();
  await expect.poll(async () => (await receiverState(request, A))?.state, { timeout: 20000 }).toBe('paused');
  await expect(note.getByTestId('remote-note-put-back').first()).toBeVisible({ timeout: 15000 });
  const pausedAt = (await receiverState(request, A))?.position;
  // Another start replaces it (an automation: a load with no device named).
  expect((await call(request, 'GET', `/api/v1/device/${A}/load?play=${EP_KEEPY}&dispatchId=${randomUUID()}`)).status).toBe(200);
  await expect.poll(async () => (await receiverState(request, A))?.currentItem?.contentId, { timeout: 60000 }).toBe(EP_KEEPY);
  // A newer command owns the screen now; the earlier note's offer is gone,
  // so act on the newest note (the replace) instead.
  await expect(note.getByTestId('remote-note-label').first()).toHaveText(/^Replaced by .+/, { timeout: 15000 });
  await note.getByTestId('remote-note-put-back').first().click();
  await expect.poll(async () => {
    const snap = await receiverState(request, A);
    return snap?.currentItem?.contentId === DISCLOSURE
      && Math.abs((snap?.position ?? 0) - pausedAt) <= 10
      && snap?.queue?.items?.map((it) => it.contentId).join(',') === before.queue.items.map((it) => it.contentId).join(',');
  }, { timeout: 60000 }).toBe(true);
  await expect(page.getByTestId('dispatch-tray')).toContainText(`Put back what was playing on ${A_NAME}`, { timeout: 15000 });

  await stopReceiver(request, A);
  await context.close();
  await receiver.context.close();
});

test('PLAY.10a/AC2 — with Add only on, Play from this device is added and says "Added … (Add only is on)" with its place in line', async ({ browser, request }) => {
  const receiver = await openReceiver(browser, request, A);
  await resetControls(request, A);
  await startOn(request, A, DISCLOSURE);
  expect((await call(request, 'PUT', `/api/v1/device/${A}/session/add-only`, { enabled: true })).status).toBe(200);
  const context = await browser.newContext({ viewport: VIEWPORTS.laptop, serviceWorkers: 'block' });
  const page = await context.newPage();
  await gotoMedia(page);
  // Aim at the receiver with the ordinary chip, then Play a search result.
  await expect(page.getByTestId('cast-target-chip')).toBeVisible({ timeout: 30000 });
  await page.getByTestId('cast-target-chip').click();
  await page.getByTestId('cast-mode-fork').check();
  await page.getByTestId(`cast-target-checkbox-${A}`).check();
  await page.getByTestId('cast-target-chip').click();
  const search = page.getByRole('textbox', { name: 'Search media…' });
  await search.fill('Keepy Uppy');
  await page.getByTestId(`combobox-option-${EP_KEEPY}`).click();
  const tray = page.getByTestId('dispatch-tray');
  await expect(tray).toContainText(`Added Keepy Uppy to ${A_NAME} (Add only is on)`, { timeout: 60000 });
  await expect(tray).toContainText(/2nd in line/);
  const snap = await receiverState(request, A);
  expect(snap.currentItem.contentId).toBe(DISCLOSURE);
  expect(snap.queue.items.map((it) => it.contentId)).toContain(EP_KEEPY);
  await shot(page, 'add-only-added-laptop');
  await resetControls(request, A);
  await stopReceiver(request, A);
  await context.close();
  await receiver.context.close();
});

test('STEER.13b/AC1 — a screen at the end of an episode shows the countdown on its Remote, which can cancel it', async ({ browser, request }) => {
  const receiver = await openReceiver(browser, request, A);
  await resetControls(request, A);
  await startOn(request, A, EP_HOSPITAL, { queue: [EP_KEEPY] });
  const context = await browser.newContext({ viewport: VIEWPORTS.phone, serviceWorkers: 'block' });
  const page = await context.newPage();
  await openRemote(page, A, VIEWPORTS.phone);
  // Ordinary seek to just before the end: a tap near the end of the Remote's position bar.
  await seekNearEnd(page, page.getByTestId('peek-panel'));
  await expect.poll(async () => (await receiverState(request, A))?.controls?.countdown?.next?.contentId, { timeout: 60000 }).toBe(EP_KEEPY);
  const banner = page.getByTestId('countdown-banner');
  await expect(banner).toContainText('Next: Keepy Uppy in', { timeout: 15000 });
  await shot(page, 'remote-countdown-phone');
  await banner.getByTestId('countdown-cancel').click();
  await expect(banner).toBeHidden({ timeout: 15000 });
  await page.waitForTimeout(11000);
  const snap = await receiverState(request, A);
  expect(snap.controls.countdown).toBeNull();
  expect(snap.currentItem?.contentId ?? snap.queue.items[snap.queue.currentIndex]?.contentId ?? null).not.toBe(EP_KEEPY);
  await stopReceiver(request, A);
  await context.close();
  await receiver.context.close();
});

test('STEER.1b/AC7 — Add to this queue opens the one search pointed at that screen, adds once, and the aim stays', async ({ browser, request }) => {
  const receiver = await openReceiver(browser, request, A);
  await resetControls(request, A);
  await startOn(request, A, DISCLOSURE);
  for (const [label, viewport] of [['phone', VIEWPORTS.phone], ['laptop', VIEWPORTS.laptop]]) {
    const context = await browser.newContext({ viewport, serviceWorkers: 'block' });
    const page = await context.newPage();
    await openRemote(page, A, viewport);
    const aimBefore = await page.getByTestId('aim-label').first().textContent();
    await page.getByTestId('peek-add-to-queue').click();
    const searchMode = page.getByTestId('search-mode');
    await expect(searchMode).toBeVisible();
    await expect(searchMode.getByTestId('search-add-to-banner')).toContainText(`Adding to the queue on ${A_NAME}`);
    await searchMode.getByTestId('search-mode-input').fill('Keepy Uppy');
    await expect(searchMode.getByTestId(`search-mode-result-${EP_KEEPY}`)).toBeVisible({ timeout: 30000 });
    await shot(page, `add-to-this-queue-${label}`);
    await searchMode.getByTestId(`search-mode-result-${EP_KEEPY}`).click();
    await expect(searchMode).toBeHidden({ timeout: 10000 });
    await expect(page.getByTestId('peek-panel')).toBeVisible();
    await expect(page.getByTestId('dispatch-tray')).toContainText(`Added Keepy Uppy to ${A_NAME}`, { timeout: 60000 });
    await expect.poll(async () => (await receiverState(request, A))?.queue?.items?.filter((it) => it.contentId === EP_KEEPY).length, { timeout: 30000 })
      .toBe(label === 'phone' ? 1 : 2);
    expect((await receiverState(request, A)).currentItem.contentId).toBe(DISCLOSURE);
    await expect(page.getByTestId('aim-label').first()).toHaveText(aimBefore);
    await context.close();
  }
  await stopReceiver(request, A);
  await receiver.context.close();
});

test('PLACE.9a — Move to… from a screen\'s Remote: to the other screen (it picks up, the original stops), then to this device', async ({ browser, request }) => {
  const ra = await openReceiver(browser, request, A);
  const rb = await openReceiver(browser, request, B);
  await resetControls(request, A);
  await stopReceiver(request, B);
  await startOn(request, A, DISCLOSURE);
  const context = await browser.newContext({ viewport: VIEWPORTS.tablet, serviceWorkers: 'block' });
  const page = await context.newPage();
  await openRemote(page, A, VIEWPORTS.tablet);
  await page.getByTestId('peek-move-to').click();
  await expect(page.getByTestId('move-to-local')).toHaveText('This device');
  await expect(page.getByTestId(`move-to-${B}`)).toContainText(B_NAME);
  await shot(page, 'move-to-menu-tablet');
  const atMove = (await receiverState(request, A))?.position ?? 0;
  await page.getByTestId(`move-to-${B}`).click();
  // One outcome, named with the destination (it lingers 8 s once confirmed).
  await expect(page.getByTestId('dispatch-tray')).toContainText(`Moved Disclosure Day to ${B_NAME}`, { timeout: 90000 });
  await expect.poll(async () => {
    const b = await receiverState(request, B);
    return b?.currentItem?.contentId === DISCLOSURE && ['playing', 'paused'].includes(b?.state) ? b.position : null;
  }, { timeout: 90000 }).toBeGreaterThanOrEqual(Math.max(0, atMove - 2));
  await expect.poll(async () => (await receiverState(request, A))?.currentItem?.contentId ?? null, { timeout: 30000 }).toBeNull();
  await expect(ra.page.getByTestId('screen-note-label')).toHaveText(/^Moved by .+/, { timeout: 15000 });
  // Both screens' states update in the house overview (PLACE.9a/AC3).
  await page.getByTestId('peek-back').click();
  await expect(page.getByTestId(`fleet-state-${B}`)).toHaveText(/Playing|Paused/, { timeout: 30000 });
  await expect(page.getByTestId(`fleet-state-${A}`)).not.toHaveText(/Playing/, { timeout: 30000 });
  await shot(page, 'move-house-overview-tablet');

  // From B's Remote, Move to… this device.
  await page.getByTestId(`fleet-peek-${B}`).click();
  await page.getByTestId('peek-move-to').click();
  await page.getByTestId('move-to-local').click();
  await expect(page.getByTestId('now-playing-view')).toBeVisible({ timeout: 30000 });
  await expect(page.getByTestId('now-playing-title')).toHaveAttribute('data-content-id', DISCLOSURE);
  await expect.poll(async () => (await receiverState(request, B))?.currentItem?.contentId ?? null, { timeout: 30000 }).toBeNull();
  const local = page.getByTestId('now-playing-host').locator('video');
  await expect.poll(() => local.evaluate((node) => node.currentTime), { timeout: 60000 }).toBeGreaterThan(Math.max(0, atMove - 2));
  await expect(rb.page.getByTestId('screen-note-label')).toHaveText(/^Moved by .+/, { timeout: 15000 });
  await page.getByTestId('np-stop').click();
  await context.close();
  await ra.context.close();
  await rb.context.close();
});

test('PLACE.4a — several screens: labelled, aim names both, same-room drift warning, per-screen outcomes, Add to queue to each, Line up with the other', async ({ browser, request }) => {
  const ra = await openReceiver(browser, request, A);
  const rb = await openReceiver(browser, request, B);
  await resetControls(request, A);
  await stopReceiver(request, A);
  await stopReceiver(request, B);
  const context = await browser.newContext({ viewport: VIEWPORTS.phone, serviceWorkers: 'block' });
  const page = await context.newPage();
  await gotoMedia(page);
  await page.getByTestId('media-search-launcher').click();
  const searchMode = page.getByTestId('search-mode');
  await searchMode.getByTestId('destination-line').click();
  await expect(page.getByTestId('destination-sheet')).toBeVisible();
  await expect(page.getByTestId('picker-multi-toggle')).toHaveText('Choose several screens');
  await page.getByTestId('picker-multi-toggle').click();
  await page.getByTestId(`picker-device-${A}`).click();
  await page.getByTestId(`picker-device-${B}`).click();
  await expect(page.getByTestId('picker-drift-warning')).toContainText(`${A_NAME} and ${B_NAME} are both in Acceptance room`, { timeout: 15000 });
  await shot(page, 'several-screens-drift-phone');
  await page.getByTestId('picker-submit').click();
  await expect(searchMode.getByTestId('destination-line-name')).toHaveText(new RegExp(`Aim: ${A_NAME} \\+ ${B_NAME}`));

  // Play: one record per screen, both start (PLACE.4a/AC3–AC4).
  await searchMode.getByTestId('search-mode-input').fill('Disclosure Day');
  await searchMode.getByTestId(`search-mode-result-${DISCLOSURE}`).click();
  const tray = page.getByTestId('dispatch-tray');
  await expect(tray).toContainText(`Playing on ${A_NAME}`, { timeout: 90000 });
  await expect(tray).toContainText(`Playing on ${B_NAME}`, { timeout: 90000 });
  for (const id of [A, B]) {
    await expect.poll(async () => (await receiverState(request, id))?.currentItem?.contentId, { timeout: 60000 }).toBe(DISCLOSURE);
  }
  // Add to queue with several screens aimed adds to each, and each says so (AC7).
  await searchMode.getByTestId('search-mode-input').fill('Keepy Uppy');
  const keepy = searchMode.getByTestId(`search-mode-result-${EP_KEEPY}`);
  await expect(keepy).toBeVisible({ timeout: 30000 });
  await keepy.getByTestId(`result-more-${EP_KEEPY}`).click();
  await page.getByTestId(`result-action-add-${EP_KEEPY}`).click();
  await expect(tray).toContainText(`Added Keepy Uppy to ${A_NAME}`, { timeout: 60000 });
  await expect(tray).toContainText(`Added Keepy Uppy to ${B_NAME}`, { timeout: 60000 });
  await shot(page, 'several-screens-outcomes-phone');
  await searchMode.getByTestId('search-mode-close').click();

  // Steered separately: B drifts (seek), then A's Remote lines up with B (AC5).
  await call(request, 'POST', `/api/v1/device/${B}/session/transport`, { action: 'seekAbs', value: 600 });
  await expect.poll(async () => (await receiverState(request, B))?.position ?? 0, { timeout: 30000 }).toBeGreaterThan(590);
  await page.getByTestId('app-tab-fleet').click();
  await page.getByTestId(`fleet-peek-${A}`).click();
  const lineUp = page.getByTestId(`line-up-${B}`);
  await expect(lineUp).toHaveText(`Line up with ${B_NAME}`, { timeout: 15000 });
  await lineUp.click();
  await expect(tray).toContainText(`Lined up Disclosure Day with ${B_NAME} on ${A_NAME}`, { timeout: 15000 });
  await expect.poll(async () => {
    const a = await receiverState(request, A);
    const b = await receiverState(request, B);
    return Math.abs((a?.position ?? 0) - (b?.position ?? 0));
  }, { timeout: 30000 }).toBeLessThanOrEqual(8);
  await shot(page, 'line-up-phone');
  await stopReceiver(request, A);
  await stopReceiver(request, B);
  await context.close();
  await ra.context.close();
  await rb.context.close();
});

for (const [label, viewport] of Object.entries(VIEWPORTS)) {
  test(`STEER.10a/STEER.13a/STEER.13b/STEER.1a — this device: sleep at the end of the item, continue offers, countdown, stop after this one, keep similar playing, lock-screen metadata (${label})`, async ({ browser }) => {
    test.skip(label !== 'laptop' && process.env.MEDIA_BATCH_B_ALL_LOCAL !== '1', 'full local journey runs at laptop; phone/tablet cover layout below');
    const context = await browser.newContext({ viewport, serviceWorkers: 'block' });
    const page = await context.newPage();
    await gotoMedia(page);
    const isPhone = viewport.width < 768;
    const search = async (query, contentId) => {
      if (isPhone) {
        await page.getByTestId('media-search-launcher').click();
        await page.getByTestId('search-mode-input').fill(query);
        const row = page.getByTestId(`search-mode-result-${contentId}`);
        await expect(row).toBeVisible({ timeout: 30000 });
        return row;
      }
      const input = page.getByRole('textbox', { name: 'Search media…' });
      await input.fill(query);
      const row = page.getByTestId(`combobox-option-${contentId}`);
      await expect(row).toBeVisible({ timeout: 30000 });
      return row;
    };
    // Play an episode here, and queue the next one (ordinary search verbs).
    await (await search('Hospital', EP_HOSPITAL)).click();
    await expect(page.getByTestId('mini-player-open-nowplaying')).toBeVisible({ timeout: 30000 });
    await (await search('Keepy Uppy', EP_KEEPY));
    await page.getByTestId(`result-more-${EP_KEEPY}`).click();
    await page.getByTestId(`result-action-add-${EP_KEEPY}`).click();
    if (isPhone) await page.getByTestId('search-mode-close').click();
    else await page.keyboard.press('Escape');
    await expect(page.getByTestId('mini-queue-count')).toHaveText('1/2', { timeout: 15000 });

    // Lock screen / system controls carry this playback (STEER.1a/AC5).
    await expect.poll(() => page.evaluate(() => navigator.mediaSession?.metadata?.title ?? null), { timeout: 30000 }).toBe('Hospital');
    await expect.poll(() => page.evaluate(() => navigator.mediaSession?.playbackState)).toBe('playing');

    // Sleep timer: at the end of this item; the handle shows it.
    await page.getByTestId('mini-player-open-nowplaying').click();
    const np = page.getByTestId('now-playing-view');
    await expect(np).toBeVisible();
    const media = page.getByTestId('now-playing-host').locator('video');
    await expect.poll(() => media.evaluate((n) => !n.paused && n.currentTime > 1), { timeout: 60000 }).toBe(true);
    await np.getByTestId('sleep-timer-button').click();
    await expect(page.getByTestId('sleep-timer-menu')).toBeVisible();
    await page.getByTestId('sleep-option-end').click();
    await expect(np.getByTestId('sleep-timer-left')).toHaveText('Sleep at end of this item');
    await shot(page, `local-session-controls-${label}`);
    await np.getByTestId('now-playing-back').click();
    await expect(page.getByTestId('mini-sleep')).toHaveAttribute('aria-label', 'Sleep timer: stops at the end of this item');
    await shot(page, `handle-sleep-${label}`);
    await page.getByTestId('mini-player-open-nowplaying').click();
    const setAt = await media.evaluate((n) => n.currentTime);

    await seekNearEnd(page, np);
    const resume = np.getByTestId('sleep-resume');
    await expect(resume).toBeVisible({ timeout: 120000 });
    await expect(np.getByTestId('now-playing-title')).toHaveAttribute('data-content-id', EP_HOSPITAL);
    await expect(np.getByTestId('countdown-banner')).toHaveCount(0);
    await expect(resume.getByTestId('sleep-continue-set')).toHaveText(/^Continue from \d+:\d\d, where the timer was set$/);
    await shot(page, `local-sleep-resume-${label}`);
    await resume.getByTestId('sleep-continue-set').click();
    await expect.poll(() => media.evaluate((n) => ({ playing: !n.paused, t: n.currentTime })), { timeout: 60000 })
      .toMatchObject({ playing: true });
    const resumedAt = await media.evaluate((n) => n.currentTime);
    expect(Math.abs(resumedAt - setAt)).toBeLessThan(15);
    await expect(np.getByTestId('sleep-resume')).toHaveCount(0);

    // Next-episode countdown at the natural end, cancellable; then let it run.
    await seekNearEnd(page, np);
    const banner = np.getByTestId('countdown-banner');
    await expect(banner).toContainText('Next: Keepy Uppy in', { timeout: 120000 });
    await shot(page, `local-countdown-${label}`);
    await banner.getByTestId('countdown-cancel').click();
    await expect(banner).toBeHidden();
    await expect(np.getByTestId('now-playing-title')).toHaveAttribute('data-content-id', EP_HOSPITAL);
    await page.getByTestId('np-next').click();
    await expect(np.getByTestId('now-playing-title')).toHaveAttribute('data-content-id', EP_KEEPY, { timeout: 30000 });

    // Keep similar playing at the end of the queue, then Stop after this one wins first.
    const choice = np.getByTestId('queue-end-choice');
    await choice.getByTestId('queue-end-similar').click();
    await expect(choice.getByTestId('queue-end-similar')).toHaveAttribute('aria-checked', 'true');
    await np.getByTestId('stop-after-current').click();
    await expect(np.getByTestId('stop-after-current')).toHaveAttribute('aria-pressed', 'true');
    await expect.poll(() => media.evaluate((n) => !n.paused && n.currentTime > 0.5), { timeout: 60000 }).toBe(true);
    await seekNearEnd(page, np);
    await expect(choice.getByTestId('queue-end-status')).toHaveText('Stopped after that one, as asked', { timeout: 120000 });
    await expect(np.getByTestId('stop-after-current')).toHaveAttribute('aria-pressed', 'false');

    // Now the end of the queue keeps similar things playing, marked as added automatically.
    await page.getByTestId('np-toggle').click();
    await expect.poll(() => media.evaluate((n) => !n.paused && n.currentTime > 0.5), { timeout: 60000 }).toBe(true);
    await seekNearEnd(page, np);
    await expect(choice.getByTestId('queue-end-status')).toHaveText(/^Added \d similar items?/, { timeout: 120000 });
    await expect(np.locator('[data-testid^="queue-auto-"]').first()).toHaveText('added automatically');
    await shot(page, `local-similar-${label}`);
    await page.getByTestId('np-stop').click();
    await context.close();
  });
}
