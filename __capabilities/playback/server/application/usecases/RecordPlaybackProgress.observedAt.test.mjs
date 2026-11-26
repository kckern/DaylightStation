/**
 * Progress heard offline and sent later (the phone's kept book in a dead zone) must
 * never move the place backwards or call itself the newest play
 * (ops:docs/superpowers/plans/2026-11-26-phone-downloads-hardening.md §E,
 * ops:docs/superpowers/specs/2026-11-26-phone-downloads-lifecycle.md §3.4, §3.8).
 */
import { describe, it, expect, vi } from 'vitest';
import { RecordPlaybackProgress } from "./RecordPlaybackProgress.mjs";
import { MediaProgress } from "../../../../content-catalog/server/domain/entities/MediaProgress.mjs";

const LA = 'America/Los_Angeles';
const NOW = Date.UTC(2026, 10, 26, 20, 0, 0); // 12:00 in Los Angeles
// The household-local bare stamp play/log stores.
const local = (ms) => {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: LA, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
    .formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}:${p.second}`;
};

function build({ stored = null, watched = false } = {}) {
  const memory = { findProgress: vi.fn(async () => (stored ? new MediaProgress(stored) : null)), saveProgress: vi.fn(async () => {}) };
  const ledger = { observe: vi.fn(async () => {}), end: vi.fn(async () => {}) };
  const session = { execute: vi.fn(async () => {}) };
  const sync = { onProgressUpdate: vi.fn() };
  const logger = { info: vi.fn(), warn: vi.fn(), debug: vi.fn() };
  const useCase = new RecordPlaybackProgress({
    contentCatalog: {
      resolveSource: () => ({ source: 'plex' }),
      progressNamespace: async () => 'plex/audiobooks',
      getItem: async () => ({ title: 'A book', type: 'track', metadata: { duration: 18_000_000 } }),
    },
    mediaProgressMemory: memory,
    playLedger: ledger,
    reportPlaybackSession: session,
    progressSyncSources: new Set(['plex']),
    progressSyncService: sync,
    createMediaProgress: (props) => new MediaProgress(props),
    nowTimestamp: () => local(NOW),
    timestampAt: (ms) => local(ms),
    timeZone: LA,
    nowEpoch: () => NOW,
    nowIso: () => new Date(NOW).toISOString(),
    logger,
    ...(watched ? { completionRules: { ruleFor: () => ({ minPercent: 90, source: 'test' }) } } : {}),
  });
  return { useCase, memory, ledger, session, sync, logger };
}

const book = { type: 'plex', assetId: 'plex:727120', percent: 5, seconds: 900, spotDeviceId: 'fleet:phone', deviceId: 'phone' };
const storedAt = (lastPlayed, playhead = 1800) => ({ contentId: 'plex:727120', playhead, duration: 18000, percent: 10, playCount: 1, lastPlayed, watchTime: 1800 });

describe('RecordPlaybackProgress observedAt', () => {
  it('a report heard before the stored last play keeps the place; its listening still counts', async () => {
    const { useCase, memory, logger, ledger, session, sync } = build({ stored: storedAt(local(NOW - 60_000)) });
    const { response } = await useCase.execute({ ...book, observedAt: NOW - 3_600_000, watched_duration: 120 });
    expect(response).toMatchObject({ stale: true, playhead: 1800 });
    const saved = memory.saveProgress.mock.calls[0][0];
    expect(saved.playhead).toBe(1800);
    expect(saved.lastPlayed).toBe(local(NOW - 60_000));
    expect(saved.watchTime).toBe(1920);
    expect(logger.info).toHaveBeenCalledWith('play.log.stale_report', expect.objectContaining({ storedPlayhead: 1800, playhead: 900 }));
    // History for the ledger, at the time it was heard; never a position for the servers.
    expect(ledger.observe).toHaveBeenCalledWith(expect.objectContaining({ atEpoch: NOW - 3_600_000, localTime: local(NOW - 3_600_000) }));
    expect(session.execute).not.toHaveBeenCalled();
    expect(sync.onProgressUpdate).not.toHaveBeenCalled();
  });

  it('a stale report with no listening to add writes nothing', async () => {
    const { useCase, memory } = build({ stored: storedAt(local(NOW - 60_000), 900) });
    await useCase.execute({ ...book, observedAt: NOW - 3_600_000 });
    expect(memory.saveProgress).not.toHaveBeenCalled();
  });

  it('a newer offline report is applied and stamped with when it was heard', async () => {
    const { useCase, memory, ledger } = build({ stored: storedAt(local(NOW - 7_200_000)) });
    await useCase.execute({ ...book, seconds: 2400, observedAt: NOW - 3_600_000 });
    const saved = memory.saveProgress.mock.calls[0][0];
    expect(saved.playhead).toBe(2400);
    expect(saved.lastPlayed).toBe(local(NOW - 3_600_000));
    expect(ledger.observe).toHaveBeenCalledWith(expect.objectContaining({ atEpoch: NOW - 3_600_000 }));
  });

  it('a stored UTC ISO stamp (the media-server sync) compares as the instant it is', async () => {
    // Stored 11:30 local, written as UTC ISO (19:30Z). A report heard at 11:45 local is newer.
    const { useCase, memory } = build({ stored: storedAt(new Date(NOW - 1_800_000).toISOString()) });
    const { response } = await useCase.execute({ ...book, seconds: 2400, observedAt: NOW - 900_000 });
    expect(response.stale).toBeUndefined();
    expect(memory.saveProgress.mock.calls[0][0].playhead).toBe(2400);
  });

  it('a stored local-with-offset stamp compares as its instant', async () => {
    const { useCase } = build({ stored: storedAt('2026-11-26T11:50:00.000-08:00') });
    const { response } = await useCase.execute({ ...book, observedAt: NOW - 1_800_000 });
    expect(response.stale).toBe(true);
  });

  it('a finishing replay stamps completedAt with when it was heard', async () => {
    const { useCase, memory } = build({ stored: storedAt(local(NOW - 7_200_000)), watched: true });
    await useCase.execute({ ...book, seconds: 17900, percent: 99, observedAt: NOW - 3_600_000 });
    expect(memory.saveProgress.mock.calls[0][0].completedAt).toBe(local(NOW - 3_600_000));
  });

  it('without observedAt nothing changes: stamped on arrival', async () => {
    const { useCase, memory } = build({ stored: storedAt(local(NOW - 60_000)) });
    await useCase.execute(book);
    expect(memory.saveProgress.mock.calls[0][0].lastPlayed).toBe(local(NOW));
  });

  it('a phone clock ahead counts as now; a nonsense observedAt is ignored', async () => {
    const a = build();
    await a.useCase.execute({ ...book, observedAt: NOW + 86_400_000 });
    expect(a.memory.saveProgress.mock.calls[0][0].lastPlayed).toBe(local(NOW));
    const b = build({ stored: storedAt(local(NOW - 60_000)) });
    await b.useCase.execute({ ...book, observedAt: 'yesterday' });
    expect(b.memory.saveProgress.mock.calls[0][0].playhead).toBe(900);
  });
});
