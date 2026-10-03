import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';

// Screen player P1 capabilities against a REAL mounted screen page.
// Requires `tests/_lib/media-redesign-server.mjs` (BASE_URL): its local
// EventBus/device composition serves the one virtual receiver
// (`acceptance-media`) — no household screen is commanded, and there is no
// route interception or synthetic ack/state: the screen publishes its own.
// Service workers are blocked: under the Vite dev server the app's worker
// registered by the first page fails every module request of a second page
// in the same context (net::ERR_FAILED), which is what the cold-start journey
// opens. Production screens load built assets the worker can serve.
test.use({ viewport: { width: 1280, height: 720 }, trace: 'retain-on-failure', serviceWorkers: 'block' });
test.setTimeout(180000);
test.describe.configure({ mode: 'serial' });

const DEVICE = 'acceptance-media';
const base = `/api/v1/device/${DEVICE}`;
const DISCLOSURE = 'plex:697368';
const EP_HOSPITAL = 'plex:266151';
const EP_KEEPY = 'plex:266152';
const phone = { kind: 'device', id: 'browser:acceptance-phone', name: 'Test phone' };

async function call(request, method, path, body, headers = undefined) {
  const response = await request.fetch(path, {
    method, data: body ? { commandId: randomUUID(), ...body } : undefined, headers,
  });
  const json = await response.json().catch(() => null);
  return { status: response.status(), body: json };
}
const state = async (request) => (await call(request, 'GET', `${base}/receiver-state`)).body?.snapshot ?? null;
// `asDevice` sends the device header every app request carries, so the
// screen sees a person's device; without it the load is an automation (HA).
const load = (request, contentId, { asDevice } = {}) => call(request, 'GET',
  `${base}/load?play=${encodeURIComponent(contentId)}&dispatchId=${randomUUID()}`, undefined,
  asDevice ? { 'X-Daylight-Device': asDevice } : undefined);

// Opening the dev-server page can lose module fetches to a host network
// change (Chromium net::ERR_NETWORK_CHANGED) and park the page in the app's
// chunk-reload cooldown. That is page bootstrap, not the behaviour under
// test, so navigation is retried a bounded number of times; the journey still
// fails if the receiver never becomes ready.
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

async function startPlaying(request, contentId) {
  const loaded = await load(request, contentId);
  expect(loaded.status).toBe(200);
  await expect.poll(async () => {
    const snap = await state(request);
    return snap?.state === 'playing' && snap?.currentItem?.contentId === contentId;
  }, { timeout: 120000 }).toBe(true);
  return loaded.body;
}

async function resetControls(request) {
  for (const [path, body] of [['add-only', { enabled: false }], ['end-of-queue', { mode: 'stop' }], ['stop-after-current', { enabled: false }]]) {
    expect((await call(request, 'PUT', `${base}/session/${path}`, body)).status).toBe(200);
  }
}

test('Add only: another device\'s Play is added, says so, and is published (RQ-PLAY-10)', async ({ context, request }) => {
  const receiver = await openReceiver(context, request);
  await startPlaying(request, EP_HOSPITAL);
  const set = await call(request, 'PUT', `${base}/session/add-only`, { enabled: true, origin: phone });
  expect(set.status).toBe(200);
  await expect.poll(async () => (await state(request))?.controls?.addOnly, { timeout: 15000 }).toBe(true);

  const dispatched = await load(request, DISCLOSURE, { asDevice: phone.id });
  expect(dispatched.status).toBe(200);
  expect(dispatched.body).toMatchObject({ ok: true, appliedAs: 'add' });
  await expect.poll(async () => {
    const snap = await state(request);
    return snap?.currentItem?.contentId === EP_HOSPITAL && snap?.queue?.items?.some(item => item.contentId === DISCLOSURE);
  }, { timeout: 30000 }).toBe(true);
  // An append reached the screen; nothing started.
  await expect.poll(async () => (await call(request, 'GET', `${base}/start-status`)).body?.status?.phase, { timeout: 30000 })
    .toBe('queued');

  // An automation (no device named — a Home Assistant button) always plays.
  const automation = await load(request, EP_KEEPY);
  expect(automation.status).toBe(200);
  expect(automation.body).not.toHaveProperty('appliedAs');
  await expect.poll(async () => (await state(request))?.currentItem?.contentId, { timeout: 120000 }).toBe(EP_KEEPY);
  await resetControls(request);
  await receiver.close();
});

