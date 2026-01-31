// tests/unit/adapters/harvester/fitness/WithingsHarvester.test.mjs
import { jest } from '@jest/globals';

describe('WithingsHarvester', () => {
  let WithingsHarvester;
  let HarvesterCategory;
  let harvester;
  let mockHttpClient;
  let mockLifelogStore;
  let mockAuthStore;
  let mockConfigService;
  let mockLogger;

  beforeEach(async () => {
    // Reset modules to ensure clean state
    jest.resetModules();

    // Import fresh module
    const module = await import('#adapters/harvester/fitness/WithingsHarvester.mjs');
    WithingsHarvester = module.WithingsHarvester;

    const portsModule = await import('#adapters/harvester/ports/IHarvester.mjs');
    HarvesterCategory = portsModule.HarvesterCategory;

    // Setup mocks
    mockHttpClient = {
      get: jest.fn(),
      post: jest.fn()
    };

    mockLifelogStore = {
      save: jest.fn().mockResolvedValue(undefined),
      load: jest.fn().mockResolvedValue(null)
    };

    mockAuthStore = {
      save: jest.fn().mockResolvedValue(undefined),
      load: jest.fn().mockResolvedValue(null)
    };

    mockConfigService = {
      getUserAuth: jest.fn().mockReturnValue({ refresh: 'test-refresh-token' }),
      getSecret: jest.fn().mockImplementation((key) => {
        const secrets = {
          WITHINGS_CLIENT_ID: 'test-client-id',
          WITHINGS_CLIENT_SECRET: 'test-client-secret',
          WITHINGS_REDIRECT: 'http://localhost/callback'
        };
        return secrets[key];
      })
    };

    mockLogger = {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn()
    };

    harvester = new WithingsHarvester({
      httpClient: mockHttpClient,
      lifelogStore: mockLifelogStore,
      authStore: mockAuthStore,
      configService: mockConfigService,
      timezone: 'America/Los_Angeles',
      logger: mockLogger
    });
  });

  describe('constructor', () => {
    test('throws without httpClient', () => {
      expect(() => new WithingsHarvester({
        lifelogStore: mockLifelogStore
      })).toThrow('requires httpClient');
    });

    test('throws without lifelogStore', () => {
      expect(() => new WithingsHarvester({
        httpClient: mockHttpClient
      })).toThrow('requires lifelogStore');
    });

    test('creates instance with valid config', () => {
      const instance = new WithingsHarvester({
        httpClient: mockHttpClient,
        lifelogStore: mockLifelogStore,
        authStore: mockAuthStore,
        configService: mockConfigService,
        logger: mockLogger
      });
      expect(instance).toBeInstanceOf(WithingsHarvester);
    });
  });

  describe('serviceId', () => {
    test('returns "withings"', () => {
      expect(harvester.serviceId).toBe('withings');
    });
  });

  describe('category', () => {
    test('returns FITNESS category', () => {
      expect(harvester.category).toBe(HarvesterCategory.FITNESS);
    });
  });

  describe('harvest', () => {
    const mockTokenResponse = {
      data: {
        body: {
          access_token: 'test-access-token',
          refresh_token: 'new-refresh-token',
          expires_in: 3600
        }
      }
    };

    const mockMeasureResponse = {
      data: {
        body: {
          measuregrps: [
            {
              date: 1704067200, // 2024-01-01 00:00:00 UTC
              measures: [
                { type: 1, value: 80000, unit: -3 }, // 80kg weight
                { type: 6, value: 200, unit: -1 },   // 20% body fat
                { type: 5, value: 64000, unit: -3 }, // 64kg lean mass
                { type: 8, value: 16000, unit: -3 }  // 16kg fat mass
              ]
            }
          ]
        }
      }
    };

    test('harvests measurements successfully', async () => {
      mockHttpClient.post.mockResolvedValue(mockTokenResponse);
      mockHttpClient.get.mockResolvedValue(mockMeasureResponse);

      const result = await harvester.harvest('testuser');

      expect(result.status).toBe('success');
      expect(result.count).toBe(1);
      expect(mockLifelogStore.save).toHaveBeenCalled();
      expect(mockLogger.info).toHaveBeenCalledWith(
        'withings.harvest.start',
        expect.objectContaining({ username: 'testuser' })
      );
    });

    test('returns success with zero count when no measurements', async () => {
      mockHttpClient.post.mockResolvedValue(mockTokenResponse);
      mockHttpClient.get.mockResolvedValue({ data: { body: { measuregrps: [] } } });

      const result = await harvester.harvest('testuser');

      expect(result.status).toBe('success');
      expect(result.count).toBe(0);
      expect(mockLifelogStore.save).not.toHaveBeenCalled();
    });

    test('returns error status when auth fails', async () => {
      mockConfigService.getUserAuth.mockReturnValue({});

      const result = await harvester.harvest('testuser');

      expect(result.status).toBe('error');
      expect(result.reason).toBe('auth_failed');
    });

    test('respects yearsBack option', async () => {
      mockHttpClient.post.mockResolvedValue(mockTokenResponse);
      mockHttpClient.get.mockResolvedValue(mockMeasureResponse);

      await harvester.harvest('testuser', { yearsBack: 5 });

      expect(mockLogger.info).toHaveBeenCalledWith(
        'withings.harvest.start',
        expect.objectContaining({ yearsBack: 5 })
      );
    });

    test('handles API errors', async () => {
      mockHttpClient.post.mockResolvedValue(mockTokenResponse);
      mockHttpClient.get.mockRejectedValue(new Error('API error'));

      await expect(harvester.harvest('testuser')).rejects.toThrow('API error');
      expect(mockLogger.error).toHaveBeenCalled();
    });

    test('handles rate limiting with circuit breaker', async () => {
      const rateLimitError = new Error('Too Many Requests');
      rateLimitError.response = { status: 429 };

      mockHttpClient.post.mockResolvedValue(mockTokenResponse);
      mockHttpClient.get.mockRejectedValue(rateLimitError);

      // First call triggers rate limit
      await expect(harvester.harvest('testuser')).rejects.toThrow();

      // Verify circuit breaker recorded failure
      const status = harvester.getStatus();
      expect(status.failures).toBeGreaterThan(0);
    });

    test('skips when circuit breaker is open', async () => {
      const rateLimitError = new Error('Too Many Requests');
      rateLimitError.response = { status: 429 };

      mockHttpClient.post.mockResolvedValue(mockTokenResponse);
      mockHttpClient.get.mockRejectedValue(rateLimitError);

      // Trigger circuit breaker by causing multiple failures
      for (let i = 0; i < 3; i++) {
        try {
          await harvester.harvest('testuser');
        } catch (e) {
          // Expected
        }
      }

      // Circuit breaker should now be open
      mockHttpClient.get.mockClear();
      const result = await harvester.harvest('testuser');

      expect(result.status).toBe('skipped');
      expect(result.reason).toBe('cooldown');
      expect(mockHttpClient.get).not.toHaveBeenCalled();
    });

    test('converts kg measurements to lbs', async () => {
      mockHttpClient.post.mockResolvedValue(mockTokenResponse);
      mockHttpClient.get.mockResolvedValue(mockMeasureResponse);

      await harvester.harvest('testuser');

      // Check that save was called with lbs conversion
      expect(mockLifelogStore.save).toHaveBeenCalledWith(
        'testuser',
        'withings',
        expect.arrayContaining([
          expect.objectContaining({
            lbs: expect.any(Number)
          })
        ])
      );
    });

    test('persists new refresh token', async () => {
      mockHttpClient.post.mockResolvedValue(mockTokenResponse);
      mockHttpClient.get.mockResolvedValue(mockMeasureResponse);

      await harvester.harvest('testuser');

      expect(mockAuthStore.save).toHaveBeenCalledWith(
        'testuser',
        'withings',
        expect.objectContaining({
          refresh: 'new-refresh-token',
          access_token: 'test-access-token'
        })
      );
    });
  });

  describe('getStatus', () => {
    test('returns circuit breaker status', () => {
      const status = harvester.getStatus();

      expect(status).toHaveProperty('state');
      expect(status).toHaveProperty('failures');
      expect(status.state).toBe('closed');
      expect(status.failures).toBe(0);
    });
  });

  describe('token caching', () => {
    const mockTokenResponse = {
      data: {
        body: {
          access_token: 'test-access-token',
          refresh_token: 'new-refresh-token',
          expires_in: 3600
        }
      }
    };

    const mockMeasureResponse = {
      data: {
        body: {
          measuregrps: []
        }
      }
    };

    test('caches token between harvests', async () => {
      mockHttpClient.post.mockResolvedValue(mockTokenResponse);
      mockHttpClient.get.mockResolvedValue(mockMeasureResponse);

      // First harvest - should refresh token
      await harvester.harvest('testuser');
      expect(mockHttpClient.post).toHaveBeenCalledTimes(1);

      // Second harvest - should use cached token
      await harvester.harvest('testuser');
      expect(mockHttpClient.post).toHaveBeenCalledTimes(1);
    });
  });

  describe('measurement parsing', () => {
    const mockTokenResponse = {
      data: {
        body: {
          access_token: 'test-access-token',
          refresh_token: 'new-refresh-token',
          expires_in: 3600
        }
      }
    };

    test('handles multiple measurement groups', async () => {
      const multiMeasureResponse = {
        data: {
          body: {
            measuregrps: [
              {
                date: 1704067200,
                measures: [{ type: 1, value: 80000, unit: -3 }]
              },
              {
                date: 1704153600, // Next day
                measures: [{ type: 1, value: 79500, unit: -3 }]
              }
            ]
          }
        }
      };

      mockHttpClient.post.mockResolvedValue(mockTokenResponse);
      mockHttpClient.get.mockResolvedValue(multiMeasureResponse);

      const result = await harvester.harvest('testuser');

      expect(result.count).toBe(2);
    });

    test('filters out measurements without weight', async () => {
      const noWeightResponse = {
        data: {
          body: {
            measuregrps: [
              {
                date: 1704067200,
                measures: [{ type: 6, value: 200, unit: -1 }] // Only body fat, no weight
              }
            ]
          }
        }
      };

      mockHttpClient.post.mockResolvedValue(mockTokenResponse);
      mockHttpClient.get.mockResolvedValue(noWeightResponse);

      const result = await harvester.harvest('testuser');

      expect(result.count).toBe(0);
    });
  });
});
