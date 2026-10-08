// Shared journey helpers for the virtual receivers of the acceptance server:
// two real mounted screen pages (`acceptance-media`, `acceptance-media-b`),
// started through the ordinary device load route and read back through the
// receiver-state route. No household screen is touched.
import { expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { markFirstUseDone } from './firstUse.mjs';

export const A = 'acceptance-media';
export const B = 'acceptance-media-b';
export const A_NAME = 'Acceptance receiver';
export const B_NAME = 'Acceptance second';
export const SCREEN = { [A]: 'living-room', [B]: 'acceptance-second' };
export const ITEM = Object.freeze({
  DISCLOSURE: 'plex:697368',
  ARRIVAL: 'plex:55854',
  HOSPITAL: 'plex:266151',
  KEEPY: 'plex:266152',
  FAITH: 'plex:584614',
});
export const VIEWPORTS = Object.freeze({
  phone: { width: 390, height: 844 },
  tablet: { width: 820, height: 1180 },
  laptop: { width: 1440, height: 900 },
});

export async function call(request, method, url, body, headers = undefined) {
  const response = await request.fetch(url, { method, data: body ? { commandId: randomUUID(), ...body } : undefined, headers });
  const json = await response.json().catch(() => null);
  return { status: response.status(), body: json };
}

export const receiverState = async (request, id) => (await call(request, 'GET', `/api/v1/device/${id}/receiver-state`)).body?.snapshot ?? null;

/** Mount a virtual receiver page in its own context; resolves once the bus sees it ready. */
export async function openReceiver(browser, request, id) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 }, serviceWorkers: 'block' });
  await markFirstUseDone(context);
  const page = await context.newPage();
  const ready = async () => (await call(request, 'GET', `/api/v1/device/${id}/receiver-ready`)).body?.ready === true;
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
  await page.waitForTimeout(1500);
  return { context, page };
}

/**
 * A cold start of an already-open receiver: its page is gone without any unload
 * courtesy and a new page opens in the SAME browser context (so the screen's own
 * persisted spot/queue is what it restores from, as a power cut would).
 */
export async function reopenReceiver(receiver, request, id) {
  await receiver.page.close({ runBeforeUnload: false });
  const page = await receiver.context.newPage();
  const ready = async () => (await call(request, 'GET', `/api/v1/device/${id}/receiver-ready`)).body?.ready === true;
  let mounted = false;
  for (let attempt = 1; attempt <= 3 && !mounted; attempt += 1) {
    await page.goto(`/screen/${SCREEN[id]}`, { waitUntil: 'domcontentloaded' });
    const deadline = Date.now() + 40000;
    while (Date.now() < deadline && !mounted) {
      mounted = await ready();
      if (!mounted) await page.waitForTimeout(1000);
    }
  }
  expect(mounted, `virtual receiver ${id} never became ready after reopen`).toBe(true);
  return { context: receiver.context, page };
}

/**
 * Start `contentId` on a receiver through the ordinary load route and wait for
 * it to play. `asDevice` names who started it (another device = "someone
 * else's playback"); `queue` is added after it the ordinary way.
 */
export async function clearQueue(request, id) {
  const done = await call(request, 'POST', `/api/v1/device/${id}/session/queue/item-action`, { kind: 'clear', operationId: randomUUID(), tappedAt: Date.now() });
  expect(done.status).toBeLessThan(500);
  await expect.poll(async () => (await receiverState(request, id))?.queue?.items?.length ?? 0, { timeout: 30000 }).toBe(0);
}

