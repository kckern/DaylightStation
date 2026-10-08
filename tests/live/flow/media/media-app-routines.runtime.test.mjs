import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { createHomeAssistantCaller } from '../../../_lib/media-ha-caller.mjs';
import { resetHouseholdAt, pinBrowserIdentity } from './lib/household.mjs';
import {
  A, A_NAME, ITEM, VIEWPORTS, call, receiverState, openReceiver, reopenReceiver, startOn, stopReceiver, resetControls,
  newAppPage, gotoMedia, openHouse, warmMedia,
} from './lib/receivers.mjs';

// AUTO — routines (Home Assistant) start playback on a named screen. Every
// start below is a REAL Home Assistant style load (HomeAssistant User-Agent)
// through the real RoutineLoadRecorder, catalog match, 10-second dedupe and
// routine history; the receiver is a real mounted screen page. Nothing reaches
// Home Assistant or a household screen. Observation uses ordinary UI input.
test.use({ trace: 'retain-on-failure', serviceWorkers: 'block' });
test.setTimeout(360000);
test.describe.configure({ mode: 'serial' });

let ha;
test.beforeAll(async ({ browser }) => { test.setTimeout(300000); await warmMedia(browser); });
test.beforeEach(async ({ request, baseURL }) => {
  await resetHouseholdAt(request, baseURL);
  ha = createHomeAssistantCaller({ baseUrl: baseURL });
});

const idle = async (request) => {
  await stopReceiver(request, A);
  await expect.poll(async () => (await receiverState(request, A))?.state, { timeout: 30000 }).toMatch(/stopped|idle|ready/);
};

test('[AUTO.1a/AC1-AC3][AUTO.2a/AC1] a routine starts the named screen with the chosen item and volume, as fast as a person would, shows on the house row and in routine history, and the same trigger twice starts it once', async ({ browser, request }) => {
  const receiver = await openReceiver(browser, request, A);
  await resetControls(request, A);

  // A person's send, timed: the baseline a routine must keep up with.
  const personStart = Date.now();
  await startOn(request, A, ITEM.HOSPITAL);
  const personMs = Date.now() - personStart;
  await idle(request);
  const personAckStart = Date.now();
  await call(request, 'GET', `/api/v1/device/${A}/load?play=${encodeURIComponent(ITEM.HOSPITAL)}&dispatchId=${randomUUID()}`);
  const personAckMs = Date.now() - personAckStart;
  await expect.poll(async () => (await receiverState(request, A))?.state, { timeout: 120000 }).toBe('playing');
  await idle(request);

  // The routine: the chosen item at the chosen volume, queue behind it.
  const routine = `Journey routine ${randomUUID().slice(0, 4)}`;
  const query = { play: ITEM.HOSPITAL, volume: '12', routine };
  const historyBefore = (await ha.history()).length;
  const routineStart = Date.now();
  const first = await ha.load(A, query);
  const routineAckMs = Date.now() - routineStart;
  expect(first.status).toBe(200);
  expect(first.body?.ok).toBe(true);
  // AUTO.2a/AC1: the same trigger fired again straight away (inside its 10
  // second window) is coalesced into the first: one start, no duplicate queue entry.
  const second = await ha.load(A, query);
  expect(second.status).toBe(200);
  expect(second.body).toMatchObject({ ok: true, deduplicated: true });
  await expect.poll(async () => {
    const snap = await receiverState(request, A);
    return snap?.state === 'playing' && snap?.currentItem?.contentId === ITEM.HOSPITAL;
  }, { timeout: 120000 }).toBe(true);
  const routineMs = Date.now() - routineStart;
  const snap = await receiverState(request, A);
  // AC1: the chosen item, with the chosen volume, on the named screen.
  const { calls } = (await call(request, 'GET', `/api/v1/device/${A}/device-control-calls`)).body;
  expect(calls.filter((c) => c.action === 'volume').map((c) => c.level)).toEqual([12]);
  // AC2: within the same few seconds a person's send takes.
  // The routine path adds no wait of its own (the server hands the load to the
  // screen as fast as for a person), and the screen is playing within the same
  // few seconds: start time under load varies by several seconds from run to
  // run for a person's send too (Plex), so it is bounded, not compared exactly.
  expect(routineAckMs, `routine ack ${routineAckMs} ms vs person ack ${personAckMs} ms`).toBeLessThanOrEqual(personAckMs + 2000);
  // The coalesced trigger left exactly one queue entry and did not toggle playback.
  expect(snap.queue.items.map((i) => i.contentId)).toEqual([ITEM.HOSPITAL]);
  expect(routineMs, `routine ${routineMs} ms (ack ${routineAckMs}) vs person ${personMs} ms (ack ${personAckMs})`).toBeLessThanOrEqual(15000);

  // AC3: recorded in routine history, with the screen and the result.
  await expect.poll(async () => (await ha.history()).length, { timeout: 15000 }).toBeGreaterThan(historyBefore);
  const runs = (await ha.history()).filter((run) => run.routine?.name === routine);
  // Newest first: the coalesced second trigger is recorded as such, the first as the one real start.
  expect(runs.map((run) => run.outcome)).toEqual(['deduplicated', 'started']);
  expect(runs[1]).toMatchObject({ deviceId: `fleet:${A}`, screenName: A_NAME, what: { key: 'play', contentId: ITEM.HOSPITAL } });

  // AC3: visible to anyone looking at that screen in the house overview.
  const { context, page } = await newAppPage(browser, VIEWPORTS.laptop);
  await gotoMedia(page);
  await openHouse(page, VIEWPORTS.laptop);
  await expect(page.getByTestId(`house-started-by-${A}`)).toContainText(routine, { timeout: 30000 });
  await expect(page.getByTestId(`fleet-card-${A}`)).toContainText('Hospital', { timeout: 30000 });

  await idle(request);
  await context.close();
  await receiver.context.close();
});

