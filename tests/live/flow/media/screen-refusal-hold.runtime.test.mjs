import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';

// Refusal recovery on a SCREEN (docs/superpowers/specs/2026-10-07-media-refusal-recovery-design.md).
// Owner ruling: a screen HOLDS a refused video — quiet "Fixing this video…"
// note, no auto-skip through the queue — and resumes at the spot when the file
// is readable again. Requires `tests/_lib/media-redesign-server.mjs` (BASE_URL):
// the fixture's virtual receiver (`acceptance-media`) on /screen/living-room.
// No household screen is commanded. The acceptance preview refuses non-GET /api
// calls, so the backend check is answered here with the real response shape;
// the part refusal is the proxy's real 503 `source-unreadable` answer.
test.use({ viewport: { width: 1280, height: 720 }, trace: 'retain-on-failure', serviceWorkers: 'block' });
test.setTimeout(300000);
test.describe.configure({ mode: 'serial' });

const DEVICE = 'acceptance-media';
const base = `/api/v1/device/${DEVICE}`;
const EP_HOSPITAL = 'plex:266151';
const EP_KEEPY = 'plex:266152';
// The acceptance preview plays this episode over an HLS TRANSCODE session, not a
// direct part: the proxy URL carries Plex's session uuid, never the rating key,
// so the refusal a ghost causes is a segment (`.ts`) failing after a 200 manifest
// (spec gap D). Only one episode plays at a time here, so `readable` flips the
// segments of the session that is playing; the direct-part forms stay for a
// direct-play policy.
const HOSPITAL_PART = /\/api\/v1\/proxy\/plex\/(?:stream\/266151(?:\?|$)|library\/parts\/\d+\/\d+\/file\.[a-z0-9]+|video\/:\/transcode\/universal\/session\/[0-9a-f-]{36}\/base\/[^/?]+\.(?:ts|m4s|mp4))/;

async function call(request, method, path, body) {
  const response = await request.fetch(path, { method, data: body ? { commandId: randomUUID(), ...body } : undefined });
  const json = await response.json().catch(() => null);
  return { status: response.status(), body: json };
}
const state = async (request) => (await call(request, 'GET', `${base}/receiver-state`)).body?.snapshot ?? null;

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

const videoTime = (receiver) => receiver.evaluate(() => {
  const dash = document.querySelector('dash-video');
  const v = dash?.shadowRoot?.querySelector('video') || dash || document.querySelector('video');
  return v && Number.isFinite(v.currentTime) ? v.currentTime : null;
});

