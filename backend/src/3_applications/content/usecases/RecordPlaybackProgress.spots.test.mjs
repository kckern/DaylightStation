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
    expect(state.lastDevice).toBeNull();
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
