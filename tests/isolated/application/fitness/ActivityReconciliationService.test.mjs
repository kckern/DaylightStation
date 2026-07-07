import { describe, test, expect, vi, beforeEach } from 'vitest';

vi.mock('#system/utils/FileIO.mjs', () => ({
  loadYamlSafe: vi.fn(),
  listYamlFiles: vi.fn(),
  dirExists: vi.fn(),
  saveYaml: vi.fn(),
}));

vi.mock('fs', async () => {
  const actual = await vi.importActual('fs');
  return { ...actual, unlinkSync: vi.fn() };
});

const { unlinkSync } = await import('fs');
const { ActivityReconciliationService } = await import('#apps/fitness/ActivityReconciliationService.mjs');
const { loadYamlSafe, listYamlFiles, dirExists, saveYaml } = await import('#system/utils/FileIO.mjs');

describe('ActivityReconciliationService — Pass 3: sliver absorption', () => {
  let service;
  let stravaClient;
  let configService;
  let logger;

  beforeEach(() => {
    vi.resetAllMocks();
    // Only the most recent date dir exists, so the date loop processes
    // sessions exactly once (mirrors real-world disk state where most
    // older dates won't have sessions). We pin to the first date the
    // reconcile loop asks about — that's "today" by construction.
    let firstDate = null;
    dirExists.mockImplementation((p) => {
      const match = p?.match(/(\d{4}-\d{2}-\d{2})/);
      const date = match?.[1];
      if (!firstDate && date) firstDate = date;
      return date === firstDate;
    });
    logger = { info: vi.fn(), warn: vi.fn() };
    stravaClient = {
      getActivity: vi.fn().mockResolvedValue({
        id: 18390552794,
        type: 'Run',
        start_date: '2026-05-05T19:30:00Z',
        elapsed_time: 2388,
        moving_time: 2342,
        distance: 5230,
      }),
      updateActivity: vi.fn(),
    };
    configService = {
      getAppConfig: () => ({}),
      getTimezone: () => 'America/Los_Angeles',
    };
    service = new ActivityReconciliationService({
      activityGateway: stravaClient,
      lookbackDays: 10,
      selectionConfig: {},
      timezone: 'America/Los_Angeles',
      fitnessHistoryDir: '/tmp/fake-history',
      logger,
    });
  });

  test('absorbs orphan slivers next to a Strava-only session during reconcile', async () => {
    listYamlFiles.mockReturnValue(['strava-only-id', 'phantom-sliver']);
    loadYamlSafe.mockImplementation((p) => {
      if (p.includes('strava-only-id')) {
        return {
          sessionId: 'strava-only-id',
          timezone: 'America/Los_Angeles',
          session: {
            start: '2026-05-05 12:30:00',
            end: '2026-05-05 13:09:48',
            duration_seconds: 2388,
            source: 'strava',
          },
          participants: {
            'test-user': { strava: { activityId: 18390552794 } },
          },
          summary: { media: [] },
          strava: { activityId: 18390552794 },
        };
      }
      if (p.includes('phantom-sliver')) {
        return {
          sessionId: 'phantom-sliver',
          timezone: 'America/Los_Angeles',
          session: {
            start: '2026-05-05 13:07:56',
            end: '2026-05-05 13:14:51',
            duration_seconds: 415,
          },
          participants: { 'test-user': {} },
          summary: { media: [] },
        };
      }
      return null;
    });

    await service.reconcile();

    expect(unlinkSync).toHaveBeenCalledWith(expect.stringContaining('phantom-sliver'));
    expect(unlinkSync).not.toHaveBeenCalledWith(expect.stringContaining('strava-only-id'));
  });

  test('reconcile summary log includes sliversAbsorbed count', async () => {
    listYamlFiles.mockReturnValue(['strava-only-id', 'phantom-sliver']);
    loadYamlSafe.mockImplementation((p) => {
      if (p.includes('strava-only-id')) {
        return {
          sessionId: 'strava-only-id',
          timezone: 'America/Los_Angeles',
          session: {
            start: '2026-05-05 12:30:00',
            end: '2026-05-05 13:09:48',
            duration_seconds: 2388,
            source: 'strava',
          },
          participants: { 'test-user': { strava: { activityId: 18390552794 } } },
          summary: { media: [] },
          strava: { activityId: 18390552794 },
        };
      }
      return {
        sessionId: 'phantom-sliver',
        timezone: 'America/Los_Angeles',
        session: {
          start: '2026-05-05 13:07:56',
          end: '2026-05-05 13:14:51',
          duration_seconds: 415,
        },
        participants: { 'test-user': {} },
        summary: { media: [] },
      };
    });

    await service.reconcile();

    expect(logger.info).toHaveBeenCalledWith(
      'strava.reconciliation.complete',
      expect.objectContaining({ sliversAbsorbed: expect.any(Number) })
    );
    const completeCall = logger.info.mock.calls.find(c => c[0] === 'strava.reconciliation.complete');
    expect(completeCall[1].sliversAbsorbed).toBe(1);
  });

  test('does NOT absorb slivers when iterating a non-Strava-only session', async () => {
    // The session being reconciled is an enriched home session (has activityId
    // in participants, but not source: strava). Pass 3 should skip absorption
    // since this isn't a Strava-only session — the home session may be the
    // legitimate match for the activity.
    listYamlFiles.mockReturnValue(['enriched-home', 'maybe-sliver']);
    loadYamlSafe.mockImplementation((p) => {
      if (p.includes('enriched-home')) {
        return {
          sessionId: 'enriched-home',
          timezone: 'America/Los_Angeles',
          session: {
            start: '2026-05-04 19:16:00',
            end: '2026-05-04 20:05:00',
            duration_seconds: 2940,
            // NOTE: no source: 'strava' — this is an indoor session that
            // happened to be enriched with strava data via the writeback path.
          },
          participants: {
            'test-user': { strava: { activityId: 18380161567 } },
          },
          summary: { media: [{ contentId: 'plex:606446', primary: true }] },
        };
      }
      return {
        sessionId: 'maybe-sliver',
        timezone: 'America/Los_Angeles',
        session: {
          start: '2026-05-04 19:30:00',
          end: '2026-05-04 19:35:00',
          duration_seconds: 300,
        },
        participants: { 'test-user': {} },
        summary: { media: [] },
      };
    });

    await service.reconcile();

    // Pass 3 only fires for Strava-only sessions. The enriched home session
    // is the matched session, so absorption is intentionally skipped here.
    expect(unlinkSync).not.toHaveBeenCalled();
  });
});