test('[AUTO.1a/AC3] a routine that cannot start is reported like any failed send: on the screen row in the house overview and in routine history', async ({ browser, request }) => {
  // The offline fixture screen was heard once and never connects: the routine fails honestly.
  const routine = `Journey guest routine ${randomUUID().slice(0, 4)}`;
  const failed = await ha.load('acceptance-offline', { play: ITEM.HOSPITAL, routine });
  expect(failed.body?.ok === false || failed.status >= 400).toBe(true);
  await expect.poll(async () => (await ha.history()).some((run) => run.routine?.name === routine), { timeout: 15000 }).toBe(true);
  const run = (await ha.history()).find((r) => r.routine?.name === routine);
  expect(run).toMatchObject({ outcome: 'failed', deviceId: 'fleet:acceptance-offline' });
  expect(run.reason).toBeTruthy();

  const { context, page } = await newAppPage(browser, VIEWPORTS.laptop);
  await gotoMedia(page);
  await openHouse(page, VIEWPORTS.laptop);
  await expect(page.getByTestId('fleet-card-acceptance-offline')).toBeVisible({ timeout: 30000 });
  await expect(page.getByTestId('fleet-card-acceptance-offline')).toContainText(/couldn.t start|failed|not sent|Last start/i, { timeout: 30000 });
  await context.close();
});

test('[AUTO.2a/AC2][AUTO.2a/AC3] a routine-started screen keeps its spot through a reload, and a person pressing Pause is not fought by the same trigger firing again', async ({ browser, request }) => {
  let receiver = await openReceiver(browser, request, A);
  await resetControls(request, A);
  const routine = `Journey spot routine ${randomUUID().slice(0, 4)}`;
  const query = { play: ITEM.HOSPITAL, routine };
  expect((await ha.load(A, query)).status).toBe(200);
  await expect.poll(async () => {
    const snap = await receiverState(request, A);
    return snap?.state === 'playing' && snap?.currentItem?.contentId === ITEM.HOSPITAL;
  }, { timeout: 120000 }).toBe(true);
  await expect.poll(async () => (await receiverState(request, A))?.position, { timeout: 30000 }).toBeGreaterThan(3);
  await receiver.page.waitForTimeout(6000); // the spot is persisted every 5 s
  const before = await receiverState(request, A);

  // AC2: the screen is reloaded (power cut): the routine's content is NOT restarted from the beginning.
  receiver = await reopenReceiver(receiver, request, A);
  await expect.poll(async () => {
    const snap = await receiverState(request, A);
    return snap?.currentItem?.contentId === ITEM.HOSPITAL ? snap.position : null;
  }, { timeout: 60000 }).toBeGreaterThanOrEqual(Math.max(3, Math.floor(before.position) - 6));
  const afterReload = await receiverState(request, A);
  expect(afterReload.state).not.toBe('playing');
  expect(afterReload.currentItem.contentId).toBe(ITEM.HOSPITAL);

  // AC3: a person acts on the screen after the routine; the routine does not fight it.
  // The person presses Play then Pause from the screen's own Remote in the app.
  const { context, page } = await newAppPage(browser, VIEWPORTS.laptop);
  await gotoMedia(page);
  await openHouse(page, VIEWPORTS.laptop);
  await page.getByTestId(`fleet-peek-${A}`).click();
  await expect(page.getByTestId('peek-panel')).toBeVisible();
  const toggle = page.getByTestId('np-toggle').first();
  await expect(toggle).toBeVisible({ timeout: 30000 });
  await toggle.click();
  await expect.poll(async () => (await receiverState(request, A))?.state, { timeout: 60000 }).toBe('playing');
  await toggle.click();
  await expect.poll(async () => (await receiverState(request, A))?.state, { timeout: 30000 }).toBe('paused');
  // The same trigger fires again inside its window: nothing resumes or restarts.
  const again = await ha.load(A, query);
  expect(again.status).toBe(200);
  await page.waitForTimeout(4000);
  const final = await receiverState(request, A);
  expect(final.state).toBe('paused');
  expect(final.currentItem.contentId).toBe(ITEM.HOSPITAL);

  await idle(request);
  await context.close();
  await receiver.context.close();
});