test('a refused episode is HELD with a fixing note (never skipped), then resumes at the spot when readable', async ({ context, request }) => {
  const receiver = await openReceiver(context, request);
  let readable = true;
  const checks = [];
  const refusals = [];
  await receiver.route(HOSPITAL_PART, async (route) => {
    if (readable) return route.continue();
    refusals.push(Date.now());
    return route.fulfill({
      status: 503, headers: { 'retry-after': '5', 'content-type': 'application/json' },
      body: JSON.stringify({ error: 'Media file temporarily unreadable', reason: 'source-unreadable' }),
    });
  });
  await receiver.route('**/api/v1/media-source/check', async (route) => {
    const body = route.request().postDataJSON();
    checks.push({ at: Date.now(), contentId: body?.contentId, origin: body?.origin ?? null });
    const answerState = body?.contentId === EP_HOSPITAL && !readable ? 'unreadable' : 'readable';
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ state: answerState, contentId: body?.contentId, steps: [] }) });
  });

  // Two episodes: the first is refused, the second is the one a skip would land on.
  expect((await call(request, 'GET', `${base}/load?play=${EP_HOSPITAL}&dispatchId=${randomUUID()}`)).status).toBe(200);
  await expect.poll(async () => {
    const snap = await state(request);
    return snap?.state === 'playing' && snap?.currentItem?.contentId === EP_HOSPITAL;
  }, { timeout: 120000 }).toBe(true);
  expect((await call(request, 'GET', `${base}/load?play=${EP_KEEPY}&op=add&dispatchId=${randomUUID()}`)).status).toBe(200);
  await expect.poll(async () => (await state(request))?.queue?.items?.some(i => i.contentId === EP_KEEPY), { timeout: 30000 }).toBe(true);

  // Move the playhead well past anything buffered, then refuse the part: the next
  // range request is the proxy's 503 source-unreadable.
  // The fixture episode runs ~439 s: a spot past its end would clamp to the last
  // segment and make "resume at the spot" indistinguishable from "restart".
  const SPOT = 300;
  readable = false;
  await receiver.evaluate((t) => {
    const dash = document.querySelector('dash-video');
    const v = dash?.shadowRoot?.querySelector('video') || dash || document.querySelector('video');
    v.currentTime = t;
  }, SPOT);

  // The screen shows the quiet fixing note, TV-legible.
  const note = receiver.getByTestId('player-source-notice');
  await expect(note).toContainText('Fixing this video', { timeout: 45000 });
  // The backend is asked about the EPISODE, not a container.
  expect(checks.length).toBeGreaterThan(0);
  expect(checks.every(c => c.contentId === EP_HOSPITAL)).toBe(true);

  // HOLD: well past the 15 s startup deadline, the stall ladder and a few polls
  // (2/4/8/15 s), the screen has not skipped to the next episode.
  await receiver.waitForTimeout(45000);
  await expect(note).toBeVisible();
  expect((await state(request))?.currentItem?.contentId).toBe(EP_HOSPITAL);
  expect(checks.length).toBeGreaterThanOrEqual(3);

  // The file is repaired: the next poll resumes at the spot (not from 0, not the next item).
  readable = true;
  await expect.poll(async () => {
    const snap = await state(request);
    const t = await videoTime(receiver);
    return snap?.currentItem?.contentId === EP_HOSPITAL && snap?.state === 'playing' && t !== null && t >= SPOT - 15;
  }, { timeout: 90000, message: 'playback should resume at the saved spot on the same episode' }).toBe(true);
  await expect(note).toHaveCount(0);
});

test('OK on the remote skips a held episode (D-pad + OK alone is enough)', async ({ context, request }) => {
  const receiver = await openReceiver(context, request);
  let readable = true;
  await receiver.route(HOSPITAL_PART, async (route) => {
    if (readable) return route.continue();
    return route.fulfill({
      status: 503, headers: { 'retry-after': '5', 'content-type': 'application/json' },
      body: JSON.stringify({ error: 'Media file temporarily unreadable', reason: 'source-unreadable' }),
    });
  });
  await receiver.route('**/api/v1/media-source/check', async (route) => {
    const body = route.request().postDataJSON();
    const answerState = body?.contentId === EP_HOSPITAL && !readable ? 'unreadable' : 'readable';
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ state: answerState, contentId: body?.contentId, steps: [] }) });
  });
  expect((await call(request, 'GET', `${base}/load?play=${EP_HOSPITAL}&dispatchId=${randomUUID()}`)).status).toBe(200);
  await expect.poll(async () => (await state(request))?.currentItem?.contentId, { timeout: 120000 }).toBe(EP_HOSPITAL);
  expect((await call(request, 'GET', `${base}/load?play=${EP_KEEPY}&op=add&dispatchId=${randomUUID()}`)).status).toBe(200);
  await expect.poll(async () => (await state(request))?.queue?.items?.some(i => i.contentId === EP_KEEPY), { timeout: 30000 }).toBe(true);

  readable = false;
  await receiver.evaluate(() => {
    const dash = document.querySelector('dash-video');
    const v = dash?.shadowRoot?.querySelector('video') || dash || document.querySelector('video');
    v.currentTime = 300;
  });
  await expect(receiver.getByTestId('player-source-notice')).toContainText('Fixing this video', { timeout: 45000 });
  await expect(receiver.getByTestId('player-source-skip')).toBeVisible();

  readable = true; // the next episode must be readable to play
  await receiver.keyboard.press('Enter'); // OK
  await expect.poll(async () => (await state(request))?.currentItem?.contentId, { timeout: 60000 }).toBe(EP_KEEPY);
});
