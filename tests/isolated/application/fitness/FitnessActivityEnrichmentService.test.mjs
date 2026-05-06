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

const buildActivity = (overrides = {}) => ({
  id: 1,
  type: 'Run',
  start_date: '2026-05-04T20:00:00Z',
  elapsed_time: 2400,
  moving_time: 2350,
  distance: 5000,
  has_heartrate: true,
  ...overrides,
});

const buildSession = (overrides = {}) => ({
  sessionId: 'S',
  timezone: 'America/Los_Angeles',
  session: {
    start: '2026-05-04 13:00:00',
    end: '2026-05-04 13:40:00',
    duration_seconds: 2400,
  },
  participants: { 'test-user': { hr_device: '40475' } },
  summary: { media: [] },
  ...overrides,
});

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
    const activity = buildActivity({
      id: 18390552794,
      type: 'Run',
      start_date: '2026-05-05T19:30:00Z',
      elapsed_time: 2388,
      moving_time: 2342,
      distance: 5230, // > 100 m (real GPS distance)
    });

    // Session: 7-min indoor treasureBox, no media, no distance — overlaps the
    // run by ~7 min (well within the 5-min buffer).
    listYamlFiles.mockReturnValue(['20260505130756']);
    loadYamlSafe.mockReturnValue(buildSession({
      sessionId: '20260505130756',
      session: {
        start: '2026-05-05 13:07:56',
        end: '2026-05-05 13:14:51',
        duration_seconds: 415,
      },
      // no `strava` block — distance is implicitly 0; summary.media empty by default
    }));

    const result = service._findMatchingSession(activity);
    expect(result).toBeNull();
  });

  test('still matches an indoor Ride against an indoor session with media', () => {
    // Indoor ride: trainer, no GPS distance.
    // 2026-05-04T20:00:00Z = 2026-05-04 13:00:00 PT (same UTC date as session dir).
    const activity = buildActivity({
      id: 18380161567,
      type: 'Ride',
      start_date: '2026-05-04T20:00:00Z',
      elapsed_time: 2120,
      moving_time: 2050,
      distance: 0, // indoor: no GPS distance
    });

    listYamlFiles.mockReturnValue(['20260504130000']);
    loadYamlSafe.mockReturnValue(buildSession({
      sessionId: '20260504130000',
      session: {
        start: '2026-05-04 13:00:00',
        end: '2026-05-04 13:48:21',
        duration_seconds: 2901,
      },
      summary: {
        media: [{ contentId: 'plex:606446', primary: true }],
      },
    }));

    const result = service._findMatchingSession(activity);
    expect(result).not.toBeNull();
    expect(result.data.sessionId).toBe('20260504130000');
  });

  test('still matches a treadmill run (no GPS distance) against an empty-media session', () => {
    // Treadmill activity: distance 0, no GPS — guard does NOT apply because
    // the activity itself has no GPS distance.
    // 2026-05-04T13:00:00Z = 2026-05-04 06:00:00 PT.
    const activity = buildActivity({
      id: 99999,
      type: 'Run',
      start_date: '2026-05-04T13:00:00Z',
      elapsed_time: 1800,
      moving_time: 1800,
      distance: 0, // treadmill
      has_heartrate: undefined,
    });

    listYamlFiles.mockReturnValue(['20260504060000']);
    loadYamlSafe.mockReturnValue(buildSession({
      sessionId: '20260504060000',
      session: {
        start: '2026-05-04 06:00:00',
        end: '2026-05-04 06:30:00',
        duration_seconds: 1800,
      },
    }));

    const result = service._findMatchingSession(activity);
    // The guard only fires for outdoor-GPS-vs-empty-indoor combos. A treadmill
    // run with no media is still a legitimate match candidate.
    expect(result).not.toBeNull();
  });

  test('rejects a 7-minute session match against a 37-minute activity (overlap < 50% of activity)', () => {
    // Activity: 37 min outdoor Ride (distance 0 to skip Task 2.1 sport guard).
    // Session: 7 min, with media so the sport guard doesn't fire.
    // Overlap is the session's full 7 min — 7/37 ≈ 19%, below the 50% threshold.
    const activity = buildActivity({
      id: 2,
      type: 'Ride',
      distance: 0,                          // indoor — sport guard skipped
      elapsed_time: 37 * 60,                 // 2220 s
      moving_time: 37 * 60,
      start_date: '2026-05-04T20:00:00Z',   // 13:00 PT
    });

    listYamlFiles.mockReturnValue(['short-session']);
    loadYamlSafe.mockReturnValue(buildSession({
      sessionId: 'short-session',
      session: {
        start: '2026-05-04 13:00:00',
        end: '2026-05-04 13:07:00',         // 7 min later
        duration_seconds: 420,
      },
      summary: { media: [{ contentId: 'plex:606446', primary: true }] },
    }));

    const result = service._findMatchingSession(activity);
    expect(result).toBeNull();
  });

  test('accepts a 30-minute session match against a 37-minute activity', () => {
    // Overlap ~30 min / activity 37 min = 81% — above threshold.
    const activity = buildActivity({
      id: 3,
      type: 'Ride',
      distance: 0,
      elapsed_time: 37 * 60,
      moving_time: 37 * 60,
      start_date: '2026-05-04T20:00:00Z',
    });

    listYamlFiles.mockReturnValue(['long-session']);
    loadYamlSafe.mockReturnValue(buildSession({
      sessionId: 'long-session',
      session: {
        start: '2026-05-04 13:00:00',
        end: '2026-05-04 13:30:00',         // 30 min — overlap is the full 30 min
        duration_seconds: 1800,
      },
      summary: { media: [{ contentId: 'plex:606446', primary: true }] },
    }));

    const result = service._findMatchingSession(activity);
    expect(result).not.toBeNull();
    expect(result.data.sessionId).toBe('long-session');
  });
});

