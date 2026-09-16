/**
 * RecordPlaybackProgress -> ReportPlaybackSession wiring.
 *
 * THIS TEST EXISTS BECAUSE THE WIRING SHIPPED BROKEN AND NOTHING CAUGHT IT.
 *
 * `reportPlaybackSession` was added to the constructor's destructured params
 * but never assigned to `this`, so `this.reportPlaybackSession` was undefined,
 * the guard `if (this.reportPlaybackSession && deviceId)` was silently false,
 * and playback reported nothing — no error, no log, no session. Every gate
 * passed: parse, layer audits, composition contracts, and 95 unit tests. The
 * reporter itself was thoroughly tested; nothing asserted that its CALLER
 * actually called it.
 *
 * So these assert the collaboration, not the collaborator.
 */

import { describe, it, expect, vi } from 'vitest';
import { RecordPlaybackProgress } from './RecordPlaybackProgress.mjs';

const NOW = 1_789_577_175_000;

function build({ reportPlaybackSession } = {}) {
  return new RecordPlaybackProgress({
    // resolveSource returning null short-circuits the metadata branch, which
    // keeps this test about the wiring rather than about content resolution.
    contentCatalog: { resolveSource: () => null },
    mediaProgressMemory: null,
    reportPlaybackSession,
    nowTimestamp: () => '2026-09-16 12:00:00',
    nowEpoch: () => NOW,
    nowIso: () => '2026-09-16T19:00:00.000Z',
    logger: { info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
  });
}

const reporter = () => ({ execute: vi.fn().mockResolvedValue({ reported: true }) });

const progress = (over = {}) => ({
  type: 'plex',
  assetId: 'plex:674737',
  percent: 12,
  seconds: 35,
  title: 'Great Day For Up!',
  deviceId: 'fleet:livingroom-tv',
  ...over,
});

describe('RecordPlaybackProgress reports the playback session', () => {
  it('CALLS the reporter when a surface is identified', async () => {
    const report = reporter();
    await build({ reportPlaybackSession: report }).execute(progress());
    expect(report.execute).toHaveBeenCalledTimes(1);
  });

  it('hands over the surface, the content and the playhead in milliseconds', async () => {
    const report = reporter();
    await build({ reportPlaybackSession: report }).execute(progress());
    expect(report.execute).toHaveBeenCalledWith(expect.objectContaining({
      surfaceId: 'fleet:livingroom-tv',
      contentId: 'plex:674737',
      positionMs: 35_000,
      completed: false,
      at: NOW,
    }));
  });

  it('reports completion on a natural end', async () => {
    const report = reporter();
    await build({ reportPlaybackSession: report }).execute(progress({ naturalEnd: true }));
    expect(report.execute).toHaveBeenCalledWith(expect.objectContaining({ completed: true }));
  });

  it('reports completion on an explicit completed status', async () => {
    const report = reporter();
    await build({ reportPlaybackSession: report }).execute(progress({ status: 'completed' }));
    expect(report.execute).toHaveBeenCalledWith(expect.objectContaining({ completed: true }));
  });

  it('does NOT report when the request names no surface', async () => {
    const report = reporter();
    await build({ reportPlaybackSession: report }).execute(progress({ deviceId: undefined }));
    expect(report.execute).not.toHaveBeenCalled();
  });

  it('records progress normally when no reporter is configured', async () => {
    await expect(build({ reportPlaybackSession: null }).execute(progress())).resolves.toBeDefined();
  });

  it('never lets a failing reporter break progress recording', async () => {
    const report = { execute: vi.fn().mockRejectedValue(new Error('plex is down')) };
    await expect(build({ reportPlaybackSession: report }).execute(progress())).resolves.toBeDefined();
  });
});
