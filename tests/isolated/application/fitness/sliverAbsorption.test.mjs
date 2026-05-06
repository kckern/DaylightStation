import { describe, test, expect, vi, beforeEach } from 'vitest';

vi.mock('#system/utils/FileIO.mjs', () => ({
  loadYamlSafe: vi.fn(),
  listYamlFiles: vi.fn(),
  dirExists: vi.fn(),
}));

vi.mock('fs', async () => {
  const actual = await vi.importActual('fs');
  return { ...actual, unlinkSync: vi.fn() };
});

const { unlinkSync } = await import('fs');
const { absorbOverlappingSlivers } = await import('#apps/fitness/sliverAbsorption.mjs');
const { loadYamlSafe, listYamlFiles, dirExists } = await import('#system/utils/FileIO.mjs');

const buildActivity = (overrides = {}) => ({
  id: 1,
  type: 'Run',
  start_date: '2026-05-04T20:00:00Z',
  elapsed_time: 2400,
  moving_time: 2350,
  distance: 5000,
  ...overrides,
});

const buildSliver = (overrides = {}) => ({
  sessionId: 'sliver-1',
  timezone: 'America/Los_Angeles',
  session: {
    start: '2026-05-04 13:07:56',
    end: '2026-05-04 13:14:51',
    duration_seconds: 415,
  },
  participants: { 'test-user': {} },
  summary: { media: [] },
  ...overrides,
});

describe('absorbOverlappingSlivers', () => {
  let logger;

  beforeEach(() => {
    vi.resetAllMocks();
    dirExists.mockReturnValue(true);
    logger = { info: vi.fn(), warn: vi.fn() };
  });

  test('absorbs short HR-only sliver inside activity window', () => {
    listYamlFiles.mockReturnValue(['sliver-1', 'just-created']);
    loadYamlSafe.mockImplementation((p) => {
      if (p.includes('sliver-1')) return buildSliver();
      return {
        sessionId: 'just-created',
        timezone: 'America/Los_Angeles',
        session: {
          start: '2026-05-04 13:00:00',
          end: '2026-05-04 13:39:48',
          duration_seconds: 2388,
          source: 'strava',
        },
        participants: { 'test-user': {} },
        summary: { media: [] },
      };
    });

    const result = absorbOverlappingSlivers(buildActivity(), '/tmp/dir', {
      justCreatedSessionId: 'just-created',
      logger,
      tz: 'America/Los_Angeles',
    });

    expect(unlinkSync).toHaveBeenCalledTimes(1);
    expect(unlinkSync).toHaveBeenCalledWith(expect.stringContaining('sliver-1'));
    expect(result.absorbed).toEqual(['sliver-1']);
    expect(result.scanned).toBe(2);
  });

  test('does not absorb sessions with media', () => {
    listYamlFiles.mockReturnValue(['indoor']);
    loadYamlSafe.mockReturnValue(buildSliver({
      summary: { media: [{ contentId: 'plex:1', primary: true }] },
    }));

    const result = absorbOverlappingSlivers(buildActivity(), '/tmp/dir', { logger });
    expect(unlinkSync).not.toHaveBeenCalled();
    expect(result.absorbed).toEqual([]);
  });

  test('does not absorb long sessions (>=15 min) even with no media', () => {
    listYamlFiles.mockReturnValue(['long']);
    loadYamlSafe.mockReturnValue(buildSliver({
      session: {
        start: '2026-05-04 13:00:00',
        end: '2026-05-04 13:25:00',
        duration_seconds: 1500,  // exactly 25 min
      },
    }));
    expect(absorbOverlappingSlivers(buildActivity(), '/tmp/dir', { logger }).absorbed).toEqual([]);
  });

  test('does not absorb sessions outside the activity window +/-15 min', () => {
    listYamlFiles.mockReturnValue(['far']);
    loadYamlSafe.mockReturnValue(buildSliver({
      session: {
        start: '2026-05-04 06:00:00',  // 7 hours earlier
        end: '2026-05-04 06:10:00',
        duration_seconds: 600,
      },
    }));
    expect(absorbOverlappingSlivers(buildActivity(), '/tmp/dir', { logger }).absorbed).toEqual([]);
  });

  test('does not absorb the just-created Strava-only session', () => {
    listYamlFiles.mockReturnValue(['just-created']);
    loadYamlSafe.mockReturnValue({
      sessionId: 'just-created',
      timezone: 'America/Los_Angeles',
      session: {
        start: '2026-05-04 13:00:00',
        end: '2026-05-04 13:39:48',
        duration_seconds: 2388,
        source: 'strava',
      },
      participants: {},
      summary: { media: [] },
    });
    const result = absorbOverlappingSlivers(buildActivity(), '/tmp/dir', {
      justCreatedSessionId: 'just-created',
      logger,
    });
    expect(unlinkSync).not.toHaveBeenCalled();
    expect(result.absorbed).toEqual([]);
  });

  test('returns absorbed/scanned counts and logs each absorption', () => {
    listYamlFiles.mockReturnValue(['s1', 's2']);
    loadYamlSafe.mockReturnValue(buildSliver());
    const result = absorbOverlappingSlivers(buildActivity(), '/tmp/dir', { logger });
    expect(result.scanned).toBe(2);
    expect(result.absorbed).toHaveLength(2);
    expect(logger.info).toHaveBeenCalledTimes(2);
    expect(logger.info).toHaveBeenCalledWith(
      'strava.enrichment.sliver_absorbed',
      expect.objectContaining({ activityId: 1, sliverDurationSec: 415 })
    );
  });

  test('returns gracefully when sessionDir does not exist', () => {
    dirExists.mockReturnValue(false);
    const result = absorbOverlappingSlivers(buildActivity(), '/missing', { logger });
    expect(result).toEqual({ scanned: 0, absorbed: [] });
    expect(unlinkSync).not.toHaveBeenCalled();
  });
});