test('Screen notes name the change and its origin, group repeats, and Put it back restores (RQ-STEER-21)', async ({ context, request }) => {
  const receiver = await openReceiver(context, request);
  await startPlaying(request, EP_HOSPITAL);
  const volume = await call(request, 'PUT', `${base}/session/volume`, { level: 40, origin: phone });
  expect(volume.status).toBe(200); // the screen applied it, and a volume change makes no note
  await expect(receiver.getByTestId('screen-note')).toHaveCount(0);

  expect((await call(request, 'POST', `${base}/session/transport`, { action: 'pause', origin: phone })).status).toBe(200);
  await expect(receiver.getByTestId('screen-note-label')).toHaveText('Paused by Test phone', { timeout: 10000 });
  await expect(receiver.getByTestId('screen-note-put-back')).toBeVisible();
  await expect.poll(async () => (await state(request))?.meta?.origin, { timeout: 10000 }).toEqual(phone);

  expect((await call(request, 'POST', `${base}/session/transport`, { action: 'play', origin: phone })).status).toBe(200);
  await expect.poll(async () => (await state(request))?.state, { timeout: 30000 }).toBe('playing');
  expect((await call(request, 'POST', `${base}/session/transport`, { action: 'pause', origin: phone })).status).toBe(200);
  await expect(receiver.getByTestId('screen-note-label')).toHaveText('Paused by Test phone (2×)', { timeout: 10000 });
  await expect.poll(async () => (await state(request))?.controls?.notes?.[0], { timeout: 10000 })
    .toMatchObject({ kind: 'paused', count: 2, label: 'Paused by Test phone', putBack: { availableUntil: expect.any(String) } });

  const putBack = await call(request, 'POST', `${base}/session/put-back`, {});
  expect(putBack.status).toBe(200);
  await expect.poll(async () => (await state(request))?.state, { timeout: 30000 }).toBe('playing');
  await expect(receiver.getByTestId('screen-note-put-back')).toHaveCount(0);
  const refused = await call(request, 'POST', `${base}/session/put-back`, {});
  expect(refused.status).toBe(502);
  expect(refused.body.code).toBe('PUT_BACK_UNAVAILABLE');
  await receiver.close();
});

test('Sleep timer counts down, fades, stops keeping the queue, and continues from where it was set (RQ-STEER-12)', async ({ context, request }) => {
  const receiver = await openReceiver(context, request);
  await startPlaying(request, EP_HOSPITAL);
  const setAt = (await state(request)).position;
  expect((await call(request, 'POST', `${base}/session/sleep-timer`, { minutes: 0.25 })).status).toBe(200);
  await expect.poll(async () => (await state(request))?.controls?.sleepTimer?.remainingSeconds, { timeout: 10000 })
    .toBeGreaterThan(0);
  await expect(receiver.getByTestId('screen-sleep-fading')).toBeVisible({ timeout: 20000 });
  await expect.poll(async () => receiver.locator('video').evaluate(el => el.volume), { timeout: 15000 }).toBeLessThan(0.9);
  await expect.poll(async () => {
    const snap = await state(request);
    return snap?.controls?.sleepTimer === null && !!snap?.controls?.sleepResume && snap?.state !== 'playing';
  }, { timeout: 30000 }).toBe(true);
  const stopped = await state(request);
  expect(stopped.queue.items.some(item => item.contentId === EP_HOSPITAL)).toBe(true);
  expect(stopped.controls.sleepResume).toMatchObject({ contentId: EP_HOSPITAL });
  expect(stopped.controls.sleepResume.position).toBeGreaterThanOrEqual(Math.floor(setAt) - 1);

  expect((await call(request, 'POST', `${base}/session/sleep-timer/resume`, {})).status).toBe(200);
  await expect.poll(async () => {
    const snap = await state(request);
    return snap?.state === 'playing' && snap?.currentItem?.contentId === EP_HOSPITAL && snap.controls.sleepResume === null;
  }, { timeout: 60000 }).toBe(true);
  await expect.poll(async () => receiver.locator('video').evaluate(el => el.volume), { timeout: 15000 }).toBeGreaterThan(0.9);
  await receiver.close();
});

