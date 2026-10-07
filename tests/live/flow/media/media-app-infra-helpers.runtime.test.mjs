import { test, expect } from '@playwright/test';
import { markFirstUseDone } from './lib/firstUse.mjs';
import { installNetworkControl } from './lib/networkLoss.mjs';
import { installFakeClock } from './lib/fakeClock.mjs';
import { createHomeAssistantCaller, HA_FIXTURE_ROUTINE } from '../../../_lib/media-ha-caller.mjs';

// Phase 1 infrastructure demos (media proof gaps): each shared helper proves
// itself against the acceptance server before a journey depends on it.
//   - network loss: the browser goes offline, its bus socket is dropped and new
//     sockets are refused; on restore the app reconnects on its own;
//   - fake clock: a 30-minute timer in the page fires after a 30-minute jump;
//   - fake Home Assistant: a HomeAssistant User-Agent load is recorded by the
//     real recorder as a routine run in the routine history the House view reads;
//   - fixture screens + virtual device control + seeded reset over HTTP.

test.beforeEach(async ({ context }) => { await markFirstUseDone(context); });
test.use({ viewport: { width: 1440, height: 900 } });

test('[INFRA.netloss] network loss helper drops the bus socket, refuses new ones, and the app reconnects on restore', async ({ page }) => {
  test.setTimeout(120000);
  const net = await installNetworkControl(page);
  await page.goto('/media', { waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('home-view')).toBeVisible({ timeout: 60000 });
  await expect.poll(() => net.accepted, { timeout: 30000, message: 'the Media app opens its bus socket' }).toBeGreaterThan(0);

  const before = net.accepted;
  await net.lose();
  expect(net.offline).toBe(true);
  await expect.poll(() => page.evaluate(() => navigator.onLine)).toBe(false);
  // The socket really closed: every live route was dropped, and the app's retries are refused.
  await expect.poll(() => net.refused, { timeout: 60000, message: 'the app retries while offline and is refused' }).toBeGreaterThan(0);

  await net.restore();
  await expect.poll(() => page.evaluate(() => navigator.onLine)).toBe(true);
  await net.waitForSocket({ after: before, timeout: 90000 });
  expect(net.accepted).toBeGreaterThan(before);
});

test('[INFRA.clock] fake clock helper jumps a 30-minute timer without waiting for it', async ({ page }) => {
  const clock = await installFakeClock(page);
  await page.goto('/media', { waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('home-view')).toBeVisible({ timeout: 60000 });
  const startedAt = await clock.now();
  await page.evaluate(() => { window.__sleepFired = false; setTimeout(() => { window.__sleepFired = true; }, 30 * 60_000); });
  await clock.advanceMinutes(29);
  expect(await page.evaluate(() => window.__sleepFired)).toBe(false);
  await clock.advanceMinutes(1);
  expect(await page.evaluate(() => window.__sleepFired)).toBe(true);
  expect((await clock.now()) - startedAt).toBeGreaterThanOrEqual(30 * 60_000);
});

test('[INFRA.ha] fake Home Assistant load runs the real recorder and lands in the routine history', async ({ page, baseURL }) => {
  await page.request.post(`${baseURL}/api/v1/media/_fixture/reset`);
  const ha = createHomeAssistantCaller({ baseUrl: baseURL });
  const before = (await ha.history()).length;
  const result = await ha.fireRoutine();
  expect(result.status).toBe(200);
  await expect.poll(async () => (await ha.history()).length).toBeGreaterThan(before);
  const [latest] = await ha.history();
  expect(latest.routine).toMatchObject({ id: HA_FIXTURE_ROUTINE.id, name: HA_FIXTURE_ROUTINE.name });
  expect(latest.deviceId).toBe('fleet:acceptance-media');
  // The same run is what the House view reads.
  const flags = await (await page.request.get(`${baseURL}/api/v1/media/routines/flags`)).json();
  expect(Array.isArray(flags.items)).toBe(true);
});

test('[INFRA.screens] the registry lists the speaker, offline and power screens; power calls are recorded and reset clears them', async ({ page, baseURL }) => {
  await page.request.post(`${baseURL}/api/v1/media/_fixture/reset`);
  const view = await (await page.request.get(`${baseURL}/api/v1/media/screens`)).json();
  const byId = Object.fromEntries(view.screens.map((s) => [s.screenId, s]));
  expect(byId['acceptance-speaker']).toMatchObject({ type: 'speaker', wakeable: false });
  expect(byId['acceptance-offline'].online).not.toBe(true);
  expect(byId['acceptance-power']).toMatchObject({ wakeable: true });
  expect(view.notSeenLately.map((s) => s.id)).toEqual(['browser:oldtablet']);
  const off = await (await page.request.get(`${baseURL}/api/v1/device/acceptance-power/off`)).json();
  expect(off).toMatchObject({ ok: true, virtual: true, action: 'off' });
  const { calls } = await (await page.request.get(`${baseURL}/api/v1/device/acceptance-power/device-control-calls`)).json();
  expect(calls.map((c) => c.action)).toEqual(['off']);
  await page.request.post(`${baseURL}/api/v1/media/_fixture/reset`);
  expect((await (await page.request.get(`${baseURL}/api/v1/device/acceptance-power/device-control-calls`)).json()).calls).toEqual([]);
});
