import { describe, it, expect, vi } from 'vitest';
import { ScreenPlaybackService, readOrigin } from './ScreenPlaybackService.mjs';
import { selectPlays } from '#domains/media/playLedger.mjs';

const NOW = Date.parse('2026-10-03T15:00:00.000Z');
const at = (minAgo) => new Date(NOW - minAgo * 60_000).toISOString();
const routine = { kind: 'routine', id: 'automation:kitchen_button_1', name: 'Kitchen Button 1' };

function build({ rows = [], snapshot = null, nowPlaying = [], aliases = null, browserPlayback = null } = {}) {
  const playLedger = { plays: vi.fn(async (q) => selectPlays(rows, { deviceId: q.deviceId, from: q.from, limit: q.limit })) };
  const memory = {
    nowPlaying: async () => ({ known: true, list: nowPlaying }),
    describeMany: vi.fn(async (ids) => new Map(ids.map((id) => [id, { title: `Title ${id}`, thumbnail: `/thumb/${id}`, type: 'episode', parentTitle: 'S1', grandparentTitle: 'Show' }]))),
  };
  const screens = {
    resolve: async (id) => id,
    aliasesOf: async (id) => aliases ?? [id],
    nameOf: async (id) => ({ 'browser:dad': "Dad's laptop" }[id] ?? null),
  };
  const livenessService = { getLastSnapshot: (id) => (snapshot && id === 'livingroom-tv' ? { online: true, snapshot } : null) };
  const service = new ScreenPlaybackService({ playLedger, livenessService, memory, screens, browserPlayback, clock: { now: () => NOW }, logger: { warn: vi.fn() } });
  return { service, memory, playLedger };
}

describe('readOrigin', () => {
  it('reads structured and legacy text origins', () => {
    expect(readOrigin(routine)).toEqual(routine);
    expect(readOrigin('routine:morning')).toEqual({ kind: 'routine', id: null, name: 'morning' });
    expect(readOrigin('browser:abc')).toEqual({ kind: 'device', id: 'browser:abc', name: null });
    expect(readOrigin(null)).toBeNull();
  });
});

