/**
 * RecordPlaybackProgress keeps a spot per screen (RQ-PLAY-09) while the
 * legacy single playhead goes on behaving exactly as before.
 */
import { describe, it, expect, vi } from 'vitest';
import { RecordPlaybackProgress } from './RecordPlaybackProgress.mjs';
import { MediaProgress } from '#domains/content/entities/MediaProgress.mjs';

function memoryWith(initial = null) {
  const saved = [];
  let current = initial;
  return {
    saved,
    findProgress: vi.fn(async () => current),
    saveProgress: vi.fn(async (state) => { saved.push(state); current = state; }),
  };
}

function build(memory, ts = '2026-10-02 08:00:00') {
  return new RecordPlaybackProgress({
    contentCatalog: { resolveSource: () => null },
    mediaProgressMemory: memory,
    createMediaProgress: (props) => new MediaProgress(props),
    nowTimestamp: () => ts,
    nowEpoch: () => 0,
    nowIso: () => '2026-10-02T15:00:00.000Z',
    logger: { info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
  });
}

const heartbeat = (over = {}) => ({ type: 'plex', assetId: 'plex:1', seconds: 720, percent: 10, ...over });

describe('RecordPlaybackProgress per-screen spots', () => {
  it('without a spot device the write is the legacy write (spots untouched)', async () => {
    const memory = memoryWith();
    await build(memory).execute(heartbeat());
    const state = memory.saved[0];
    expect(state.playhead).toBe(720);
    expect(state.spots).toBeUndefined();
    expect(state.lastDevice).toBeUndefined(); // untouched: persistence keeps any stored value
  });

  it('with a spot device it records that screen\'s spot and the last screen', async () => {
    const memory = memoryWith();
    const { response } = await build(memory).execute(heartbeat({ spotDeviceId: 'browser:kid' }));
    const state = memory.saved[0];
    expect(state.playhead).toBe(720);
    expect(state.spots).toEqual({ 'browser:kid': { playhead: 720, duration: 7200, percent: 10, lastPlayed: '2026-10-02 08:00:00' } });
    expect(state.lastDevice).toBe('browser:kid');
    expect(response.deviceId).toBe('browser:kid');
  });

  it('keeps the other screens\' spots when one screen reports', async () => {
    const tv = { playhead: 4800, duration: 7200, percent: 67, lastPlayed: '2026-10-01 21:00:00' };
    const memory = memoryWith(new MediaProgress({
      contentId: 'plex:1', playhead: 4800, duration: 7200, spots: { 'fleet:livingroom-tv': tv }, lastDevice: 'fleet:livingroom-tv',
    }));
    await build(memory).execute(heartbeat({ spotDeviceId: 'browser:kid' }));
    const state = memory.saved[0];
    expect(state.spots['fleet:livingroom-tv']).toEqual(tv);
    expect(state.spots['browser:kid'].playhead).toBe(720);
    expect(state.lastDevice).toBe('browser:kid');
    // legacy single playhead = latest report, as before
    expect(state.playhead).toBe(720);
  });

  it('ignores a spot device that cannot key a spot (ephemeral / user-agent)', async () => {
    const memory = memoryWith();
    await build(memory).execute(heartbeat({ spotDeviceId: 'ephemeral:abc' }));
    expect(memory.saved[0].spots).toBeUndefined();
  });
});

describe('RecordPlaybackProgress feeds the play ledger', () => {
  it('reports each heartbeat with a spot device, with item facts and origin', async () => {
    const memory = memoryWith();
    const playLedger = { observe: vi.fn().mockResolvedValue({ opened: true, written: true }) };
    const use = new RecordPlaybackProgress({
      contentCatalog: {
        resolveSource: () => ({ source: 'plex', localId: '1' }),
        progressNamespace: async () => 'plex/8_tv-shows',
        getItem: async () => ({ title: 'S1E2', type: 'episode', metadata: { type: 'episode', parentId: '10', grandparentId: '100' } }),
      },
      mediaProgressMemory: memory,
      playLedger,
      createMediaProgress: (props) => new MediaProgress(props),
      nowTimestamp: () => '2026-10-02 08:00:00',
      nowEpoch: () => 1_790_000_000_000,
      nowIso: () => '2026-10-02T15:00:00.000Z',
      logger: { info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
    });
    await use.execute(heartbeat({ spotDeviceId: 'fleet:livingroom-tv', origin: 'routine:morning' }));
    expect(playLedger.observe).toHaveBeenCalledWith({
      deviceId: 'fleet:livingroom-tv', contentId: 'plex:1', atEpoch: 1_790_000_000_000,
      startedAt: '2026-10-02T15:00:00.000Z', localTime: '2026-10-02 08:00:00',
      metadata: expect.objectContaining({ title: 'S1E2', type: 'episode', parentId: '10', grandparentId: '100' }),
      origin: 'routine:morning',
    });
  });
  it('a heartbeat with no spot device never reaches the ledger', async () => {
    const playLedger = { observe: vi.fn() };
    const use = new RecordPlaybackProgress({
      contentCatalog: { resolveSource: () => null }, mediaProgressMemory: memoryWith(), playLedger,
      createMediaProgress: (p) => new MediaProgress(p), nowTimestamp: () => 't', logger: { info: vi.fn(), warn: vi.fn() },
    });
    await use.execute(heartbeat());
    expect(playLedger.observe).not.toHaveBeenCalled();
  });
});

describe('two screens on one item: deltas come from the screen\'s own spot', () => {
  it('interleaved heartbeats neither inflate watchTime nor count fake replays', async () => {
    const memory = memoryWith(new MediaProgress({
      contentId: 'plex:1', playhead: 4800, duration: 7200, playCount: 1, watchTime: 5000,
      spots: {
        'fleet:livingroom-tv': { playhead: 4800, duration: 7200, percent: 67, lastPlayed: 'a' },
        'browser:kid': { playhead: 720, duration: 7200, percent: 10, lastPlayed: 'b' },
      },
      lastDevice: 'fleet:livingroom-tv',
    }));
    const use = build(memory);
    await use.execute(heartbeat({ spotDeviceId: 'browser:kid', seconds: 740, percent: 10.28 }));
    await use.execute(heartbeat({ spotDeviceId: 'fleet:livingroom-tv', seconds: 4810, percent: 66.8 }));
    await use.execute(heartbeat({ spotDeviceId: 'browser:kid', seconds: 760, percent: 10.56 }));
    const state = memory.saved.at(-1);
    expect(state.watchTime).toBe(5050); // +20 kid, +10 tv, +20 kid
    expect(state.playCount).toBe(1);
  });

  it('seeking back on one screen still counts as a replay of that screen', async () => {
    const memory = memoryWith(new MediaProgress({
      contentId: 'plex:1', playhead: 720, duration: 7200, playCount: 1,
      spots: { 'browser:kid': { playhead: 720, duration: 7200, percent: 10, lastPlayed: 'b' } }, lastDevice: 'browser:kid',
    }));
    await build(memory).execute(heartbeat({ spotDeviceId: 'browser:kid', seconds: 30, percent: 0.42 }));
    expect(memory.saved[0].playCount).toBe(2);
  });

  it('the first spot-aware write seeds an open legacy playhead as a "legacy" spot', async () => {
    const memory = memoryWith(new MediaProgress({ contentId: 'plex:1', playhead: 3000, duration: 7200, lastPlayed: '2026-09-01 10:00:00' }));
    await build(memory).execute(heartbeat({ spotDeviceId: 'browser:kid', seconds: 600, percent: 8.33 }));
    expect(memory.saved[0].spots.legacy).toMatchObject({ playhead: 3000, duration: 7200, lastPlayed: '2026-09-01 10:00:00' });
  });

  it('the legacy spot retires once a screen plays past it', async () => {
    const memory = memoryWith(new MediaProgress({
      contentId: 'plex:1', playhead: 3100, duration: 7200,
      spots: { legacy: { playhead: 3000, duration: 7200, percent: 42, lastPlayed: 'x' }, 'browser:kid': { playhead: 3090, duration: 7200, percent: 43, lastPlayed: 'y' } },
      lastDevice: 'browser:kid',
    }));
    await build(memory).execute(heartbeat({ spotDeviceId: 'browser:kid', seconds: 3110, percent: 43.2 }));
    expect(memory.saved[0].spots.legacy).toBeUndefined();
  });

  it('a finished legacy playhead is not seeded', async () => {
    const memory = memoryWith(new MediaProgress({ contentId: 'plex:1', playhead: 7100, duration: 7200 }));
    await build(memory).execute(heartbeat({ spotDeviceId: 'browser:kid', seconds: 600, percent: 8.33 }));
    expect(memory.saved[0].spots.legacy).toBeUndefined();
  });
});

describe('terminal reports and the play ledger', () => {
  for (const terminal of [{ naturalEnd: true }, { status: 'completed' }, { status: 'stopped' }, { status: 'ended' }]) {
    it(`does not observe a start on ${JSON.stringify(terminal)}, and ends the screen's session`, async () => {
      const playLedger = { observe: vi.fn(), end: vi.fn() };
      const use = new RecordPlaybackProgress({
        contentCatalog: { resolveSource: () => null }, mediaProgressMemory: memoryWith(), playLedger,
        createMediaProgress: (p) => new MediaProgress(p), nowTimestamp: () => 't', nowEpoch: () => 5, logger: { info: vi.fn(), warn: vi.fn() },
      });
      await use.execute(heartbeat({ spotDeviceId: 'browser:kid', ...terminal }));
      expect(playLedger.observe).not.toHaveBeenCalled();
      expect(playLedger.end).toHaveBeenCalledWith({ deviceId: 'browser:kid', at: 5 });
    });
  }
});

describe('spot device policy', () => {
  it('drops a fleet id the household does not declare', async () => {
    const memory = memoryWith();
    const use = new RecordPlaybackProgress({
      contentCatalog: { resolveSource: () => null }, mediaProgressMemory: memory,
      isKnownSpotDevice: (id) => id === 'fleet:livingroom-tv',
      createMediaProgress: (p) => new MediaProgress(p), nowTimestamp: () => 't', logger: { info: vi.fn(), warn: vi.fn() },
    });
    await use.execute(heartbeat({ spotDeviceId: 'fleet:made-up' }));
    expect(memory.saved[0].spots).toBeUndefined();
    await use.execute(heartbeat({ spotDeviceId: 'fleet:livingroom-tv' }));
    expect(memory.saved[1].spots['fleet:livingroom-tv']).toBeTruthy();
  });
});
