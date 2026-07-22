import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { UserVideoProgressStore } from '#apps/piano/UserVideoProgressStore.mjs';

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
});
