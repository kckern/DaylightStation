/**
 * Progress heard offline and sent later (the phone's kept book in a dead zone) must
 * never move the place backwards or call itself the newest play
 * (ops:docs/superpowers/plans/2026-11-26-phone-downloads-hardening.md §E).
 */
import { describe, it, expect, vi } from 'vitest';
import { RecordPlaybackProgress } from "./RecordPlaybackProgress.mjs";
import { MediaProgress } from "../../../../content-catalog/server/domain/entities/MediaProgress.mjs";

const NOW = Date.UTC(2026, 10, 26, 20, 0, 0);
// A fixed-zone formatter for the test (UTC), the same shape the app stores.
const stamp = (ms) => new Date(ms).toISOString().replace('T', ' ').slice(0, 19);

function build({ stored = null, timestampAt = stamp } = {}) {
  const memory = { findProgress: vi.fn(async () => stored), saveProgress: vi.fn(async () => {}) };
  const logger = { info: vi.fn(), warn: vi.fn(), debug: vi.fn() };
  const useCase = new RecordPlaybackProgress({
    contentCatalog: {
      resolveSource: () => ({ source: 'plex' }),
      progressNamespace: async () => 'plex/audiobooks',
      getItem: async () => ({ title: 'A book', type: 'track', metadata: { duration: 18_000_000 } }),
    },
    mediaProgressMemory: memory,
    createMediaProgress: (props) => new MediaProgress(props),
    nowTimestamp: () => stamp(NOW),
    ...(timestampAt ? { timestampAt } : {}),
    nowEpoch: () => NOW,
    nowIso: () => new Date(NOW).toISOString(),
    logger,
  });
  return { useCase, memory, logger };
}

const book = { type: 'plex', assetId: 'plex:727120', percent: 5, seconds: 900 };
const storedAt = (ms, playhead = 1800) => ({ contentId: 'plex:727120', playhead, duration: 18000, percent: 10, playCount: 1, lastPlayed: stamp(ms), watchTime: 1800 });

describe('RecordPlaybackProgress observedAt', () => {
  it('a report heard before the stored last play is not applied', async () => {
    const { useCase, memory, logger } = build({ stored: storedAt(NOW - 60_000) });
    const { response } = await useCase.execute({ ...book, observedAt: NOW - 3_600_000 });
    expect(memory.saveProgress).not.toHaveBeenCalled();
    expect(response).toMatchObject({ stale: true, playhead: 1800 });
    expect(logger.info).toHaveBeenCalledWith('play.log.stale_report', expect.objectContaining({ assetId: 'plex:727120', storedPlayhead: 1800, playhead: 900 }));
  });

  it('a newer offline report is applied and stamped with when it was heard', async () => {
    const { useCase, memory } = build({ stored: storedAt(NOW - 7_200_000) });
    await useCase.execute({ ...book, seconds: 2400, observedAt: NOW - 3_600_000 });
    expect(memory.saveProgress).toHaveBeenCalledTimes(1);
    const saved = memory.saveProgress.mock.calls[0][0];
    expect(saved.playhead).toBe(2400);
    expect(saved.lastPlayed).toBe(stamp(NOW - 3_600_000));
  });

  it('without observedAt nothing changes: stamped on arrival', async () => {
    const { useCase, memory } = build({ stored: storedAt(NOW - 60_000) });
    await useCase.execute(book);
    expect(memory.saveProgress.mock.calls[0][0].lastPlayed).toBe(stamp(NOW));
  });

  it('a phone clock ahead counts as now, not the future', async () => {
    const { useCase, memory } = build({ stored: null });
    await useCase.execute({ ...book, observedAt: NOW + 86_400_000 });
    expect(memory.saveProgress.mock.calls[0][0].lastPlayed).toBe(stamp(NOW));
  });

  it('a nonsense observedAt, or no formatter wired, is ignored', async () => {
    const a = build({ stored: storedAt(NOW - 60_000) });
    await a.useCase.execute({ ...book, observedAt: 'yesterday' });
    expect(a.memory.saveProgress).toHaveBeenCalledTimes(1);
    const b = build({ stored: storedAt(NOW - 60_000), timestampAt: null });
    await b.useCase.execute({ ...book, observedAt: NOW - 3_600_000 });
    expect(b.memory.saveProgress).toHaveBeenCalledTimes(1);
  });
});
