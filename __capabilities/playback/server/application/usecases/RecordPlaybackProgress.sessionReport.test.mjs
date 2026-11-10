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
import { RecordPlaybackProgress } from "./RecordPlaybackProgress.mjs";

const NOW = 1_789_577_175_000;

function makeLogger() {
  return { info: vi.fn(), warn: vi.fn(), debug: vi.fn() };
}

function build({ reportPlaybackSession, completionRules, logger = makeLogger(), existingState } = {}) {
  return new RecordPlaybackProgress({
    // resolveSource returning null short-circuits the metadata branch, which
    // keeps this test about the wiring rather than about content resolution.
    contentCatalog: { resolveSource: () => null },
    mediaProgressMemory: existingState === undefined ? null : {
      findProgress: vi.fn().mockResolvedValue(existingState),
      saveProgress: vi.fn().mockResolvedValue(undefined),
    },
    reportPlaybackSession,
    completionRules,
    nowTimestamp: () => '2026-09-16 12:00:00',
    nowEpoch: () => NOW,
    nowIso: () => '2026-09-16T19:00:00.000Z',
    logger,
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

  it('reports completion on an explicit completed status near the end', async () => {
    const report = reporter();
    await build({ reportPlaybackSession: report }).execute(progress({ status: 'completed', percent: 95, seconds: 1710 }));
    expect(report.execute).toHaveBeenCalledWith(expect.objectContaining({ completed: true }));
  });

  const FITNESS_RULES = { ruleFor: () => ({ minPercent: 95, maxRemainingSec: 300, minWatchSec: null, source: 'plex/14_fitness', tier: 1 }) };

  // 2026-10-20: FitnessPlayer closed a 4h51m racing longplay at 94% and sent
  // status 'completed'; the scrobble wiped its Plex resume point.
  it('does NOT report completion when the library rule says a long tail is left', async () => {
    const report = reporter();
    await build({ reportPlaybackSession: report, completionRules: FITNESS_RULES })
      .execute(progress({ status: 'completed', percent: 94, seconds: 16429 }));
    expect(report.execute).toHaveBeenCalledWith(expect.objectContaining({ completed: false }));
  });

  // Percent clears the bar; only what is left (699 s > 300 s) refuses it.
  it('does NOT report completion when only the remaining-time cap rejects', async () => {
    const report = reporter();
    await build({ reportPlaybackSession: report, completionRules: FITNESS_RULES })
      .execute(progress({ status: 'completed', percent: 96, seconds: 16768 }));
    expect(report.execute).toHaveBeenCalledWith(expect.objectContaining({ completed: false }));
  });

  it('a natural end reports completion even where the library rule would refuse', async () => {
    const report = reporter();
    await build({ reportPlaybackSession: report, completionRules: FITNESS_RULES })
      .execute(progress({ naturalEnd: true, percent: 94, seconds: 16429 }));
    expect(report.execute).toHaveBeenCalledWith(expect.objectContaining({ completed: true }));
  });

  it('logs the rejected completed claim at info', async () => {
    const logger = makeLogger();
    await build({ reportPlaybackSession: reporter(), completionRules: FITNESS_RULES, logger })
      .execute(progress({ status: 'completed', percent: 96, seconds: 16768 }));
    expect(logger.info).toHaveBeenCalledWith('play.log.completed_claim_rejected', expect.objectContaining({
      assetId: 'plex:674737', rule: 'plex/14_fitness', percent: 96,
    }));
  });

  it('a minWatchSec rule refuses a completed claim with a tiny recorded watch delta', async () => {
    const report = reporter();
    const rules = { ruleFor: () => ({ minPercent: 90, maxRemainingSec: null, minWatchSec: 30 }) };
    // 10 s on from the stored playhead, nothing watched before: watchTime 10 < 30
    await build({ reportPlaybackSession: report, completionRules: rules, existingState: { playhead: 1700, watchTime: 0 } })
      .execute(progress({ status: 'completed', percent: 95, seconds: 1710 }));
    expect(report.execute).toHaveBeenCalledWith(expect.objectContaining({ completed: false }));
  });

  it('judges completion in the debug log only while it can still change something', async () => {
    const judged = (logger) => logger.debug.mock.calls.filter(([event]) => event === 'play.log.completion_judged');
    const fresh = makeLogger();
    await build({ logger: fresh, existingState: null }).execute(progress({ percent: 95, seconds: 1710 }));
    expect(judged(fresh)).toHaveLength(1);
    // already finished, plain heartbeat: nothing left to decide
    const done = makeLogger();
    await build({ logger: done, existingState: { playhead: 1700, completedAt: '2026-10-01 10:00:00' } })
      .execute(progress({ percent: 95, seconds: 1710 }));
    expect(judged(done)).toHaveLength(0);
    // a completed claim is always worth the line
    const claim = makeLogger();
    await build({ logger: claim, existingState: { playhead: 1700, completedAt: '2026-10-01 10:00:00' } })
      .execute(progress({ status: 'completed', percent: 95, seconds: 1710 }));
    expect(judged(claim)).toHaveLength(1);
  });

  it('with no rules configured, a completed claim past 90% scrobbles (movie mode)', async () => {
    const report = reporter();
    await build({ reportPlaybackSession: report }).execute(progress({ status: 'completed', percent: 94, seconds: 16429 }));
    expect(report.execute).toHaveBeenCalledWith(expect.objectContaining({ completed: true }));
  });

  it('does NOT report completion for a completed status early in the item', async () => {
    const report = reporter();
    await build({ reportPlaybackSession: report }).execute(progress({ status: 'completed' }));
    expect(report.execute).toHaveBeenCalledWith(expect.objectContaining({ completed: false }));
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