export async function startOn(request, id, contentId, { queue = [], asDevice = null, timeout = 120000, fresh = true } = {}) {
  // A screen keeps what was queued after the previous item, so a journey that counts its queue starts from an empty one.
  if (fresh && ((await receiverState(request, id))?.queue?.items?.length ?? 0) > 0) {
    await stopReceiver(request, id);
    await clearQueue(request, id);
  }
  const loaded = await call(request, 'GET', `/api/v1/device/${id}/load?play=${encodeURIComponent(contentId)}&dispatchId=${randomUUID()}`, null,
    asDevice ? { 'X-Daylight-Device': asDevice } : undefined);
  expect(loaded.status).toBe(200);
  await expect.poll(async () => {
    const snap = await receiverState(request, id);
    return snap?.state === 'playing' && snap?.currentItem?.contentId === contentId;
  }, { timeout }).toBe(true);
  for (const next of queue) {
    expect((await call(request, 'GET', `/api/v1/device/${id}/load?queue=${encodeURIComponent(next)}&op=add&dispatchId=${randomUUID()}`)).status).toBe(200);
    await expect.poll(async () => (await receiverState(request, id))?.queue?.items?.some((it) => it.contentId === next), { timeout: 30000 }).toBe(true);
  }
}

export async function resetControls(request, id) {
  for (const [p, body] of [['add-only', { enabled: false }], ['end-of-queue', { mode: 'stop' }], ['stop-after-current', { enabled: false }]]) {
    await call(request, 'PUT', `/api/v1/device/${id}/session/${p}`, body);
  }
  await call(request, 'POST', `/api/v1/device/${id}/session/sleep-timer/cancel`, {});
}

export async function stopReceiver(request, id) {
  await call(request, 'POST', `/api/v1/device/${id}/session/transport`, { action: 'stop' });
}

export async function pauseReceiver(request, id) {
  await call(request, 'POST', `/api/v1/device/${id}/session/transport`, { action: 'pause' });
  await expect.poll(async () => (await receiverState(request, id))?.state, { timeout: 30000 }).toBe('paused');
}

/** Open the Media app, retrying bootstrap navigation a bounded number of times. */
export async function gotoMedia(page, path = '/media') {
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    // A navigation can be superseded by one the page started itself or lost to a
    // network change (net::ERR_ABORTED); that says nothing about the app. Ask again,
    // as a person would. Any other error, and the fourth failure, still fails.
    try {
      await page.goto(path, { waitUntil: 'domcontentloaded' });
    } catch (error) {
      if (attempt === 4 || !/net::ERR_(ABORTED|NETWORK_CHANGED|CONNECTION_RESET)/.test(String(error?.message))) throw error;
      continue;
    }
    if (await page.getByTestId('media-shell').waitFor({ state: 'visible', timeout: 60000 }).then(() => true, () => false)) return;
  }
  await expect(page.getByTestId('media-shell')).toBeVisible();
}

/** Open the house overview (phone: tab, wider: nav). */
export async function openHouse(page, viewport) {
  const nav = viewport.width < 768 ? page.getByTestId('app-tab-fleet') : page.getByTestId('app-nav-fleet');
  await expect(nav).toBeVisible({ timeout: 30000 });
  await nav.click();
}

/** Open another screen's controls (its Remote) from the house overview. */
export async function openRemote(page, id, viewport) {
  await gotoMedia(page);
  await openHouse(page, viewport);
  await expect(page.getByTestId(`fleet-peek-${id}`)).toBeVisible({ timeout: 30000 });
  await page.getByTestId(`fleet-peek-${id}`).click();
  await expect(page.getByTestId('peek-panel')).toBeVisible();
}

export async function newAppPage(browser, viewport = VIEWPORTS.laptop) {
  const context = await browser.newContext({ viewport, serviceWorkers: 'block' });
  await markFirstUseDone(context);
  return { context, page: await context.newPage() };
}

/**
 * A cold dev server optimizes dependencies on its first Media load; load the
 * app once (in `test.beforeAll`) so no journey measures bootstrap.
 */
export async function warmMedia(browser) {
  const { context, page } = await newAppPage(browser, VIEWPORTS.laptop);
  try { await gotoMedia(page); } finally { await context.close(); }
}
