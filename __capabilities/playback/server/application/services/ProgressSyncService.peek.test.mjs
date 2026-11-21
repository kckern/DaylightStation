// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';
import { ProgressSyncService } from './ProgressSyncService.mjs';
import { MediaProgress } from '../../../../content-catalog/server/domain/entities/MediaProgress.mjs';
import { ProgressWriteRuntime } from '../../../../../__backend/src/0_system/scheduling/ProgressWriteRuntime.mjs';

/**
 * peekOnPlay answers "where would reconcileOnPlay put the playhead" for the
 * provenance intro, which asks before play starts. It must land on the same
 * playhead and must write nothing: no bookmark, no local update, no write-back.
 */
const clock = { now: () => new Date('2026-11-21T12:00:00Z'), epoch: () => Date.parse('2026-11-21T12:00:00Z') };
const local = () => new MediaProgress({ contentId: 'plex:1', playhead: 600, duration: 6000, playCount: 1, lastPlayed: '2026-11-01T12:00:00Z', watchTime: 600 });

function service({ localState = null, remote = null } = {}) {
  const mediaProgressMemory = { findProgress: vi.fn(async () => localState), saveProgress: vi.fn(async () => {}) };
  const remoteProgressProvider = { getProgress: vi.fn(async () => remote), updateProgress: vi.fn(async () => {}) };
  const runtime = new ProgressWriteRuntime();
  const svc = new ProgressSyncService({ remoteProgressProvider, mediaProgressMemory, progressWriteRuntime: runtime, clock, logger: { info() {}, warn() {}, error() {}, debug() {} } });
  return { svc, mediaProgressMemory, remoteProgressProvider, runtime };
}

describe('ProgressSyncService.peekOnPlay', () => {
  it.each([
    ['local only', { localState: local() }],
    ['remote only', { remote: { currentTime: 1200, isFinished: false, lastUpdate: 1763000000, duration: 6000 } }],
    ['remote newer', { localState: local(), remote: { currentTime: 1500, isFinished: false, lastUpdate: Date.parse('2026-11-20T00:00:00Z') / 1000, duration: 6000 } }],
    ['local newer', { localState: local(), remote: { currentTime: 100, isFinished: false, lastUpdate: Date.parse('2026-10-01T00:00:00Z') / 1000, duration: 6000 } }],
    ['nothing', {}],
  ])('lands where reconcileOnPlay does, writing nothing (%s)', async (_label, state) => {
    const peek = service(state);
    const peeked = await peek.svc.peekOnPlay('plex:1', 'plex', '1');
    expect(peek.mediaProgressMemory.saveProgress).not.toHaveBeenCalled();
    expect(peek.svc._skepticalMap.size).toBe(0);
    expect(peek.svc._debounceMap.size).toBe(0);
    expect(peek.remoteProgressProvider.updateProgress).not.toHaveBeenCalled();

    const real = service(state);
    const reconciled = await real.svc.reconcileOnPlay('plex:1', 'plex', '1');
    expect(peeked?.playhead ?? null).toBe(reconciled?.playhead ?? null);
    real.svc.dispose();
  });
});