test('Next-episode countdown is visible and cancellable; stop after this one is settable remotely (RQ-STEER-20)', async ({ context, request }) => {
  const receiver = await openReceiver(context, request);
  await resetControls(request);
  await startPlaying(request, EP_HOSPITAL);
  // Queue the next episode (an ordinary Add), then jump near the end.
  expect((await call(request, 'GET', `${base}/load?play=${EP_KEEPY}&op=add&dispatchId=${randomUUID()}`)).status).toBe(200);
  await expect.poll(async () => (await state(request))?.queue?.items?.some(i => i.contentId === EP_KEEPY), { timeout: 30000 }).toBe(true);

  const duration = await receiver.locator('video').evaluate(el => el.duration);
  expect((await call(request, 'POST', `${base}/session/transport`, { action: 'seekAbs', value: Math.max(0, duration - 4) })).status).toBe(200);
  await expect(receiver.getByTestId('screen-next-countdown')).toBeVisible({ timeout: 30000 });
  await expect(receiver.getByTestId('screen-next-countdown')).toContainText('Keepy Uppy');
  await expect.poll(async () => (await state(request))?.controls?.countdown?.next?.contentId, { timeout: 10000 }).toBe(EP_KEEPY);
  expect((await call(request, 'POST', `${base}/session/countdown/cancel`, {})).status).toBe(200);
  await expect(receiver.getByTestId('screen-next-countdown')).toHaveCount(0);
  await expect.poll(async () => (await state(request))?.currentItem?.contentId, { timeout: 10000 }).toBe(EP_HOSPITAL);

  // Second natural end: let the countdown run out and start the next episode.
  expect((await call(request, 'POST', `${base}/session/transport`, { action: 'seekAbs', value: Math.max(0, duration - 4) })).status).toBe(200);
  expect((await call(request, 'POST', `${base}/session/transport`, { action: 'play' })).status).toBe(200);
  await expect(receiver.getByTestId('screen-next-countdown')).toBeVisible({ timeout: 30000 });
  await expect.poll(async () => {
    const snap = await state(request);
    return snap?.currentItem?.contentId === EP_KEEPY && snap?.state === 'playing';
  }, { timeout: 60000 }).toBe(true);

  // Stop after this one, set from a remote: Keepy Uppy ends and nothing follows.
  expect((await call(request, 'PUT', `${base}/session/stop-after-current`, { enabled: true })).status).toBe(200);
  await expect.poll(async () => (await state(request))?.controls?.stopAfterCurrent, { timeout: 10000 }).toBe(true);
  const keepyDuration = await receiver.locator('video').evaluate(el => el.duration);
  expect((await call(request, 'POST', `${base}/session/transport`, { action: 'seekAbs', value: Math.max(0, keepyDuration - 3) })).status).toBe(200);
  await expect.poll(async () => (await state(request))?.controls?.endOfQueueStatus?.code, { timeout: 30000 }).toBe('STOPPED_AFTER_CURRENT');
  const after = await state(request);
  expect(after.controls.stopAfterCurrent).toBe(false);
  expect(after.state).not.toBe('playing');
  await receiver.close();
});