describe('ActivityReconciliationService — Pass 1: title/description correction', () => {
  let service;
  let stravaClient;
  let configService;
  let logger;

  // A home session whose single primary media yields the title
  // "Game Cycling—Mario Kart Arcade GP 2" via buildStravaDescription.
  const FRESH_NAME = 'Game Cycling—Mario Kart Arcade GP 2';
  const makeSession = (stravaBlock) => ({
    sessionId: 'corrected-session',
    timezone: 'America/Los_Angeles',
    session: { start: '2026-06-20 19:30:19', end: '2026-06-20 20:04:18', duration_seconds: 2039 },
    participants: { 'test-user': { strava: { activityId: 19004447486 } } },
    timeline: {
      events: [
        {
          type: 'media',
          timestamp: 1,
          data: {
            grandparentTitle: 'Game Cycling',
            title: 'Mario Kart Arcade GP 2',
            contentType: 'episode',
          },
        },
      ],
    },
    summary: { media: [] },
    strava: stravaBlock,
  });

  beforeEach(() => {
    vi.resetAllMocks();
    let firstDate = null;
    dirExists.mockImplementation((p) => {
      const match = p?.match(/(\d{4}-\d{2}-\d{2})/);
      const date = match?.[1];
      if (!firstDate && date) firstDate = date;
      return date === firstDate;
    });
    logger = { info: vi.fn(), warn: vi.fn() };
    configService = {
      getAppConfig: () => ({}),
      getTimezone: () => 'America/Los_Angeles',
    };
    stravaClient = { getActivity: vi.fn(), updateActivity: vi.fn().mockResolvedValue({}) };
    listYamlFiles.mockReturnValue(['corrected-session']);
    service = new ActivityReconciliationService({
      activityGateway: stravaClient,
      lookbackDays: 10,
      selectionConfig: {},
      timezone: 'America/Los_Angeles',
      fitnessHistoryDir: '/tmp/fake-history',
      logger,
    });
  });

  test('self-heals a stale em-dash title even though a description already exists', async () => {
    // Legacy state: no provenance recorded; Strava still has the pre-correction
    // (pre-split) em-dash title and multi-show description.
    loadYamlSafe.mockReturnValue(makeSession({ activityId: 19004447486 }));
    stravaClient.getActivity.mockResolvedValue({
      id: 19004447486,
      name: 'Super Wings—Doll Daze',
      description: 'old multi-show description',
    });

    await service.reconcile();

    expect(stravaClient.updateActivity).toHaveBeenCalledTimes(1);
    const [, payload] = stravaClient.updateActivity.mock.calls[0];
    expect(payload.name).toBe(FRESH_NAME);
  });

  test('records provenance (strava.pushed) of what it pushed', async () => {
    loadYamlSafe.mockReturnValue(makeSession({ activityId: 19004447486 }));
    stravaClient.getActivity.mockResolvedValue({
      id: 19004447486,
      name: 'Super Wings—Doll Daze',
      description: 'old multi-show description',
    });

    await service.reconcile();

    const saved = saveYaml.mock.calls.map(c => c[1]).find(s => s?.strava?.pushed);
    expect(saved).toBeTruthy();
    expect(saved.strava.pushed.name).toBe(FRESH_NAME);
    expect(typeof saved.strava.pushed.at).toBe('string');
  });

  test('respects a manual Strava title edit (current title != last pushed)', async () => {
    // Provenance says we last pushed "Prev—Title", but Strava now shows a
    // different title => the user edited it by hand. Do not clobber it.
    loadYamlSafe.mockReturnValue(makeSession({
      activityId: 19004447486,
      pushed: { name: 'Prev—Title', description: 'desc we pushed' },
    }));
    stravaClient.getActivity.mockResolvedValue({
      id: 19004447486,
      name: 'My Hand-Edited Title',
      description: 'my hand-edited description',
    });

    await service.reconcile();

    expect(stravaClient.updateActivity).not.toHaveBeenCalled();
  });

  test('does not touch a non-em-dash manual title when no provenance exists', async () => {
    loadYamlSafe.mockReturnValue(makeSession({ activityId: 19004447486 }));
    stravaClient.getActivity.mockResolvedValue({
      id: 19004447486,
      name: 'Morning Ride',           // user-set, not ours (no em-dash)
      description: 'already has notes', // non-empty so description is left alone too
    });

    await service.reconcile();

    expect(stravaClient.updateActivity).not.toHaveBeenCalled();
  });
});