describe('ScreenPlaybackService.startedBy', () => {
  it('a routine-started queue: every item of the run is "started by" the routine, at the run\'s first start', async () => {
    const rows = [
      { deviceId: 'fleet:livingroom-tv', contentId: 'plex:3', title: 'Third', startedAt: at(5), origin: null },
      { deviceId: 'fleet:livingroom-tv', contentId: 'plex:2', title: 'Second', startedAt: at(25), origin: null },
      { deviceId: 'fleet:livingroom-tv', contentId: 'plex:1', title: 'First', startedAt: at(50), origin: routine },
      { deviceId: 'fleet:livingroom-tv', contentId: 'plex:0', title: 'Yesterday', startedAt: at(600), origin: { kind: 'device', id: 'browser:dad' } },
    ];
    const { service } = build({ rows, nowPlaying: [{ deviceId: 'fleet:livingroom-tv', contentId: 'plex:3' }] });
    expect(await service.startedBy({ deviceId: 'livingroom-tv' })).toEqual({
      deviceId: 'fleet:livingroom-tv',
      playing: { contentId: 'plex:3', title: 'Third' },
      startedBy: routine,
      at: at(50),
      source: 'ledger',
      runStartedAt: at(50),
    });
  });

  it('a quiet gap ends the run: an older origin does not leak into a new run', async () => {
    const rows = [
      { deviceId: 'fleet:livingroom-tv', contentId: 'plex:9', startedAt: at(5), origin: null },
      { deviceId: 'fleet:livingroom-tv', contentId: 'plex:1', startedAt: at(120), origin: routine },
    ];
    const { service } = build({ rows });
    const result = await service.startedBy({ deviceId: 'fleet:livingroom-tv' });
    expect(result.startedBy).toBeNull();
    expect(result.playing).toBeNull(); // nothing reports playing now
    expect(result.runStartedAt).toBe(at(5));
  });

  it('the live snapshot\'s origin wins and a device origin is named from the registry', async () => {
    const rows = [{ deviceId: 'fleet:livingroom-tv', contentId: 'plex:7', title: 'Seven', startedAt: at(3), origin: routine }];
    const snapshot = { currentItem: { contentId: 'plex:7' }, meta: { origin: { kind: 'device', id: 'browser:dad' }, updatedAt: at(1) } };
    const { service } = build({ rows, snapshot });
    expect(await service.startedBy({ deviceId: 'livingroom-tv' })).toMatchObject({
      startedBy: { kind: 'device', id: 'browser:dad', name: "Dad's laptop" }, at: at(3), source: 'snapshot',
    });
  });

  it('a browser tab a routine started: its own state frame names the routine, before any ledger row exists', async () => {
    const browserPlayback = { get: (id) => (id === 'browser:k' ? { deviceId: 'browser:k', contentId: 'plex:5', origin: routine, at: NOW } : null), list: () => [{ deviceId: 'browser:k', contentId: 'plex:5', origin: routine, at: NOW }] };
    const { service } = build({ browserPlayback });
    expect(await service.startedBy({ deviceId: 'browser:k' })).toMatchObject({
      playing: { contentId: 'plex:5' }, startedBy: routine, source: 'snapshot',
    });
    const { items } = await service.startedByAll({});
    expect(items.map((i) => i.deviceId)).toEqual(['browser:k']);
    expect(items[0].startedBy).toEqual(routine);
  });

  it('a browser frame about another item does not name its origin for this one', async () => {
    const browserPlayback = { get: () => ({ deviceId: 'browser:k', contentId: 'plex:9', origin: routine, at: NOW }), list: () => [] };
    const { service } = build({ browserPlayback, nowPlaying: [{ deviceId: 'browser:k', contentId: 'plex:5' }] });
    expect((await service.startedBy({ deviceId: 'browser:k' })).startedBy).toBeNull();
  });

  it('startedByAll answers for every screen playing now', async () => {
    const rows = [{ deviceId: 'browser:k', contentId: 'plex:5', startedAt: at(2), origin: routine }];
    const { service } = build({ rows, nowPlaying: [{ deviceId: 'browser:k', contentId: 'plex:5' }] });
    const { items } = await service.startedByAll({});
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ deviceId: 'browser:k', startedBy: routine });
  });
});

describe('ScreenPlaybackService.playedEarlier', () => {
  it('newest first, with picture and title, across merged duplicates, minus what is playing now', async () => {
    const rows = [
      { deviceId: 'browser:new', contentId: 'plex:3', title: 'Third', startedAt: at(1), localTime: 'l3' },
      { deviceId: 'browser:old', contentId: 'plex:2', title: 'Second', startedAt: at(10), localTime: 'l2', parentId: 'plex:20', origin: routine },
      { deviceId: 'browser:other', contentId: 'plex:x', startedAt: at(11) },
      { deviceId: 'browser:old', contentId: 'plex:1', title: 'First', startedAt: at(20), localTime: 'l1' },
    ];
    const { service, memory } = build({ rows, aliases: ['browser:old', 'browser:new'], nowPlaying: [{ deviceId: 'browser:new', contentId: 'plex:3' }] });
    const { deviceId, items } = await service.playedEarlier({ deviceId: 'browser:old', limit: 10 });
    expect(deviceId).toBe('browser:old');
    expect(items.map((i) => i.contentId)).toEqual(['plex:2', 'plex:1']);
    expect(items[0]).toEqual({
      contentId: 'plex:2', startedAt: at(10), localTime: 'l2', title: 'Title plex:2', thumbnail: '/thumb/plex:2', type: 'episode',
      parentTitle: 'S1', grandparentTitle: 'Show', parentId: 'plex:20', grandparentId: null, playedOn: 'browser:old', origin: routine,
    });
    expect(memory.describeMany).toHaveBeenCalledWith(['plex:2', 'plex:1']);
  });

  it('pages with before= and caps limit', async () => {
    const rows = Array.from({ length: 5 }, (_, i) => ({ deviceId: 'fleet:tv', contentId: `plex:${i}`, startedAt: at(i * 10) }));
    const { service } = build({ rows });
    const page = await service.playedEarlier({ deviceId: 'fleet:tv', before: at(15), limit: 2 });
    expect(page.items.map((i) => i.contentId)).toEqual(['plex:2', 'plex:3']);
  });
});