test('[AUTO.1b/AC1-AC3] a routine can start playback on a named browser left open, still reaches it after it is renamed, and the start looks like someone started it there', async ({ browser, request }) => {
  // The routine addresses the tab by its stable id over its client-control topic
  // (the fake Home Assistant caller's browser path), never by its name.
  const suffix = randomUUID().slice(0, 4);
  const firstName = `Kitchen tablet ${suffix}`;
  const secondName = `Pantry tablet ${suffix}`;
  const stableId = `auto1b-${suffix}`;
  const { context: tabletContext, page: tablet } = await newAppPage(browser, VIEWPORTS.laptop);
  await pinBrowserIdentity(tabletContext, { clientId: stableId, name: firstName });
  await gotoMedia(tablet);
  await expect(tablet.getByRole('textbox', { name: 'Search media…' })).toBeVisible({ timeout: 40000 });
  const { context, page } = await newAppPage(browser, VIEWPORTS.laptop);
  await gotoMedia(page);
  await openHouse(page, VIEWPORTS.laptop);
  const card = page.getByTestId(`fleet-card-browser:${stableId}`);
  await expect(card).toContainText(firstName, { timeout: 40000 });

  // AC1: the named tab is a routine target.
  const routine = `Journey tablet routine ${suffix}`;
  const first = await ha.loadBrowser(stableId, { play: ITEM.ARRIVAL, routine });
  expect(first, 'the tab acknowledged the routine').toMatchObject({ ok: true });
  // AC3: it plays on that device like a start made there: its own player and the house overview shows the tablet playing it.
  const native = tablet.locator('.video-player video');
  await expect(native).toBeVisible({ timeout: 60000 });
  await expect.poll(() => native.evaluate((video) => video.readyState >= 2 && !video.paused && video.currentTime > 0), { timeout: 60000 }).toBe(true);
  await expect(tablet.getByTestId('mini-player-open-nowplaying')).toContainText('Arrival', { timeout: 60000 });
  await expect(card).toContainText('Arrival', { timeout: 40000 });
  // ... and says the routine started it, as for any routine-started screen.
  await expect(page.getByTestId(`house-started-by-browser:${stableId}`)).toContainText(routine, { timeout: 40000 });

  // AC2: the tab is renamed; the routine still reaches it (it follows the tab, not the name).
  await tablet.getByTestId('settings-menu-trigger').click();
  await tablet.getByTestId('settings-rename-device').click();
  await tablet.getByRole('textbox', { name: 'Device name' }).fill(secondName);
  await tablet.getByRole('button', { name: 'Save device name' }).click();
  await expect(card).toContainText(secondName, { timeout: 40000 });
  const second = await ha.loadBrowser(stableId, { play: ITEM.HOSPITAL, routine: `${routine} again` });
  expect(second, 'the renamed tab still acknowledged the routine').toMatchObject({ ok: true });
  await expect(tablet.getByTestId('mini-player-open-nowplaying')).toContainText('Hospital', { timeout: 60000 });
  await expect(card).toContainText(secondName);

  await context.close();
  await tabletContext.close();
});
