// tests/unit/content/entities/WatchState.test.mjs
import { WatchState } from '../../../../backend/src/1_domains/content/entities/WatchState.mjs';

describe('WatchState entity', () => {
  test('creates watch state with required fields', () => {
    const state = new WatchState({
      itemId: 'plex:12345',
      playhead: 3600,
      duration: 7200
    });

    expect(state.itemId).toBe('plex:12345');
    expect(state.playhead).toBe(3600);
    expect(state.duration).toBe(7200);
    expect(state.percent).toBe(50);
  });

  test('calculates percent from playhead and duration', () => {
    const state = new WatchState({
      itemId: 'plex:12345',
      playhead: 1800,
      duration: 7200
    });

    expect(state.percent).toBe(25);
  });

  test('tracks play count and timestamps', () => {
    const now = new Date().toISOString();
    const state = new WatchState({
      itemId: 'plex:12345',
      playhead: 0,
      duration: 7200,
      playCount: 3,
      lastPlayed: now
    });

    expect(state.playCount).toBe(3);
    expect(state.lastPlayed).toBe(now);
  });

  test('isWatched returns true when percent >= 90', () => {
    const watched = new WatchState({
      itemId: 'plex:12345',
      playhead: 6600,
      duration: 7200
    });

    expect(watched.isWatched()).toBe(true);
  });

  test('isWatched returns false when percent < 90', () => {
    const inProgress = new WatchState({
      itemId: 'plex:12345',
      playhead: 3600,
      duration: 7200
    });

    expect(inProgress.isWatched()).toBe(false);
  });

  test('isInProgress returns true when playhead > 0 and not watched', () => {
    const inProgress = new WatchState({
      itemId: 'plex:12345',
      playhead: 3600,
      duration: 7200
    });

    expect(inProgress.isInProgress()).toBe(true);
  });

  test('isInProgress returns false when playhead is 0', () => {
    const notStarted = new WatchState({
      itemId: 'plex:12345',
      playhead: 0,
      duration: 7200
    });

    expect(notStarted.isInProgress()).toBe(false);
  });

  test('isInProgress returns false when watched', () => {
    const watched = new WatchState({
      itemId: 'plex:12345',
      playhead: 6600,
      duration: 7200
    });

    expect(watched.isInProgress()).toBe(false);
  });

  test('toJSON and fromJSON roundtrip', () => {
    const original = new WatchState({
      itemId: 'plex:12345',
      playhead: 3600,
      duration: 7200,
      playCount: 2,
      lastPlayed: '2026-01-10T12:00:00Z'
    });

    const json = original.toJSON();
    const restored = WatchState.fromJSON(json);

    expect(restored.itemId).toBe(original.itemId);
    expect(restored.playhead).toBe(original.playhead);
    expect(restored.playCount).toBe(original.playCount);
  });

  test('throws on missing itemId', () => {
    expect(() => new WatchState({
      playhead: 3600,
      duration: 7200
    })).toThrow('WatchState requires itemId');
  });

  test('sets default values for optional fields', () => {
    const state = new WatchState({
      itemId: 'plex:12345'
    });

    expect(state.playhead).toBe(0);
    expect(state.duration).toBe(0);
    expect(state.playCount).toBe(0);
    expect(state.lastPlayed).toBeNull();
    expect(state.watchTime).toBe(0);
  });

  test('percent returns 0 when duration is 0', () => {
    const state = new WatchState({
      itemId: 'plex:12345',
      playhead: 100,
      duration: 0
    });

    expect(state.percent).toBe(0);
  });

  test('toJSON includes calculated percent', () => {
    const state = new WatchState({
      itemId: 'plex:12345',
      playhead: 3600,
      duration: 7200
    });

    const json = state.toJSON();
    expect(json.percent).toBe(50);
  });
});
