/**
 * YamlSessionDatastore — Strava extraction tests
 *
 * Tests that findByDate() correctly extracts the session-level strava block.
 */

import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { YamlSessionDatastore } from '#adapters/persistence/yaml/YamlSessionDatastore.mjs';
import { saveYaml } from '#system/utils/FileIO.mjs';

describe('YamlSessionDatastore — strava extraction in findByDate', () => {
  let store;
  let tmpDir;
  const DATE = '2026-03-01';
  const SESSION_ID = '20260301120000';

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'session-strava-test-'));
    const configService = {
      getHouseholdPath: (subPath) => path.join(tmpDir, subPath),
    };
    store = new YamlSessionDatastore({ configService });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns strava fields when session YAML has a strava block', async () => {
    const sessionData = {
      sessionId: SESSION_ID,
      startTime: 1740830400000,
      endTime: 1740834000000,
      durationMs: 3600000,
      timezone: 'America/Los_Angeles',
      participants: {
        john: { display_name: 'John' },
      },
      strava: {
        name: 'Morning Ride',
        type: 'Ride',
        sportType: 'MountainBikeRide',
        distance: 25400.5,
        trainer: false,
        map: {
          polyline: 'abc123encodedpolyline',
        },
      },
    };

    const sessionsDir = path.join(tmpDir, 'history/fitness', DATE);
    fs.mkdirSync(sessionsDir, { recursive: true });
    saveYaml(path.join(sessionsDir, SESSION_ID), sessionData);

    const sessions = await store.findByDate(DATE);
    expect(sessions).toHaveLength(1);

    const session = sessions[0];
    expect(session.strava).not.toBeNull();
    expect(session.strava).toEqual({
      name: 'Morning Ride',
      type: 'Ride',
      sportType: 'MountainBikeRide',
      distance: 25400.5,
      trainer: false,
      hasMap: true,
    });
  });

  it('returns strava: null when session YAML has no strava block', async () => {
    const sessionData = {
      sessionId: SESSION_ID,
      startTime: 1740830400000,
      endTime: 1740834000000,
      durationMs: 3600000,
      timezone: 'America/Los_Angeles',
      participants: {
        john: { display_name: 'John' },
      },
    };

    const sessionsDir = path.join(tmpDir, 'history/fitness', DATE);
    fs.mkdirSync(sessionsDir, { recursive: true });
    saveYaml(path.join(sessionsDir, SESSION_ID), sessionData);

    const sessions = await store.findByDate(DATE);
    expect(sessions).toHaveLength(1);
    expect(sessions[0].strava).toBeNull();
  });

  it('returns hasMap: false when strava has no map polyline', async () => {
    const sessionData = {
      sessionId: SESSION_ID,
      startTime: 1740830400000,
      durationMs: 1800000,
      timezone: 'UTC',
      participants: {},
      strava: {
        name: 'Treadmill Run',
        type: 'Run',
        sportType: 'Run',
        distance: 5000,
        trainer: true,
      },
    };

    const sessionsDir = path.join(tmpDir, 'history/fitness', DATE);
    fs.mkdirSync(sessionsDir, { recursive: true });
    saveYaml(path.join(sessionsDir, SESSION_ID), sessionData);

    const sessions = await store.findByDate(DATE);
    expect(sessions).toHaveLength(1);
    expect(sessions[0].strava).toEqual({
      name: 'Treadmill Run',
      type: 'Run',
      sportType: 'Run',
      distance: 5000,
      trainer: true,
      hasMap: false,
    });
  });

  it('defaults trainer to true when not specified', async () => {
    const sessionData = {
      sessionId: SESSION_ID,
      startTime: 1740830400000,
      durationMs: 1800000,
      timezone: 'UTC',
      participants: {},
      strava: {
        name: 'Workout',
        type: 'Workout',
      },
    };

    const sessionsDir = path.join(tmpDir, 'history/fitness', DATE);
    fs.mkdirSync(sessionsDir, { recursive: true });
    saveYaml(path.join(sessionsDir, SESSION_ID), sessionData);

    const sessions = await store.findByDate(DATE);
    expect(sessions).toHaveLength(1);
    expect(sessions[0].strava.trainer).toBe(true);
    expect(sessions[0].strava.distance).toBe(0);
    expect(sessions[0].strava.sportType).toBeNull();
  });
});
