import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import { UserVideoProgressStore } from './UserVideoProgressStore.mjs';

const USER = 'test-user';
const USER_DIR = '/tmp/uvps-test-user';
const PROGRESS = path.join(USER_DIR, 'apps', 'piano', 'video-progress.yml');

const configService = {
  getUserProfile: (id) => (id === USER ? { id, name: 'Test' } : null),
  getUserDir: () => USER_DIR,
  getHouseholdAppConfig: () => ({ videos: { completion_threshold_percent: 90 } }),
};

const makeStore = () => new UserVideoProgressStore({ configService, logger: { info: vi.fn() } });

beforeEach(() => { try { fs.rmSync(USER_DIR, { recursive: true, force: true }); } catch {} });
afterEach(() => { try { fs.rmSync(USER_DIR, { recursive: true, force: true }); } catch {} });

describe('UserVideoProgressStore.record', () => {
  it('returns null for an unknown user and writes no file', () => {
    const store = makeStore();
    const result = store.record({ userId: 'nobody', plexId: '100', percent: 95, engaged: true });
    expect(result).toBe(null);
    expect(fs.existsSync(PROGRESS)).toBe(false);
  });

  it('stamps completedAt when percent>=90 AND engaged:true', () => {
    const store = makeStore();
    const entry = store.record({ userId: USER, plexId: '100', percent: 95, seconds: 100, duration: 105, engaged: true });
    expect(entry.engaged).toBe(true);
    expect(entry.completedAt).toBeTruthy();
    expect(fs.existsSync(PROGRESS)).toBe(true);
  });

  it('does NOT stamp completedAt when percent>=90 but engaged:false', () => {
    const store = makeStore();
    const entry = store.record({ userId: USER, plexId: '100', percent: 95, engaged: false });
    expect(entry.engaged).toBe(false);
    expect(entry.completedAt).toBe(null);
  });

  it('does NOT stamp completedAt when engaged:true but percent<90', () => {
    const store = makeStore();
    const entry = store.record({ userId: USER, plexId: '100', percent: 50, engaged: true });
    expect(entry.engaged).toBe(true);
    expect(entry.completedAt).toBe(null);
  });

  it('engaged is sticky: engaged:true@50% then engaged:false@95% completes', () => {
    const store = makeStore();
    store.record({ userId: USER, plexId: '100', percent: 50, engaged: true });
    const entry = store.record({ userId: USER, plexId: '100', percent: 95, engaged: false });
    expect(entry.engaged).toBe(true);
    expect(entry.completedAt).toBeTruthy();
  });

  it('preserves existing completedAt on a later low-percent post', () => {
    const store = makeStore();
    const first = store.record({ userId: USER, plexId: '100', percent: 95, engaged: true });
    const completedAt = first.completedAt;
    expect(completedAt).toBeTruthy();
    const second = store.record({ userId: USER, plexId: '100', percent: 5, engaged: false });
    expect(second.completedAt).toBe(completedAt);
  });

  it('strips plex: prefix consistently so 100 and plex:100 hit the same key', () => {
    const store = makeStore();
    store.record({ userId: USER, plexId: '100', percent: 30, engaged: false });
    store.record({ userId: USER, plexId: 'plex:100', percent: 95, engaged: true });
    const items = store.enrich([{ id: '100' }], USER);
    expect(items[0].userPercent).toBe(95);
    expect(items[0].userWatched).toBe(true);
  });
});

describe('UserVideoProgressStore.enrich', () => {
  it('returns items unchanged for an unknown user', () => {
    const store = makeStore();
    const input = [{ id: '100' }];
    const result = store.enrich(input, 'nobody');
    expect(result).toEqual(input);
    expect(result[0].userPercent).toBeUndefined();
  });

  it('adds all 5 fields; completed entry -> userWatched true, missing entry -> nulls/false', () => {
    const store = makeStore();
    store.record({ userId: USER, plexId: '100', percent: 95, seconds: 100, engaged: true });
    const items = store.enrich([{ id: '100' }, { id: '200' }], USER);

    const done = items[0];
    expect(done.userPercent).toBe(95);
    expect(done.userPlayhead).toBe(100);
    expect(done.userWatched).toBe(true);
    expect(done.userEngaged).toBe(true);
    expect(done.userCompletedAt).toBeTruthy();

    const none = items[1];
    expect(none.userPercent).toBe(null);
    expect(none.userPlayhead).toBe(null);
    expect(none.userWatched).toBe(false);
    expect(none.userEngaged).toBe(false);
    expect(none.userCompletedAt).toBe(null);
  });

  it('legacy tolerance: engagementCount>0 (no engaged) -> userEngaged true and userWatched at >=90%', () => {
    const store = makeStore();
    // Hand-write a legacy entry
    fs.mkdirSync(path.dirname(PROGRESS), { recursive: true });
    fs.writeFileSync(PROGRESS, 'plex:100:\n  percent: 95\n  playhead: 100\n  engagementCount: 2\n');
    const items = store.enrich([{ id: '100' }], USER);
    expect(items[0].userEngaged).toBe(true);
    expect(items[0].userWatched).toBe(true);
  });
});

describe('UserVideoProgressStore.summarize', () => {
  it('counts completed lectures and reports total + latest lastPlayed', () => {
    const store = makeStore();
    store.record({ userId: USER, plexId: '100', percent: 95, engaged: true });   // completed
    store.record({ userId: USER, plexId: '101', percent: 40, engaged: true });   // not completed
    const summary = store.summarize([{ plex: '100' }, { plex: '101' }, { plex: '102' }], USER);
    expect(summary.total).toBe(3);
    expect(summary.completed).toBe(1);
    expect(summary.lastPlayedAt).toBeTruthy();
  });

  it('returns zeros for an unknown user', () => {
    const store = makeStore();
    const summary = store.summarize([{ plex: '100' }, { plex: '101' }], 'nobody');
    expect(summary).toEqual({ completed: 0, total: 2, lastPlayedAt: null });
  });

  it('matches items by plex or id, stripping the plex: prefix', () => {
    const store = makeStore();
    store.record({ userId: USER, plexId: '100', percent: 95, engaged: true });
    const summary = store.summarize([{ id: 'plex:100' }], USER);
    expect(summary.completed).toBe(1);
  });
});
