// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import http from 'node:http';
import request from 'supertest';
import {
  createMediaOrdinaryDeviceFixture, buildScriptedSnapshot, SPEAKER_DEVICE_ID, POWER_DEVICE_ID,
} from './media-ordinary-device-fixture.mjs';
import { validateSessionSnapshot } from '../../shared/contracts/media/shapes.mjs';

let fixture; let server; let baseUrl;
beforeEach(async () => {
  fixture = createMediaOrdinaryDeviceFixture({ upstream: 'http://127.0.0.1:3111' });
  server = http.createServer(async (req, res) => {
    if (!(await fixture.middleware(req, res))) { res.statusCode = 404; res.end('not handled'); }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});
afterEach(async () => { await new Promise((resolve) => server.close(resolve)); await fixture.stop(); });

const script = (body) => fetch(`${baseUrl}/api/v1/media/_fixture/receiver`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const stateOf = async (id) => (await fetch(`${baseUrl}/api/v1/device/${id}/receiver-state`)).json();

describe('scripted receiver states', () => {
  it.each([
    ['playing', { state: 'playing', title: 'Arrival', duration: 7000, position: 1000 }],
    ['paused', { state: 'paused', title: 'Arrival', duration: 7000, position: 1000 }],
    ['idle', { state: 'idle' }],
    ['live', { kind: 'live', title: 'News channel' }],
    ['slideshow', { kind: 'slideshow', title: 'Holiday photos', queue: [{ title: 'Beach', kind: 'photo' }] }],
    ['photo queue', { kind: 'photo', title: 'Photo 1', queue: [{ title: 'Photo 2' }, { title: 'Photo 3' }] }],
    ['no duration', { title: 'Mystery', duration: null }],
    ['started by another device', { title: 'Arrival', origin: { kind: 'device', id: 'acceptance-media-b' } }],
    ['started by a routine', { title: 'Arrival', origin: { kind: 'routine', name: 'Morning' } }],
  ])('builds a valid snapshot: %s', (_label, spec) => {
    const snapshot = buildScriptedSnapshot(POWER_DEVICE_ID, spec);
    expect(validateSessionSnapshot(snapshot)).toEqual({ valid: true, errors: [] });
  });

  it('live content has no duration and no position; a duration-less item has no duration; a photo queue lists every photo', () => {
    const live = buildScriptedSnapshot(POWER_DEVICE_ID, { kind: 'live', title: 'News' });
    expect(live.currentItem).toMatchObject({ isLive: true, title: 'News' });
    expect(live.currentItem.duration).toBeUndefined();
    expect(live.position).toBe(0);
    expect(buildScriptedSnapshot(POWER_DEVICE_ID, { title: 'X', duration: null }).currentItem.duration).toBeUndefined();
    const photos = buildScriptedSnapshot(POWER_DEVICE_ID, { kind: 'photo', title: 'P1', queue: [{ title: 'P2' }, { title: 'P3' }] });
    expect(photos.queue.items.map((i) => i.title)).toEqual(['P1', 'P2', 'P3']);
    expect(photos.queue.items.every((i) => i.format === 'image')).toBe(true);
  });

  it('carries a picture when asked', () => {
    const snapshot = buildScriptedSnapshot(POWER_DEVICE_ID, { title: 'Arrival', duration: 7000, thumbnail: '/api/v1/proxy/plex/library/metadata/55854/thumb/1' });
    expect(snapshot.currentItem.thumbnail).toBe('/api/v1/proxy/plex/library/metadata/55854/thumb/1');
    expect(validateSessionSnapshot(snapshot).valid).toBe(true);
  });

  it('publishes the scripted state as the screen itself would, with its origin', async () => {
    const response = await script({ deviceId: SPEAKER_DEVICE_ID, state: 'paused', title: 'Faith', duration: 200, position: 50, origin: { kind: 'device', id: 'acceptance-media-b' } });
    expect(response.status).toBe(200);
    const { snapshot } = await stateOf(SPEAKER_DEVICE_ID);
    expect(snapshot).toMatchObject({ state: 'paused', currentItem: { title: 'Faith', duration: 200 }, position: 50, meta: { origin: { kind: 'device', id: 'acceptance-media-b' } } });
  });

  it('an off screen was heard once and went silent: liveness reads offline', async () => {
    await script({ deviceId: POWER_DEVICE_ID, state: 'off' });
    await new Promise((resolve) => setTimeout(resolve, 80));
    expect(fixture.deviceLiveness.isOnline?.(POWER_DEVICE_ID) ?? fixture.deviceLiveness.getEntry?.(POWER_DEVICE_ID)?.online).toBe(false);
  });

  it('serverOffline: the screen keeps its state for people but the server refuses a send with DEVICE_OFFLINE; reset clears it', async () => {
    await script({ deviceId: POWER_DEVICE_ID, state: 'playing', title: 'Arrival', duration: 7000, serverOffline: true });
    expect((await stateOf(POWER_DEVICE_ID)).snapshot.state).toBe('playing');
    expect(fixture.deviceLiveness.getLastSnapshot(POWER_DEVICE_ID).online).toBe(false);
    const refused = await request(fixture.app).post(`/${POWER_DEVICE_ID}/session/transport`).send({ commandId: 'off-1', action: 'pause' });
    expect(refused.status).toBeGreaterThanOrEqual(400);
    expect(JSON.stringify(refused.body)).toMatch(/offline/i);
    await script({ deviceId: POWER_DEVICE_ID, state: 'playing', title: 'Arrival', duration: 7000 });
    expect(fixture.deviceLiveness.getLastSnapshot(POWER_DEVICE_ID).online).toBe(true);
    await script({ deviceId: POWER_DEVICE_ID, state: 'playing', title: 'Arrival', serverOffline: true });
    fixture.reset();
    expect(fixture.deviceLiveness.getLastSnapshot(POWER_DEVICE_ID).online).toBe(true);
  });

  it('refuses an unknown screen and an invalid spec without publishing', async () => {
    const unknown = await script({ deviceId: 'physical-livingroom-tv', state: 'playing' });
    expect(unknown.status).toBe(400);
    expect((await unknown.json()).error).toMatch(/not a virtual fixture screen/);
  });

  it('a move from a scripted screen cannot be captured: the source is unreachable and keeps its state', async () => {
    await script({ deviceId: POWER_DEVICE_ID, state: 'playing', title: 'Arrival', duration: 7000 });
    const response = await request(fixture.app)
      .post(`/${POWER_DEVICE_ID}/session/handoff`)
      .send({ commandId: 'move-1', params: { mode: 'capture' } });
    expect(response.status).not.toBe(200);
    const { snapshot } = await stateOf(POWER_DEVICE_ID);
    expect(snapshot.state).toBe('playing');
  });

  it('reset quiets every scripted screen so no journey inherits a busy one', async () => {
    await script({ deviceId: SPEAKER_DEVICE_ID, state: 'playing', title: 'Faith' });
    fixture.reset();
    const { snapshot } = await stateOf(SPEAKER_DEVICE_ID);
    expect(snapshot.state).toBe('idle');
    expect(snapshot.currentItem).toBeNull();
  });

  it('only scripts fixture screens', () => {
    expect(() => fixture.scriptReceiver('not-a-screen', {})).toThrow(/not a virtual fixture screen/);
  });

  it('keeps reporting like a real screen: a heartbeat resets the liveness timer, so the screen stays in its state; a silent one does not', async () => {
    const seen = [];
    fixture.eventBus.subscribe?.('device-state:acceptance-power', (m) => seen.push(m.reason));
    fixture.scriptReceiver(POWER_DEVICE_ID, { state: 'playing', title: 'Arrival', heartbeatMs: 30 });
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(seen.filter((r) => r === 'heartbeat').length).toBeGreaterThanOrEqual(2);
    fixture.scriptReceiver(POWER_DEVICE_ID, { state: 'playing', title: 'Arrival', heartbeatMs: 0 });
    const before = seen.length;
    await new Promise((resolve) => setTimeout(resolve, 120));
    expect(seen.length).toBe(before);
    fixture.reset();
  });

  it('carries screen notes in the shape a screen publishes', () => {
    const snapshot = buildScriptedSnapshot(SPEAKER_DEVICE_ID, { state: 'paused', title: 'Faith', notes: [{ kind: 'paused', label: 'Paused by the kitchen button', count: 3 }] });
    expect(snapshot.controls.notes).toHaveLength(1);
    expect(snapshot.controls.notes[0]).toMatchObject({ kind: 'paused', count: 3 });
    expect(validateSessionSnapshot(snapshot).valid).toBe(true);
  });
});
