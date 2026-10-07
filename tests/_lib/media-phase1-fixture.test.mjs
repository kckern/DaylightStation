// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import http from 'node:http';
import request from 'supertest';
import {
  createMediaOrdinaryDeviceFixture, SPEAKER_DEVICE_ID, OFFLINE_DEVICE_ID, POWER_DEVICE_ID,
} from './media-ordinary-device-fixture.mjs';
import { createAllowlistedCatalog, seedAllowlist } from './media-household-fixture.mjs';
import { createHomeAssistantCaller, HA_USER_AGENT, HA_FIXTURE_ROUTINE } from './media-ha-caller.mjs';

const gateway = {
  resolveSource: (source, localId) => ({ source, localId }),
  progressNamespace: async () => 'plex/seed',
  getItem: async (_r, ref) => ({ id: ref, title: `T ${ref}`, thumbnail: `/t/${ref}`, metadata: { type: 'movie' } }),
  getList: async () => [],
};
let fixture; let server; let baseUrl;

// The fixture's middleware routes /api/v1/... exactly as the acceptance server does.
beforeEach(async () => {
  fixture = createMediaOrdinaryDeviceFixture({ upstream: 'http://127.0.0.1:3111', catalog: createAllowlistedCatalog(gateway, seedAllowlist()) });
  server = http.createServer(async (req, res) => {
    if (!(await fixture.middleware(req, res))) { res.statusCode = 404; res.end('not handled'); }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});
afterEach(async () => { await new Promise((resolve) => server.close(resolve)); await fixture.stop(); });

const screens = async () => (await fetch(`${baseUrl}/api/v1/media/screens`)).json();
const config = async () => (await fetch(`${baseUrl}/api/v1/device/config`)).json();

describe('Phase 1 fixture screens', () => {
  it('registers a speaker-kind receiver, an offline screen and a power screen, each in its own room', async () => {
    const { screens: list } = await screens();
    const byId = Object.fromEntries(list.map((s) => [s.screenId, s]));
    expect(byId[SPEAKER_DEVICE_ID]).toMatchObject({ type: 'speaker', room: 'Acceptance kitchen', wakeable: false });
    expect(byId[OFFLINE_DEVICE_ID]).toMatchObject({ room: 'Acceptance guest room' });
    expect(byId[POWER_DEVICE_ID]).toMatchObject({ room: 'Acceptance den', wakeable: true });
    const { devices } = await config();
    expect(devices[SPEAKER_DEVICE_ID]).toMatchObject({ type: 'speaker', icon: 'speaker' });
    expect(devices[POWER_DEVICE_ID].device_control).toBeTruthy();
    expect(devices[OFFLINE_DEVICE_ID].device_control).toBeUndefined();
    expect(devices['acceptance-media'].device_control).toBeUndefined();
  });

  it('an offline screen was heard once and never connects again: liveness reads offline, a send fails honestly', async () => {
    await new Promise((resolve) => setTimeout(resolve, 50));
    const { screens: list } = await screens();
    const offline = list.find((s) => s.screenId === OFFLINE_DEVICE_ID);
    expect(offline.online).toBe(false);
    expect(offline.lastSeen).toBeTruthy();
    // The routine pointed at it is flagged ahead of time (unreachable, since it cannot be woken).
    const flags = await (await fetch(`${baseUrl}/api/v1/media/routines/flags`)).json();
    expect(flags.items.map((f) => [f.problem, f.screenId ?? f.deviceId])).toContainEqual(['unreachable', `fleet:${OFFLINE_DEVICE_ID}`]);
    const sent = await (await fetch(`${baseUrl}/api/v1/device/${OFFLINE_DEVICE_ID}/load?play=plex:55854&dispatchId=to-offline`)).json();
    expect(sent.ok).toBe(false);
  });

  it('lists the screen silent for 45 days under not seen lately, not among live screens', async () => {
    const view = await screens();
    expect(view.notSeenLately.map((s) => s.id)).toEqual(['browser:oldtablet']);
    expect(view.screens.map((s) => s.id)).not.toContain('browser:oldtablet');
  });

  it('answers virtual device control for the power screen only, recording each call and touching no hardware', async () => {
    const off = await (await fetch(`${baseUrl}/api/v1/device/${POWER_DEVICE_ID}/off`)).json();
    expect(off).toMatchObject({ ok: true, deviceId: POWER_DEVICE_ID, action: 'off', virtual: true });
    await fetch(`${baseUrl}/api/v1/device/${POWER_DEVICE_ID}/on`);
    const { calls } = await (await fetch(`${baseUrl}/api/v1/device/${POWER_DEVICE_ID}/device-control-calls`)).json();
    expect(calls.map((c) => c.action)).toEqual(['off', 'on']);
    // Nobody else answers power; a physical device is refused.
    expect((await fetch(`${baseUrl}/api/v1/device/acceptance-media/off`)).status).toBe(403);
    expect((await fetch(`${baseUrl}/api/v1/device/livingroom-tv/off`)).status).toBe(403);
    // Reset clears the record.
    await fetch(`${baseUrl}/api/v1/media/_fixture/reset`, { method: 'POST' });
    expect((await (await fetch(`${baseUrl}/api/v1/device/${POWER_DEVICE_ID}/device-control-calls`)).json()).calls).toEqual([]);
  });
});

describe('fake Home Assistant caller', () => {
  it('runs the real recorder: routine origin, catalog match, history entry, no personal origin', async () => {
    const ha = createHomeAssistantCaller({ baseUrl });
    expect(ha.userAgent).toBe(HA_USER_AGENT);
    const before = (await ha.history()).length;
    const result = await ha.fireRoutine();
    expect(result.status).toBe(200);                       // no receiver mounted: the run fails, the route still answers
    await expect.poll(async () => (await ha.history()).length).toBe(before + 1);
    const [latest] = await ha.history();
    expect(latest.routine).toMatchObject({ id: HA_FIXTURE_ROUTINE.id, name: HA_FIXTURE_ROUTINE.name });
    expect(latest.deviceId).toBe('fleet:acceptance-media');
  });

  it('records each failed run (a failure is retried, not deduped); the 10 s dedupe needs a connected receiver', async () => {
    const ha = createHomeAssistantCaller({ baseUrl });
    const before = (await ha.history()).length;
    await Promise.all([ha.fireRoutine(), ha.fireRoutine()]);
    await expect.poll(async () => (await ha.history()).length).toBe(before + 2);
    const [a, b] = await ha.history();
    expect([a.outcome, b.outcome]).toEqual(['failed', 'failed']);
    expect(a.dispatchId).not.toBe(b.dispatchId);
  });

  it('a person sending the same load (no Home Assistant User-Agent) is not recorded as a routine', async () => {
    const ha = createHomeAssistantCaller({ baseUrl, userAgent: 'Mozilla/5.0 Chrome' });
    const before = (await ha.history()).length;
    await ha.fireRoutine();
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect((await ha.history()).length).toBe(before);
  });
});

describe('fixture reset', () => {
  it('puts the household back to its seed', async () => {
    await fetch(`${baseUrl}/api/v1/media/household/favourites`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: 'plex:55854', kind: 'item', title: 'Arrival' }) });
    expect((await (await fetch(`${baseUrl}/api/v1/media/household/favourites`)).json()).items.map((i) => i.id)).toContain('plex:55854');
    await fetch(`${baseUrl}/api/v1/media/_fixture/reset`, { method: 'POST' });
    expect((await (await fetch(`${baseUrl}/api/v1/media/household/favourites`)).json()).items.map((i) => i.id)).not.toContain('plex:55854');
  });

  it('?seed=empty resets to a household that has played nothing', async () => {
    await fetch(`${baseUrl}/api/v1/media/_fixture/reset?seed=empty`, { method: 'POST' });
    expect((await (await fetch(`${baseUrl}/api/v1/media/household/recent`)).json()).items).toEqual([]);
    await fetch(`${baseUrl}/api/v1/media/_fixture/reset`, { method: 'POST' });
    expect((await (await fetch(`${baseUrl}/api/v1/media/household/recent`)).json()).items.length).toBeGreaterThan(0);
  });

  it('without a catalog the household routes are not mounted (unit-test default)', async () => {
    const bare = createMediaOrdinaryDeviceFixture({ upstream: 'http://127.0.0.1:3111' });
    expect(bare.household).toBeNull();
    await request(bare.app).get('/acceptance-media/receiver-ready').expect(200);
    await bare.stop();
  });

  it('a load that names a volume runs the real volume step and records the level for that screen only (never hardware)', async () => {
    fixture.reset();
    const ha = createHomeAssistantCaller({ baseUrl });
    // No subscriber is mounted, so the load itself may fail; the volume step runs before it.
    await ha.load('acceptance-media', { play: 'plex:1', volume: '12' }).catch(() => null);
    const { calls } = await (await fetch(`${baseUrl}/api/v1/device/acceptance-media/device-control-calls`)).json();
    expect(calls).toEqual([expect.objectContaining({ deviceId: 'acceptance-media', action: 'volume', level: 12 })]);
    const other = await (await fetch(`${baseUrl}/api/v1/device/acceptance-media-b/device-control-calls`)).json();
    expect(other.calls).toEqual([]);
    fixture.reset();
    expect((await (await fetch(`${baseUrl}/api/v1/device/acceptance-media/device-control-calls`)).json()).calls).toEqual([]);
  });

  it('a send to the power screen runs the wake (Turning on) step and records it; a send to another screen has no wake step', async () => {
    fixture.reset();
    const ha = createHomeAssistantCaller({ baseUrl });
    await ha.load(POWER_DEVICE_ID, { play: 'plex:1' }).catch(() => null);
    const { calls } = await (await fetch(`${baseUrl}/api/v1/device/${POWER_DEVICE_ID}/device-control-calls`)).json();
    expect(calls.map((c) => c.action)).toContain('on');
    await ha.load(SPEAKER_DEVICE_ID, { play: 'plex:1' }).catch(() => null);
    expect((await (await fetch(`${baseUrl}/api/v1/device/${SPEAKER_DEVICE_ID}/device-control-calls`)).json()).calls).toEqual([]);
    fixture.reset();
  });
});
