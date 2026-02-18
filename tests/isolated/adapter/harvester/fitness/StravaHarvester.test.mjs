// tests/unit/adapters/harvester/fitness/StravaHarvester.test.mjs
import { describe, it, expect, beforeEach, jest } from '@jest/globals';

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
});
