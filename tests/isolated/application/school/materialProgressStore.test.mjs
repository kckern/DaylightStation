import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { YamlUserVideoProgressStore as UserVideoProgressStore } from '../../../../__app_modules/piano/server/adapters/YamlUserVideoProgressStore.mjs';

const USER = 'kid1';
let tmp, configService;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'material-progress-'));
  configService = {
    getUserDir: (id) => path.join(tmp, 'users', id),
    getUserProfile: (id) => (id === USER ? { username: id } : null),
    getHouseholdAppConfig: () => ({}),
  };
});

describe('UserVideoProgressStore app/filename parameterisation (School)', () => {
  it('writes to apps/school/material-progress.yml when constructed with app+filename', () => {
    const store = new UserVideoProgressStore({ configService, app: 'school', filename: 'material-progress' });
    store.record({ userId: USER, plexId: 'talk:abc', percent: 42, seconds: 100, duration: 240 });

    const expectedPath = path.join(tmp, 'users', USER, 'apps', 'school', 'material-progress.yml');
    expect(fs.existsSync(expectedPath)).toBe(true);

    const raw = fs.readFileSync(expectedPath, 'utf8');
    expect(raw).toContain('percent: 42');
    expect(raw).toContain('playhead: 100');
  });

  it('read-back exposes raw playhead/percent/duration for School consumers', () => {
    const store = new UserVideoProgressStore({ configService, app: 'school', filename: 'material-progress' });
    const entry = store.record({ userId: USER, plexId: 'talk:abc', percent: 42, seconds: 100, duration: 240 });
    expect(entry.percent).toBe(42);
    expect(entry.playhead).toBe(100);
    expect(entry.duration).toBe(240);
  });

  it('defaults to apps/piano/video-progress.yml when app/filename are omitted (Piano unchanged)', () => {
    const store = new UserVideoProgressStore({ configService });
    store.record({ userId: USER, plexId: '100', percent: 95, seconds: 100, duration: 105, engaged: true });

    const pianoPath = path.join(tmp, 'users', USER, 'apps', 'piano', 'video-progress.yml');
    const schoolPath = path.join(tmp, 'users', USER, 'apps', 'school', 'material-progress.yml');
    expect(fs.existsSync(pianoPath)).toBe(true);
    expect(fs.existsSync(schoolPath)).toBe(false);
  });

  it('preserves the existing legacy completion fields and Piano policy when School records playhead progress', () => {
    const thresholdReads = [];
    configService.getHouseholdAppConfig = (...args) => {
      thresholdReads.push(args);
      return { videos: { completion_threshold_percent: 85 } };
    };
    const events = [];
    const logger = { info: (...args) => events.push(args) };
    const file = path.join(tmp, 'users', USER, 'apps', 'school', 'material-progress.yml');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, 'plex:talk:abc:\n  percent: 84\n  engagementCount: 2\n  preservedField: keep\n');
    const store = new UserVideoProgressStore({ configService, logger, app: 'school', filename: 'material-progress' });

    const completed = store.record({ userId: USER, plexId: 'talk:abc', percent: 86, seconds: 101.6, duration: 120.4 });
    expect(completed).toMatchObject({ playhead: 102, duration: 120, percent: 86, engaged: true, newlyCompleted: true, preservedField: 'keep' });
    expect(completed.completedAt).toEqual(expect.any(String));
    expect(completed).not.toHaveProperty('engagementCount');
    expect(thresholdReads).toEqual([[null, 'piano']]);
    expect(events[0]).toEqual(['piano.video-progress.record', {
      userId: USER, key: 'plex:talk:abc', percent: 86, engaged: true, completed: true,
    }]);

    const replay = store.record({ userId: USER, plexId: 'talk:abc', percent: 5, seconds: 6, duration: 120 });
    expect(replay).toMatchObject({ completedAt: completed.completedAt, newlyCompleted: false, engaged: true });
    const raw = fs.readFileSync(file, 'utf8');
    expect(raw).toContain('plex:talk:abc:');
    expect(raw).toContain('preservedField: keep');
    expect(raw).not.toContain('engagementCount');
    expect(raw).not.toContain('newlyCompleted');
    expect(fs.existsSync(path.join(tmp, 'users', USER, 'apps', 'piano', 'video-progress.yml'))).toBe(false);
    expect(store.enrich([{ id: 'talk:abc' }], USER)[0]).toMatchObject({ userWatched: true, userEngaged: true, userCompletedAt: completed.completedAt });
    expect(store.summarize([{ id: 'talk:abc' }], USER)).toMatchObject({ completed: 1, total: 1 });
  });
});
