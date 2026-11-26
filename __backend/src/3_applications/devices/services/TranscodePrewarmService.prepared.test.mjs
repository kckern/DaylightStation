// PLAY reuses a look's prepare: the info view's POST /device/:id/prepare
// decides the playback (queue + Plex decision, no transcoder), and the
// WakeAndLoad prewarm step for the same (screen, item) within two minutes
// starts from that decision instead of deciding again.
import { describe, expect, it, vi } from 'vitest';
import { TranscodePrewarmService, PREPARED_TTL_MS } from './TranscodePrewarmService.mjs';
import { DevicePlaybackPrepareService } from './DevicePlaybackPrepareService.mjs';

function build({ startAt = 1_000_000 } = {}) {
  const clock = { t: startAt, now() { return this.t; } };
  const first = { id: 'plex:2', source: 'plex', resumePosition: 0 };
  const contentCatalog = {
    resolvePlayables: vi.fn(async () => [first]),
    preparePlayback: vi.fn(async () => {
      clock.t += 900; // the Plex decision is the slow part
      return { kind: 'ready', url: '/proxy/plex/decided.mpd?session=s1' };
    }),
  };
  const queueService = { resolveQueue: vi.fn(async (items) => items) };
  const httpClient = { get: vi.fn(async () => ({})) };
  const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn() };
  let n = 0;
  const service = new TranscodePrewarmService({
    contentIdResolver: { resolve: () => ({ source: 'plex', localId: '1' }) },
    contentCatalog, queueService, httpClient, clock, logger,
    createToken: () => `token${++n}`,
    scheduler: { after: () => () => {} },
  });
  return { service, clock, contentCatalog, queueService, httpClient, logger };
}

const look = (service, deviceId = 'office-tv', ref = 'plex:1') =>
  service.prewarm(ref, { shuffle: false, startTranscoder: false, deviceId });
const play = (service, deviceId = 'office-tv', ref = 'plex:1', shuffle = false) =>
  service.prewarm(ref, { shuffle, deviceId });

describe('TranscodePrewarmService — PLAY reuses a prepare', () => {
  it('a prepare starts no transcoder and mints no token', async () => {
    const { service, httpClient } = build();
    const result = await look(service);
    expect(result).toMatchObject({ status: 'ok', token: null, contentId: 'plex:2', transcoder: false });
    expect(httpClient.get).not.toHaveBeenCalled();
  });

  it('hit: PLAY on the same screen and item skips the decision and starts the transcoder on the decided URL', async () => {
    const { service, contentCatalog, queueService, httpClient, logger } = build();
    await look(service);
    expect(contentCatalog.preparePlayback).toHaveBeenCalledTimes(1);
    const result = await play(service);
    expect(result).toMatchObject({ status: 'ok', token: 'token1', contentId: 'plex:2', queueContentIds: ['plex:2'], reused: true });
    expect(contentCatalog.preparePlayback).toHaveBeenCalledTimes(1);
    expect(queueService.resolveQueue).toHaveBeenCalledTimes(1);
    expect(httpClient.get).toHaveBeenCalledWith('/proxy/plex/decided.mpd?session=s1');
    expect(service.redeem('token1')).toBe('/proxy/plex/decided.mpd?session=s1');
    expect(logger.info).toHaveBeenCalledWith('play.prepared-reused',
      { deviceId: 'office-tv', contentRef: 'plex:1', contentId: 'plex:2', savedMs: 900 });
  });

  it('is taken once: a second PLAY decides afresh', async () => {
    const { service, contentCatalog } = build();
    await look(service);
    await play(service);
    const again = await play(service);
    expect(again.reused).toBeUndefined();
    expect(contentCatalog.preparePlayback).toHaveBeenCalledTimes(2);
  });

  it('miss: PLAY without a prepare decides as before', async () => {
    const { service, contentCatalog, httpClient } = build();
    const result = await play(service);
    expect(result.reused).toBeUndefined();
    expect(result).toMatchObject({ status: 'ok', token: 'token1' });
    expect(contentCatalog.preparePlayback).toHaveBeenCalledTimes(1);
    expect(httpClient.get).toHaveBeenCalledTimes(1);
  });

  it('expired: a prepare older than the TTL is not reused', async () => {
    const { service, clock, contentCatalog } = build();
    await look(service);
    clock.t += PREPARED_TTL_MS + 1;
    const result = await play(service);
    expect(result.reused).toBeUndefined();
    expect(contentCatalog.preparePlayback).toHaveBeenCalledTimes(2);
  });

  it('just inside the TTL is still reused', async () => {
    const { service, clock } = build();
    await look(service);
    clock.t += PREPARED_TTL_MS - 1;
    expect((await play(service)).reused).toBe(true);
  });

  it('another screen misses', async () => {
    const { service, contentCatalog } = build();
    await look(service, 'office-tv');
    expect((await play(service, 'livingroom-tv')).reused).toBeUndefined();
    expect(contentCatalog.preparePlayback).toHaveBeenCalledTimes(2);
    // …and the office prepare is still there for the office.
    expect((await play(service, 'office-tv')).reused).toBe(true);
  });

  it('another item misses', async () => {
    const { service, contentCatalog } = build();
    await look(service, 'office-tv', 'plex:1');
    expect((await play(service, 'office-tv', 'plex:7')).reused).toBeUndefined();
    expect(contentCatalog.preparePlayback).toHaveBeenCalledTimes(2);
  });

  it('a shuffled PLAY misses (the queue order differs)', async () => {
    const { service } = build();
    await look(service);
    expect((await play(service, 'office-tv', 'plex:1', true)).reused).toBeUndefined();
  });

  it('without a deviceId nothing is cached or reused', async () => {
    const { service, contentCatalog } = build();
    await service.prewarm('plex:1', { startTranscoder: false });
    await service.prewarm('plex:1', {});
    expect(contentCatalog.preparePlayback).toHaveBeenCalledTimes(2);
  });

  it('a failed decision is not cached', async () => {
    const { service, contentCatalog } = build();
    contentCatalog.preparePlayback.mockResolvedValueOnce({ kind: 'failed', reason: 'transient', permanent: false });
    await look(service);
    expect((await play(service)).reused).toBeUndefined();
  });
});

describe('DevicePlaybackPrepareService — a look never touches a screen', () => {
  it('prepares through the real prewarm with no power, wake, load or transcode', async () => {
    const { service: prewarm, httpClient, contentCatalog } = build();
    const spy = vi.spyOn(prewarm, 'prewarm');
    // A configuration that also offers a device gateway: prepare must not use it.
    const gateway = { powerOn: vi.fn(), loadContent: vi.fn(), sendCommand: vi.fn(), wake: vi.fn() };
    const configuration = { device: vi.fn(() => ({ type: 'linux-pc' })), ...gateway };
    const prepare = new DevicePlaybackPrepareService({ prewarm, configuration });
    const result = await prepare.prepare('office-tv', 'plex:1');
    expect(result).toMatchObject({ kind: 'prepared', status: 'ok', contentId: 'plex:2' });
    expect(spy).toHaveBeenCalledWith('plex:1', { shuffle: false, startTranscoder: false, deviceId: 'office-tv' });
    expect(contentCatalog.preparePlayback).toHaveBeenCalledTimes(1);
    expect(httpClient.get).not.toHaveBeenCalled(); // no MPD fetch = no transcoder
    for (const fn of Object.values(gateway)) expect(fn).not.toHaveBeenCalled();
  });
});
