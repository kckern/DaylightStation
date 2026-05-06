/**
 * FitnessActivityEnrichmentService — _findMatchingSession sport/distance guard
 *
 * Regression test: on 2026-05-05, a 37-min outdoor GPS Run was bound to a
 * 7-min indoor zero-distance treasureBox session because their windows
 * happened to overlap by ~7 minutes (within the 5-min buffer). The matcher
 * must reject any session whose distance is zero AND has no media when the
 * activity has real GPS distance (>100m).
 */

import { describe, test, expect, vi, beforeEach } from 'vitest';

// Mock the FileIO module so the service uses our in-memory fakes instead of
// touching the filesystem.
vi.mock('#system/utils/FileIO.mjs', () => ({
  loadYamlSafe: vi.fn(),
  listYamlFiles: vi.fn(),
  dirExists: vi.fn(),
  saveYaml: vi.fn(),
}));

// userService is touched in unrelated paths; mock to keep the import graph clean.
vi.mock('#system/config/index.mjs', () => ({
  userService: {
    resolveDisplayName: (userId) => userId,
  },
}));

const { FitnessActivityEnrichmentService } = await import(
  '#apps/fitness/FitnessActivityEnrichmentService.mjs'
);
const { loadYamlSafe, listYamlFiles, dirExists } = await import('#system/utils/FileIO.mjs');

describe('FitnessActivityEnrichmentService._findMatchingSession sport guard', () => {
  let service;
  let logger;

  beforeEach(() => {
    vi.resetAllMocks();
    // The history dir is checked at the top of _findMatchingSession; date-dir
    // existence is checked again per-date inside the loop. Return true for both.
    dirExists.mockReturnValue(true);
    logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
    service = new FitnessActivityEnrichmentService({
      stravaClient: {},
      jobStore: { findById: () => null, update: () => {}, create: () => {}, findActionable: () => [] },
      authStore: {},
      configService: {
        getTimezone: () => 'America/Los_Angeles',
        getHeadOfHousehold: () => 'test-user',
        getAppConfig: () => ({}),
      },
      fitnessHistoryDir: '/tmp/fake-history',
      logger,
    });
  });

  test('rejects an outdoor GPS Run match against a zero-distance no-media session', () => {
    // Activity: 39:48 outdoor Run, 5230 m (3.25 mi), GPS-style.
    // 2026-05-05T19:30:00Z = 2026-05-05 12:30:00 PT.
    const activity = {
      id: 18390552794,
      type: 'Run',
      start_date: '2026-05-05T19:30:00Z',
      elapsed_time: 2388,
      moving_time: 2342,
      distance: 5230, // > 100 m (real GPS distance)
      has_heartrate: true,
    };

    // Session: 7-min indoor treasureBox, no media, no distance — overlaps the
    // run by ~7 min (well within the 5-min buffer).
    listYamlFiles.mockReturnValue(['20260505130756']);
    loadYamlSafe.mockReturnValue({
      sessionId: '20260505130756',
      timezone: 'America/Los_Angeles',
      session: {
        start: '2026-05-05 13:07:56',
        end: '2026-05-05 13:14:51',
        duration_seconds: 415,
      },
      participants: { 'test-user': { hr_device: '40475' } },
      summary: { media: [] },
      // no `strava` block — distance is implicitly 0
    });

    const result = service._findMatchingSession(activity);
    expect(result).toBeNull();
  });

  test('still matches an indoor Ride against an indoor session with media', () => {
    // Indoor ride: trainer, no GPS distance.
    // 2026-05-04T20:00:00Z = 2026-05-04 13:00:00 PT (same UTC date as session dir).
    const activity = {
      id: 18380161567,
      type: 'Ride',
      start_date: '2026-05-04T20:00:00Z',
      elapsed_time: 2120,
      moving_time: 2050,
      distance: 0, // indoor: no GPS distance
      has_heartrate: true,
    };

    listYamlFiles.mockReturnValue(['20260504130000']);
    loadYamlSafe.mockReturnValue({
      sessionId: '20260504130000',
      timezone: 'America/Los_Angeles',
      session: {
        start: '2026-05-04 13:00:00',
        end: '2026-05-04 13:48:21',
        duration_seconds: 2901,
      },
      participants: { 'test-user': { hr_device: '40475' } },
      summary: {
        media: [{ contentId: 'plex:606446', primary: true }],
      },
    });

    const result = service._findMatchingSession(activity);
    expect(result).not.toBeNull();
    expect(result.data.sessionId).toBe('20260504130000');
  });

  test('still matches a treadmill run (no GPS distance) against an empty-media session', () => {
    // Treadmill activity: distance 0, no GPS — guard does NOT apply because
    // the activity itself has no GPS distance.
    // 2026-05-04T13:00:00Z = 2026-05-04 06:00:00 PT.
    const activity = {
      id: 99999,
      type: 'Run',
      start_date: '2026-05-04T13:00:00Z',
      elapsed_time: 1800,
      moving_time: 1800,
      distance: 0, // treadmill
    };

    listYamlFiles.mockReturnValue(['20260504060000']);
    loadYamlSafe.mockReturnValue({
      sessionId: '20260504060000',
      timezone: 'America/Los_Angeles',
      session: {
        start: '2026-05-04 06:00:00',
        end: '2026-05-04 06:30:00',
        duration_seconds: 1800,
      },
      participants: { 'test-user': { hr_device: '40475' } },
      summary: { media: [] },
    });

    const result = service._findMatchingSession(activity);
    // The guard only fires for outdoor-GPS-vs-empty-indoor combos. A treadmill
    // run with no media is still a legitimate match candidate.
    expect(result).not.toBeNull();
  });
});
