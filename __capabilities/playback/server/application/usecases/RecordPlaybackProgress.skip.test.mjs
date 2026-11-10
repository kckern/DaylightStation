/**
 * RecordPlaybackProgress infers deliberate skips from a screen's heartbeat
 * stream (see domain/services/skipInference.mjs) and records them on the
 * skipped item, so next-up stops re-serving it.
 */
import { describe, it, expect, vi } from 'vitest';
import { RecordPlaybackProgress } from "./RecordPlaybackProgress.mjs";
import { MediaProgress } from "../../../../content-catalog/server/domain/entities/MediaProgress.mjs";

function store() {
  const rows = new Map();
  return {
    rows,
    findProgress: vi.fn(async (id) => rows.get(id) ?? null),
    saveProgress: vi.fn(async (state) => { rows.set(state.contentId, state); }),
  };
}

function build(memory) {
  let now = 0;
  const logger = { info: vi.fn(), warn: vi.fn(), debug: vi.fn() };
  const useCase = new RecordPlaybackProgress({
    contentCatalog: { resolveSource: () => null },
    mediaProgressMemory: memory,
    createMediaProgress: (props) => new MediaProgress(props),
    nowTimestamp: () => '2026-10-29 07:15:00',
    nowEpoch: () => now,
    nowIso: () => new Date(now).toISOString(),
    logger,
  });
  return { useCase, logger, at: (ms) => { now = ms; } };
}

const beat = (assetId, over = {}) => ({
  type: 'plex', assetId, seconds: 37, percent: 1, spotDeviceId: 'fleet:office-tv', ...over,
});

describe('RecordPlaybackProgress skip inference', () => {
  it('marks an unfinished item skipped once the screen has moved on from it', async () => {
    const memory = store();
    const { useCase, logger, at } = build(memory);
    at(0); await useCase.execute(beat('plex:649183'));
    at(10_000); await useCase.execute(beat('plex:605450', { seconds: 15 }));
    at(45_000); await useCase.execute(beat('plex:605450', { seconds: 50 }));
    const skipped = memory.rows.get('plex:649183');
    expect(skipped.skipped).toBe(true);
    expect(skipped.skippedAt).toBe(new Date(45_000).toISOString());
    expect(skipped.playhead).toBe(37);
    expect(logger.info).toHaveBeenCalledWith('play.skip.inferred', expect.objectContaining({ assetId: 'plex:649183', deviceId: 'fleet:office-tv' }));
  });

  it('never infers across different screens', async () => {
    const memory = store();
    const { useCase, at } = build(memory);
    at(0); await useCase.execute(beat('plex:1'));
    at(10_000); await useCase.execute(beat('plex:2', { spotDeviceId: 'fleet:livingroom-tv' }));
    at(60_000); await useCase.execute(beat('plex:2', { spotDeviceId: 'fleet:livingroom-tv' }));
    expect(memory.rows.get('plex:1').skipped).toBe(false);
  });

  it('a finished item moving on is not a skip', async () => {
    const memory = store();
    const { useCase, at } = build(memory);
    at(0); await useCase.execute(beat('plex:1', { seconds: 3400, percent: 95 }));
    at(10_000); await useCase.execute(beat('plex:2'));
    at(60_000); await useCase.execute(beat('plex:2'));
    expect(memory.rows.get('plex:1').skipped).toBe(false);
  });

  it('playing a skipped item again clears the skip', async () => {
    const memory = store();
    memory.rows.set('plex:1', new MediaProgress({ contentId: 'plex:1', playhead: 37, duration: 3700, skipped: true, skippedAt: '2026-10-28T14:00:00.000Z' }));
    const { useCase, logger, at } = build(memory);
    at(0); await useCase.execute(beat('plex:1', { seconds: 60 }));
    expect(memory.rows.get('plex:1').skipped).toBe(false);
    expect(logger.info).toHaveBeenCalledWith('play.skip.cleared', expect.objectContaining({ assetId: 'plex:1' }));
  });

  it('without a screen identity nothing is inferred', async () => {
    const memory = store();
    const { useCase, at } = build(memory);
    at(0); await useCase.execute(beat('plex:1', { spotDeviceId: null }));
    at(10_000); await useCase.execute(beat('plex:2', { spotDeviceId: null }));
    at(60_000); await useCase.execute(beat('plex:2', { spotDeviceId: null }));
    expect(memory.rows.get('plex:1').skipped).toBe(false);
  });
});
