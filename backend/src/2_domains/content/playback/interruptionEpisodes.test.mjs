import { describe, expect, it } from 'vitest';
import { updateEpisodes } from './interruptionEpisodes.mjs';

describe('updateEpisodes', () => {
  it('opens one immutable episode after one second of unexpected no progress', () => {
    const state = [];
    const next = updateEpisodes({ state, observation: { kind: 'no-progress', unexpected: true, durationMs: 1000 }, now: 10_000 });
    expect(next).toEqual([{ startedAt: 10_000, endedAt: null }]);
    expect(next).not.toBe(state);
    expect(state).toEqual([]);
  });

  it('deduplicates repeated DOM no-progress events and remounts into the open episode', () => {
    const started = updateEpisodes({ state: [], observation: { kind: 'no-progress', unexpected: true, durationMs: 1000 }, now: 10_000 });
    for (const observation of [
      { kind: 'no-progress', unexpected: true, durationMs: 1000 },
      { kind: 'remount' },
    ]) {
      expect(updateEpisodes({ state: started, observation, now: 11_000 })).toHaveLength(1);
    }
  });

  it('does not start an episode for user or app pause, seek warmup, or suspension', () => {
    for (const observation of [
      { kind: 'no-progress', unexpected: false, durationMs: 10_000, cause: 'user-pause' },
      { kind: 'no-progress', unexpected: false, durationMs: 10_000, cause: 'app-pause' },
      { kind: 'seek-warmup', durationMs: 10_000 },
      { kind: 'suspension', durationMs: 10_000 },
    ]) {
      expect(updateEpisodes({ state: [], observation, now: 10_000 })).toEqual([]);
    }
  });

  it('closes an episode only after five healthy seconds', () => {
    const started = [{ startedAt: 10_000, endedAt: null }];
    expect(updateEpisodes({ state: started, observation: { kind: 'progress', healthyDurationMs: 4_999 }, now: 15_000 })[0].endedAt).toBeNull();
    expect(updateEpisodes({ state: started, observation: { kind: 'progress', healthyDurationMs: 5_000 }, now: 15_000 }))
      .toEqual([{ startedAt: 10_000, endedAt: 15_000 }]);
  });

  it('preserves a single unresolved episode', () => {
    const state = [{ startedAt: 10_000, endedAt: null }];
    expect(updateEpisodes({ state, observation: { kind: 'progress', healthyDurationMs: 1_000 }, now: 11_000 }))
      .toEqual(state);
  });
});
