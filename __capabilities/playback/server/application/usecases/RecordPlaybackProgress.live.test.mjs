/**
 * A live channel (item metadata `live: true`, e.g. plex-live:nfl-channel) has
 * no playhead worth keeping: the player's "duration" is the sliding live
 * window, so a percent of it would mark the channel watched or resumable. Its
 * reports still reach the screen's play ledger.
 */
import { describe, it, expect, vi } from 'vitest';
import { RecordPlaybackProgress } from "./RecordPlaybackProgress.mjs";
import { MediaProgress } from "../../../../content-catalog/server/domain/entities/MediaProgress.mjs";

function build({ live }) {
  const memory = { findProgress: vi.fn(async () => null), saveProgress: vi.fn(async () => {}) };
  const ledger = { observe: vi.fn(async () => {}), end: vi.fn(async () => {}) };
  const report = { execute: vi.fn(async () => {}) };
  const useCase = new RecordPlaybackProgress({
    contentCatalog: {
      resolveSource: () => ({ source: 'plex-live' }),
      progressNamespace: async () => 'plex-live',
      getItem: async () => ({ title: 'NFL Channel', type: 'live-channel', metadata: live ? { live: true } : {} }),
    },
    mediaProgressMemory: memory,
    playLedger: ledger,
    reportPlaybackSession: report,
    createMediaProgress: (props) => new MediaProgress(props),
    nowTimestamp: () => '2026-11-21 23:00:00',
    nowEpoch: () => 0,
    nowIso: () => '2026-11-22T07:00:00.000Z',
    logger: { info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
  });
  return { useCase, memory, ledger, report };
}

const report = { type: 'plex-live', assetId: 'plex-live:nfl-channel', seconds: 85, percent: 95, spotDeviceId: 'fleet:office-tv' };

describe('RecordPlaybackProgress for a live channel', () => {
  it('stores no progress and reports no media-server session, but still feeds the ledger', async () => {
    const { useCase, memory, ledger, report: session } = build({ live: true });
    await useCase.execute({ ...report, deviceId: 'office-tv' });
    expect(memory.saveProgress).not.toHaveBeenCalled();
    expect(session.execute).not.toHaveBeenCalled();
    expect(ledger.observe).toHaveBeenCalledWith(expect.objectContaining({ contentId: 'plex-live:nfl-channel' }));
  });

  it('a non-live item from the same source still records progress', async () => {
    const { useCase, memory } = build({ live: false });
    await useCase.execute(report);
    expect(memory.saveProgress).toHaveBeenCalledTimes(1);
  });
});
