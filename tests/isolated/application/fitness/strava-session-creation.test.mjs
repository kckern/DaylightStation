/**
 * FitnessActivityEnrichmentService — Strava-only session creation tests
 *
 * When no matching home session is found after all retries, the service should
 * create a new Strava-only session YAML file instead of marking the job as 'unmatched'.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';

// Mock userService before importing the service under test
vi.mock('#system/config/index.mjs', () => ({
  userService: {
    resolveDisplayName: (userId) => userId === 'testuser' ? 'Test User' : userId,
  },
}));

import { FitnessActivityEnrichmentService } from '#apps/fitness/FitnessActivityEnrichmentService.mjs';
import { loadYamlSafe } from '#system/utils/FileIO.mjs';

describe('FitnessActivityEnrichmentService — Strava-only session creation', () => {
  let service;
  let tmpDir;
  let mockStravaClient;
  let mockJobStore;
  let mockAuthStore;
  let mockConfigService;
  let mockLogger;

  const ACTIVITY_ID = '99999999';

  const stravaActivity = {
    id: 99999999,
    name: 'Morning Basketball',
    type: 'Workout',
    sport_type: 'Pickleball',
    start_date: '2026-03-01T18:00:00Z',
    start_date_local: '2026-03-01T10:00:00',
    elapsed_time: 3600,
    moving_time: 3400,
    distance: 5200.5,
    total_elevation_gain: 15.0,
    trainer: false,
    average_heartrate: 145,
    max_heartrate: 172,
    suffer_score: 85,
    device_name: 'Apple Watch Series 9',
    start_latlng: [47.38, -122.23],
    end_latlng: [47.38, -122.23],
    map: {
      summary_polyline: 'encodedPolylineData123',
    },
  };

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'strava-session-creation-test-'));

    mockStravaClient = {
      getActivity: vi.fn().mockResolvedValue(stravaActivity),
      hasAccessToken: vi.fn().mockReturnValue(true),
      refreshToken: vi.fn().mockResolvedValue(undefined),
      updateActivity: vi.fn().mockResolvedValue(undefined),
    };

    mockJobStore = {
      findById: vi.fn().mockReturnValue({ status: 'pending', attempts: 2 }),
      create: vi.fn(),
      update: vi.fn(),
      findActionable: vi.fn().mockReturnValue([]),
    };

    mockAuthStore = {
      loadUserAuth: vi.fn().mockReturnValue({ refresh: 'mock-refresh-token' }),
    };

    mockConfigService = {
      getTimezone: vi.fn().mockReturnValue('America/Los_Angeles'),
      getHeadOfHousehold: vi.fn().mockReturnValue('testuser'),
    };

    mockLogger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    };

    service = new FitnessActivityEnrichmentService({
      stravaClient: mockStravaClient,
      jobStore: mockJobStore,
      authStore: mockAuthStore,
      configService: mockConfigService,
      fitnessHistoryDir: tmpDir,
      logger: mockLogger,
    });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('creates a Strava-only session YAML when no match after max retries', async () => {
    await service._attemptEnrichment(ACTIVITY_ID);

    // Verify a session file was created
    const dateDir = path.join(tmpDir, '2026-03-01');
    expect(fs.existsSync(dateDir)).toBe(true);

    const files = fs.readdirSync(dateDir).filter(f => f.endsWith('.yml'));
    expect(files).toHaveLength(1);

    // Load and verify the YAML content
    const sessionPath = path.join(dateDir, files[0]);
    const data = loadYamlSafe(sessionPath);

    expect(data.version).toBe(3);
    expect(data.session.source).toBe('strava');
    expect(data.session.duration_seconds).toBe(3600);
    expect(data.strava.activityId).toBe(99999999);
    expect(data.strava.name).toBe('Morning Basketball');
    expect(data.strava.type).toBe('Workout');
    expect(data.strava.sportType).toBe('Pickleball');
    expect(data.strava.distance).toBe(5200.5);
    expect(data.strava.trainer).toBe(false);
    expect(data.strava.avgHeartrate).toBe(145);
    expect(data.strava.maxHeartrate).toBe(172);
    expect(data.strava.map.polyline).toBe('encodedPolylineData123');
    expect(data.strava.map.startLatLng).toEqual([47.38, -122.23]);
    expect(data.participants.testuser.is_primary).toBe(true);
    expect(data.participants.testuser.strava.activityId).toBe(99999999);
    expect(data.timezone).toBe('America/Los_Angeles');
  });

  it('marks the job as completed with note "created-strava-session"', async () => {
    await service._attemptEnrichment(ACTIVITY_ID);

    // Find the update call that sets status to 'completed'
    const completedCall = mockJobStore.update.mock.calls.find(
      ([id, payload]) => payload.status === 'completed'
    );

    expect(completedCall).toBeDefined();
    expect(completedCall[0]).toBe(ACTIVITY_ID);
    expect(completedCall[1].note).toBe('created-strava-session');
    expect(completedCall[1].matchedSessionId).toBeTruthy();
    expect(completedCall[1].completedAt).toBeTruthy();
  });

  it('does NOT create a session when retries remain', async () => {
    // Set attempts to 0, so attempt will be 1 which is < MAX_RETRIES (3)
    mockJobStore.findById.mockReturnValue({ status: 'pending', attempts: 0 });

    await service._attemptEnrichment(ACTIVITY_ID);

    // No date directory should have been created
    const dateDir = path.join(tmpDir, '2026-03-01');
    expect(fs.existsSync(dateDir)).toBe(false);

    // Job should NOT have been marked completed
    const completedCall = mockJobStore.update.mock.calls.find(
      ([id, payload]) => payload.status === 'completed'
    );
    expect(completedCall).toBeUndefined();
  });

  it('creates session without map data when no GPS polyline', async () => {
    const indoorActivity = {
      ...stravaActivity,
      id: 88888888,
      trainer: true,
      map: null,
      start_latlng: null,
      end_latlng: null,
      distance: 0,
    };
    mockStravaClient.getActivity.mockResolvedValue(indoorActivity);

    await service._attemptEnrichment(ACTIVITY_ID);

    const dateDir = path.join(tmpDir, '2026-03-01');
    const files = fs.readdirSync(dateDir).filter(f => f.endsWith('.yml'));
    const data = loadYamlSafe(path.join(dateDir, files[0]));

    expect(data.strava.map).toBeUndefined();
    expect(data.strava.trainer).toBe(true);
    expect(data.strava.distance).toBe(0);
  });

  it('derives sessionId from start_date (UTC) converted to local, not start_date_local', async () => {
    await service._attemptEnrichment(ACTIVITY_ID);

    const dateDir = path.join(tmpDir, '2026-03-01');
    const files = fs.readdirSync(dateDir).filter(f => f.endsWith('.yml'));
    expect(files[0]).toBe('20260301100000.yml');

    const data = loadYamlSafe(path.join(dateDir, files[0]));
    expect(data.sessionId).toBe('20260301100000');
    expect(data.session.start).toBe('2026-03-01 10:00:00');
  });

  it('populates HR timeline, zones, coins when getActivityStreams returns data', async () => {
    const hrData = Array(15).fill(130);
    mockStravaClient.getActivityStreams = vi.fn().mockResolvedValue({
      heartrate: { data: hrData },
    });

    // Need has_heartrate flag for the gate
    const activityWithHR = { ...stravaActivity, has_heartrate: true };
    mockStravaClient.getActivity.mockResolvedValue(activityWithHR);

    await service._attemptEnrichment(ACTIVITY_ID);

    const dateDir = path.join(tmpDir, '2026-03-01');
    const files = fs.readdirSync(dateDir).filter(f => f.endsWith('.yml'));
    const data = loadYamlSafe(path.join(dateDir, files[0]));

    expect(data.timeline.series['testuser:hr']).toBeTruthy();
    expect(data.timeline.series['testuser:zone']).toBeTruthy();
    expect(data.timeline.series['testuser:coins']).toBeTruthy();
    expect(data.timeline.series['global:coins']).toBeTruthy();
    expect(data.treasureBox.totalCoins).toBe(6); // 3 ticks × 2 coins (warm zone)
    expect(data.summary.participants.testuser.hr_avg).toBe(130);
    expect(data.summary.participants.testuser.coins).toBe(6);
  });

  it('falls back to empty timeline when getActivityStreams fails', async () => {
    const activityWithHR = { ...stravaActivity, has_heartrate: true };
    mockStravaClient.getActivity.mockResolvedValue(activityWithHR);
    mockStravaClient.getActivityStreams = vi.fn().mockRejectedValue(new Error('rate limited'));

    await service._attemptEnrichment(ACTIVITY_ID);

    const dateDir = path.join(tmpDir, '2026-03-01');
    const files = fs.readdirSync(dateDir).filter(f => f.endsWith('.yml'));
    const data = loadYamlSafe(path.join(dateDir, files[0]));

    expect(data.version).toBe(3);
    expect(data.timeline.series).toEqual({});
    expect(data.treasureBox.totalCoins).toBe(0);
  });

  it('skips HR fetch when activity has no heartrate data', async () => {
    const noHrActivity = { ...stravaActivity, has_heartrate: false };
    mockStravaClient.getActivity.mockResolvedValue(noHrActivity);
    mockStravaClient.getActivityStreams = vi.fn();

    await service._attemptEnrichment(ACTIVITY_ID);

    expect(mockStravaClient.getActivityStreams).not.toHaveBeenCalled();
    const dateDir = path.join(tmpDir, '2026-03-01');
    expect(fs.existsSync(dateDir)).toBe(true);
  });

  it('populates empty timeline, treasureBox, and summary scaffolding', async () => {
    await service._attemptEnrichment(ACTIVITY_ID);

    const dateDir = path.join(tmpDir, '2026-03-01');
    const files = fs.readdirSync(dateDir).filter(f => f.endsWith('.yml'));
    const data = loadYamlSafe(path.join(dateDir, files[0]));

    // Timeline scaffold
    expect(data.timeline.series).toEqual({});
    expect(data.timeline.events).toEqual([]);
    expect(data.timeline.interval_seconds).toBe(5);
    expect(data.timeline.tick_count).toBe(Math.ceil(3600 / 5));
    expect(data.timeline.encoding).toBe('rle');

    // TreasureBox scaffold
    expect(data.treasureBox.totalCoins).toBe(0);
    expect(data.treasureBox.buckets.blue).toBe(0);

    // Summary scaffold
    expect(data.summary.media).toEqual([]);
    expect(data.summary.coins.total).toBe(0);
    expect(data.summary.challenges.total).toBe(0);
  });
});
