// tests/unit/adapters/harvester/fitness/StravaHarvester.test.mjs
import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import path from 'path';
import os from 'os';
import fs from 'fs';

describe('StravaHarvester', () => {
  let harvester;
  let mockStravaClient;
  let mockLifelogStore;
  let mockAuthStore;
  let mockConfigService;
  let mockLogger;

  beforeEach(() => {
    mockStravaClient = {
      refreshToken: jest.fn(),
      getActivities: jest.fn(),
      getActivityStreams: jest.fn()
    };

    mockLifelogStore = {
      load: jest.fn().mockResolvedValue({}),
      save: jest.fn().mockResolvedValue(undefined)
    };

    mockAuthStore = {
      get: jest.fn(),
      set: jest.fn()
    };

    mockConfigService = {
      getUserAuth: jest.fn().mockReturnValue({ token: 'test-token', refresh: 'refresh-token' }),
      getEnv: jest.fn(),
      getSecret: jest.fn(),
      getMediaDir: jest.fn().mockReturnValue('/tmp/test-media'),
      getUserDir: jest.fn().mockImplementation((u) => `/tmp/test-users/${u}`)
    };

    mockLogger = {
      info: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
      warn: jest.fn()
    };
  });

  describe('constructor', () => {
    it('should create harvester with required dependencies', async () => {
      const { StravaHarvester } = await import('#adapters/harvester/fitness/StravaHarvester.mjs');

      harvester = new StravaHarvester({
        stravaClient: mockStravaClient,
        lifelogStore: mockLifelogStore,
        authStore: mockAuthStore,
        configService: mockConfigService,
        logger: mockLogger
      });

      expect(harvester).toBeInstanceOf(StravaHarvester);
    });

    it('should throw if stravaClient not provided', async () => {
      const { StravaHarvester } = await import('#adapters/harvester/fitness/StravaHarvester.mjs');

      expect(() => new StravaHarvester({
        lifelogStore: mockLifelogStore
      })).toThrow('StravaHarvester requires stravaClient');
    });

    it('should throw if lifelogStore not provided', async () => {
      const { StravaHarvester } = await import('#adapters/harvester/fitness/StravaHarvester.mjs');

      expect(() => new StravaHarvester({
        stravaClient: mockStravaClient
      })).toThrow('StravaHarvester requires lifelogStore');
    });

    it('should accept fitnessHistoryDir dependency', async () => {
      const { StravaHarvester } = await import('#adapters/harvester/fitness/StravaHarvester.mjs');

      harvester = new StravaHarvester({
        stravaClient: mockStravaClient,
        lifelogStore: mockLifelogStore,
        configService: mockConfigService,
        fitnessHistoryDir: '/tmp/test-fitness-history',
        logger: mockLogger
      });

      expect(harvester).toBeInstanceOf(StravaHarvester);
    });
  });

  describe('serviceId', () => {
    it('should return strava', async () => {
      const { StravaHarvester } = await import('#adapters/harvester/fitness/StravaHarvester.mjs');

      harvester = new StravaHarvester({
        stravaClient: mockStravaClient,
        lifelogStore: mockLifelogStore,
        logger: mockLogger
      });

      expect(harvester.serviceId).toBe('strava');
    });
  });

  describe('reauthSequence', () => {
    it('should generate reauthorization URL', async () => {
      const { StravaHarvester } = await import('#adapters/harvester/fitness/StravaHarvester.mjs');

      mockConfigService.getSecret.mockImplementation((key) => {
        if (key === 'STRAVA_CLIENT_ID') return '12345';
        if (key === 'STRAVA_URL') return 'http://localhost:3000/callback';
        return null;
      });

      harvester = new StravaHarvester({
        stravaClient: mockStravaClient,
        lifelogStore: mockLifelogStore,
        configService: mockConfigService,
        logger: mockLogger
      });

      const result = harvester.reauthSequence();

      expect(result).toHaveProperty('url');
      expect(result.url).toContain('strava.com/oauth/authorize');
      expect(result.url).toContain('client_id=12345');
      expect(result.url).toContain('approval_prompt=force');
      expect(result.url).toContain('scope=read,activity:read_all');
    });

    it('should use custom redirect URI when provided', async () => {
      const { StravaHarvester } = await import('#adapters/harvester/fitness/StravaHarvester.mjs');

      mockConfigService.getSecret.mockReturnValue('12345');

      harvester = new StravaHarvester({
        stravaClient: mockStravaClient,
        lifelogStore: mockLifelogStore,
        configService: mockConfigService,
        logger: mockLogger
      });

      const result = harvester.reauthSequence({
        redirectUri: 'https://example.com/auth/callback'
      });

      expect(result.url).toContain('redirect_uri=https%3A%2F%2Fexample.com%2Fauth%2Fcallback');
    });

    it('should use undefined client_id when configService not available', async () => {
      const { StravaHarvester } = await import('#adapters/harvester/fitness/StravaHarvester.mjs');

      harvester = new StravaHarvester({
        stravaClient: mockStravaClient,
        lifelogStore: mockLifelogStore,
        logger: mockLogger
        // Note: no configService provided
      });

      const result = harvester.reauthSequence();

      // Without configService, client_id will be undefined
      expect(result.url).toContain('client_id=undefined');
    });
  });

  describe('getStatus', () => {
    it('should return circuit breaker status', async () => {
      const { StravaHarvester } = await import('#adapters/harvester/fitness/StravaHarvester.mjs');

      harvester = new StravaHarvester({
        stravaClient: mockStravaClient,
        lifelogStore: mockLifelogStore,
        logger: mockLogger
      });

      const status = harvester.getStatus();

      expect(status).toHaveProperty('state');
      expect(status.state).toBe('closed');
    });
  });

  describe('home session matching', () => {
    let StravaHarvester;
    let tmpDir;

    beforeEach(async () => {
      ({ StravaHarvester } = await import('#adapters/harvester/fitness/StravaHarvester.mjs'));
      tmpDir = path.join(os.tmpdir(), `strava-test-${Date.now()}`);
      fs.mkdirSync(tmpDir, { recursive: true });
    });

    afterEach(() => {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it('should match Strava activity to overlapping home session', async () => {
      const dateDir = path.join(tmpDir, '2026-02-15');
      fs.mkdirSync(dateDir, { recursive: true });

      const sessionData = {
        sessionId: '20260215191250',
        session: {
          id: '20260215191250',
          date: '2026-02-15',
          start: '2026-02-15 19:12:50',
          end: '2026-02-15 19:20:50',
          duration_seconds: 480,
        },
        timezone: 'America/Los_Angeles',
        participants: {
          kckern: {
            display_name: 'KC Kern',
            hr_device: '40475',
            is_primary: true,
          },
        },
        treasureBox: { totalCoins: 15 },
        timeline: { events: [] },
      };

      const { saveYaml } = await import('#system/utils/FileIO.mjs');
      saveYaml(path.join(dateDir, '20260215191250'), sessionData);

      const activity = {
        id: 17418186050,
        start_date: '2026-02-16T03:10:00Z',
        moving_time: 600,
        type: 'WeightTraining',
        name: 'Evening Weight Training',
        suffer_score: 5,
        device_name: 'Garmin Forerunner 245 Music',
      };

      harvester = new StravaHarvester({
        stravaClient: mockStravaClient,
        lifelogStore: mockLifelogStore,
        configService: mockConfigService,
        fitnessHistoryDir: tmpDir,
        timezone: 'America/Los_Angeles',
        logger: mockLogger,
      });

      const matches = await harvester.matchHomeSessions('kckern', [activity]);

      expect(matches).toHaveLength(1);
      expect(matches[0].activityId).toBe(17418186050);
      expect(matches[0].sessionId).toBe('20260215191250');
    });

    it('should NOT match when user is not a participant', async () => {
      const dateDir = path.join(tmpDir, '2026-02-15');
      fs.mkdirSync(dateDir, { recursive: true });

      const sessionData = {
        sessionId: '20260215191250',
        session: {
          id: '20260215191250',
          date: '2026-02-15',
          start: '2026-02-15 19:12:50',
          end: '2026-02-15 19:20:50',
          duration_seconds: 480,
        },
        timezone: 'America/Los_Angeles',
        participants: {
          milo: { display_name: 'Milo', is_primary: true },
        },
        treasureBox: { totalCoins: 10 },
        timeline: { events: [] },
      };

      const { saveYaml } = await import('#system/utils/FileIO.mjs');
      saveYaml(path.join(dateDir, '20260215191250'), sessionData);

      const activity = {
        id: 17418186050,
        start_date: '2026-02-16T03:10:00Z',
        moving_time: 600,
        type: 'WeightTraining',
      };

      harvester = new StravaHarvester({
        stravaClient: mockStravaClient,
        lifelogStore: mockLifelogStore,
        configService: mockConfigService,
        fitnessHistoryDir: tmpDir,
        timezone: 'America/Los_Angeles',
        logger: mockLogger,
      });

      const matches = await harvester.matchHomeSessions('kckern', [activity]);
      expect(matches).toHaveLength(0);
    });

    it('should NOT match when times do not overlap within 5 min buffer', async () => {
      const dateDir = path.join(tmpDir, '2026-02-15');
      fs.mkdirSync(dateDir, { recursive: true });

      const sessionData = {
        sessionId: '20260215150000',
        session: {
          id: '20260215150000',
          date: '2026-02-15',
          start: '2026-02-15 15:00:00',
          end: '2026-02-15 15:10:00',
          duration_seconds: 600,
        },
        timezone: 'America/Los_Angeles',
        participants: {
          kckern: { display_name: 'KC Kern', is_primary: true },
        },
        treasureBox: { totalCoins: 5 },
        timeline: { events: [] },
      };

      const { saveYaml } = await import('#system/utils/FileIO.mjs');
      saveYaml(path.join(dateDir, '20260215150000'), sessionData);

      const activity = {
        id: 17418186050,
        start_date: '2026-02-16T03:10:00Z',
        moving_time: 600,
        type: 'WeightTraining',
      };

      harvester = new StravaHarvester({
        stravaClient: mockStravaClient,
        lifelogStore: mockLifelogStore,
        configService: mockConfigService,
        fitnessHistoryDir: tmpDir,
        timezone: 'America/Los_Angeles',
        logger: mockLogger,
      });

      const matches = await harvester.matchHomeSessions('kckern', [activity]);
      expect(matches).toHaveLength(0);
    });

    it('should enrich Strava summary with home session data', async () => {
      const dateDir = path.join(tmpDir, '2026-02-15');
      fs.mkdirSync(dateDir, { recursive: true });

      const sessionData = {
        sessionId: '20260215191250',
        session: {
          id: '20260215191250',
          date: '2026-02-15',
          start: '2026-02-15 19:12:50',
          end: '2026-02-15 19:20:50',
          duration_seconds: 480,
        },
        timezone: 'America/Los_Angeles',
        participants: {
          kckern: { display_name: 'KC Kern', is_primary: true },
        },
        treasureBox: { totalCoins: 15 },
        timeline: {
          events: [
            { timestamp: 123, type: 'media', data: { title: 'Mario Kart 8' } },
          ],
        },
      };

      const { saveYaml } = await import('#system/utils/FileIO.mjs');
      saveYaml(path.join(dateDir, '20260215191250'), sessionData);

      const activity = {
        id: 17418186050,
        start_date: '2026-02-16T03:10:00Z',
        moving_time: 600,
        type: 'WeightTraining',
        name: 'Evening Weight Training',
        suffer_score: 5,
        device_name: 'Garmin Forerunner 245 Music',
      };

      const existingSummary = {
        '2026-02-15': [
          { id: 17418186050, title: 'Evening Weight Training', type: 'WeightTraining' },
        ],
      };
      mockLifelogStore.load.mockResolvedValue(existingSummary);

      harvester = new StravaHarvester({
        stravaClient: mockStravaClient,
        lifelogStore: mockLifelogStore,
        configService: mockConfigService,
        fitnessHistoryDir: tmpDir,
        timezone: 'America/Los_Angeles',
        logger: mockLogger,
      });

      await harvester.applyHomeSessionEnrichment('kckern', [activity]);

      const saveCalls = mockLifelogStore.save.mock.calls;
      const summarySave = saveCalls.find(c => c[1] === 'strava');
      expect(summarySave).toBeTruthy();

      const savedSummary = summarySave[2];
      const enrichedEntry = savedSummary['2026-02-15'].find(a => a.id === 17418186050);
      expect(enrichedEntry.homeSessionId).toBe('20260215191250');
      expect(enrichedEntry.homeCoins).toBe(15);
      expect(enrichedEntry.homeMedia).toBe('Mario Kart 8');
    });

    it('should enrich home session file with Strava data', async () => {
      const dateDir = path.join(tmpDir, '2026-02-15');
      fs.mkdirSync(dateDir, { recursive: true });

      const sessionData = {
        sessionId: '20260215191250',
        session: {
          id: '20260215191250',
          date: '2026-02-15',
          start: '2026-02-15 19:12:50',
          end: '2026-02-15 19:20:50',
          duration_seconds: 480,
        },
        timezone: 'America/Los_Angeles',
        participants: {
          kckern: { display_name: 'KC Kern', is_primary: true },
        },
        treasureBox: { totalCoins: 15 },
        timeline: { events: [] },
      };

      const { saveYaml, loadYamlSafe } = await import('#system/utils/FileIO.mjs');
      const sessionPath = path.join(dateDir, '20260215191250');
      saveYaml(sessionPath, sessionData);

      const activity = {
        id: 17418186050,
        start_date: '2026-02-16T03:10:00Z',
        moving_time: 600,
        type: 'WeightTraining',
        name: 'Evening Weight Training',
        suffer_score: 5,
        device_name: 'Garmin Forerunner 245 Music',
      };

      mockLifelogStore.load.mockResolvedValue({
        '2026-02-15': [{ id: 17418186050, type: 'WeightTraining' }],
      });

      harvester = new StravaHarvester({
        stravaClient: mockStravaClient,
        lifelogStore: mockLifelogStore,
        configService: mockConfigService,
        fitnessHistoryDir: tmpDir,
        timezone: 'America/Los_Angeles',
        logger: mockLogger,
      });

      await harvester.applyHomeSessionEnrichment('kckern', [activity]);

      const updated = loadYamlSafe(sessionPath);
      expect(updated.participants.kckern.strava).toBeDefined();
      expect(updated.participants.kckern.strava.activityId).toBe(17418186050);
      expect(updated.participants.kckern.strava.type).toBe('WeightTraining');
      expect(updated.participants.kckern.strava.sufferScore).toBe(5);
      expect(updated.participants.kckern.strava.deviceName).toBe('Garmin Forerunner 245 Music');
    });
  });
});