test('End of queue: "keep similar things playing" auto-adds a marked batch from the show (RQ-STEER-19)', async ({ context, request }) => {
  const receiver = await openReceiver(context, request);
  await resetControls(request);
  await startPlaying(request, EP_KEEPY);
  expect((await call(request, 'PUT', `${base}/session/end-of-queue`, { mode: 'similar' })).status).toBe(200);
  await expect.poll(async () => (await state(request))?.controls?.endOfQueue, { timeout: 10000 }).toBe('similar');
  const duration = await receiver.locator('video').evaluate(el => el.duration);
  expect((await call(request, 'POST', `${base}/session/transport`, { action: 'seekAbs', value: Math.max(0, duration - 3) })).status).toBe(200);
  await expect.poll(async () => (await state(request))?.controls?.endOfQueueStatus?.code, { timeout: 60000 }).toBe('SIMILAR_ADDED');
  const snap = await state(request);
  const auto = snap.queue.items.filter(item => item.addedBy === 'auto-continue');
  expect(auto.length).toBeGreaterThan(0);
  expect(auto.length).toBeLessThanOrEqual(5);
  expect(auto.map(item => item.contentId)).not.toContain(EP_KEEPY);
  await expect(receiver.getByTestId('screen-queue-status')).toContainText('Added automatically');
  await resetControls(request);
  await receiver.close();
});

test('A screen keeps its spot and queue through a power cut and comes back PAUSED (RQ-RELY-08)', async ({ context, request }) => {
  const receiver = await openReceiver(context, request);
  await resetControls(request);
  await startPlaying(request, EP_HOSPITAL);
  await expect.poll(async () => (await state(request))?.position, { timeout: 30000 }).toBeGreaterThan(3);
  await receiver.waitForTimeout(6000); // the spot is persisted every 5s
  const before = await state(request);

  // A cold start: the page is gone without any unload courtesy.
  await receiver.close({ runBeforeUnload: false });
  const cold = await openReceiver(context, request);
  await expect.poll(async () => {
    const snap = await state(request);
    return snap?.currentItem?.contentId === EP_HOSPITAL ? snap.state : null;
  }, { timeout: 60000 }).toMatch(/paused|ready/);
  // The spot is applied once the paused renderer has loaded the stream. It is
  // persisted every 5 s, so it may trail the last observed position by that.
  await expect.poll(async () => (await state(request))?.position ?? 0, { timeout: 60000 })
    .toBeGreaterThanOrEqual(Math.max(3, Math.floor(before.position) - 6));
  const after = await state(request);
  expect(after.state).not.toBe('playing');
  expect(after.queue.items.map(i => i.contentId)).toEqual(before.queue.items.map(i => i.contentId));
  await cold.waitForTimeout(3000);
  expect((await state(request)).state).not.toBe('playing'); // never autoplays
  await cold.close();
});

test('Start progress and the last failure are visible to every device (RQ-HOUSE-04)', async ({ context, request }) => {
  const receiver = await openReceiver(context, request);
  await startPlaying(request, EP_HOSPITAL);
  await expect.poll(async () => (await call(request, 'GET', `${base}/start-status`)).body?.status?.phase, { timeout: 60000 })
    .toBe('started');
  // A late observer (another device's tab) gets the status replayed on subscribe.
  const observer = await context.newPage();
  await observer.goto('/screen/living-room', { waitUntil: 'domcontentloaded' });
  const replayed = await observer.evaluate(() => new Promise((resolve, reject) => {
    const ws = new WebSocket(`${location.origin.replace('http', 'ws')}/ws`);
    const timer = setTimeout(() => reject(new Error('no device-start replay')), 10000);
    ws.onopen = () => ws.send(JSON.stringify({ type: 'bus_command', action: 'subscribe', topics: ['device-start:acceptance-media'] }));
    ws.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      if (msg.topic === 'device-start:acceptance-media') { clearTimeout(timer); ws.close(); resolve(msg); }
    };
  }));
  expect(replayed).toMatchObject({ deviceId: DEVICE, phase: 'started' });
  await observer.close();
  await receiver.close();
});