describe('FitnessActivityEnrichmentService — terminal-failure aging', () => {
  let service;
  let jobStore;
  let stravaClientMock;

  beforeEach(() => {
    vi.resetAllMocks();
    dirExists.mockReturnValue(true);
    jobStore = {
      findById: vi.fn(),
      update: vi.fn(),
      create: vi.fn(),
      findActionable: vi.fn(() => []),
    };
    stravaClientMock = { hasAccessToken: () => true, getActivity: vi.fn() };
    service = new FitnessActivityEnrichmentService({
      stravaClient: stravaClientMock,
      jobStore,
      authStore: {},
      configService: {
        getTimezone: () => 'America/Los_Angeles',
        getHeadOfHousehold: () => 'test-user',
        getAppConfig: () => ({}),
      },
      fitnessHistoryDir: '/tmp/fake-history',
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    });
  });

  test('marks a job abandoned when attempts >= MAX_TOTAL_ATTEMPTS', async () => {
    jobStore.findById.mockReturnValue({
      activityId: '17831319049',
      status: 'pending',
      attempts: 10,
    });
    await service._attemptEnrichment('17831319049');
    expect(jobStore.update).toHaveBeenCalledWith('17831319049', expect.objectContaining({
      status: 'abandoned',
    }));
    // Should NOT have called getActivity (early-returned before the work)
    expect(stravaClientMock.getActivity).not.toHaveBeenCalled();
  });

  test('does not retry an abandoned job', async () => {
    jobStore.findById.mockReturnValue({
      activityId: '17831319049',
      status: 'abandoned',
      attempts: 11,
    });
    await service._attemptEnrichment('17831319049');
    // No update, no getActivity call — full early-return.
    expect(jobStore.update).not.toHaveBeenCalled();
    expect(stravaClientMock.getActivity).not.toHaveBeenCalled();
  });

  test('attempts < MAX_TOTAL_ATTEMPTS proceeds normally', async () => {
    jobStore.findById.mockReturnValue({
      activityId: '12345',
      status: 'pending',
      attempts: 3,
    });
    // The attempt will fail downstream because we haven't fully wired
    // stravaClient/getActivity, but we verify the abandon-update did NOT fire
    // before that downstream failure.
    await service._attemptEnrichment('12345').catch(() => {});
    const calls = jobStore.update.mock.calls;
    const abandonCalls = calls.filter(call =>
      call[1] && call[1].status === 'abandoned'
    );
    expect(abandonCalls).toHaveLength(0);
  });
});

