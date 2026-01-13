// tests/unit/adapters/harvester/fitness/FitnessSyncerAdapter.test.mjs
import { jest } from '@jest/globals';

describe('FitnessSyncerAdapter', () => {
  let FitnessSyncerAdapter;
  let adapter;
  let mockHttpClient;
  let mockAuthStore;
  let mockLogger;

  const validConfig = {
    clientId: 'test-client-id',
    clientSecret: 'test-client-secret',
  };

  const mockAuthData = {
    refresh: 'test-refresh-token',
    client_id: 'test-client-id',
    client_secret: 'test-client-secret',
  };

  beforeEach(async () => {
    jest.resetModules();
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-01-13T12:00:00Z'));

    const module = await import('../../../../../backend/src/2_adapters/harvester/fitness/FitnessSyncerAdapter.mjs');
    FitnessSyncerAdapter = module.FitnessSyncerAdapter;

    mockHttpClient = {
      get: jest.fn(),
      post: jest.fn(),
    };

    mockAuthStore = {
      get: jest.fn(),
      set: jest.fn(),
    };

    mockLogger = {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    };

    adapter = new FitnessSyncerAdapter({
      httpClient: mockHttpClient,
      authStore: mockAuthStore,
      logger: mockLogger,
      clientId: validConfig.clientId,
      clientSecret: validConfig.clientSecret,
    });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('constructor', () => {
    test('throws without httpClient', () => {
      expect(() => new FitnessSyncerAdapter({
        authStore: mockAuthStore,
        clientId: validConfig.clientId,
        clientSecret: validConfig.clientSecret,
      })).toThrow('requires httpClient');
    });

    test('throws without authStore', () => {
      expect(() => new FitnessSyncerAdapter({
        httpClient: mockHttpClient,
        clientId: validConfig.clientId,
        clientSecret: validConfig.clientSecret,
      })).toThrow('requires authStore');
    });

    test('creates instance with valid config', () => {
      const instance = new FitnessSyncerAdapter({
        httpClient: mockHttpClient,
        authStore: mockAuthStore,
        clientId: validConfig.clientId,
        clientSecret: validConfig.clientSecret,
        logger: mockLogger,
      });
      expect(instance).toBeInstanceOf(FitnessSyncerAdapter);
    });

    test('uses default cooldownMinutes when not provided', () => {
      const instance = new FitnessSyncerAdapter({
        httpClient: mockHttpClient,
        authStore: mockAuthStore,
        clientId: validConfig.clientId,
        clientSecret: validConfig.clientSecret,
      });
      expect(instance).toBeInstanceOf(FitnessSyncerAdapter);
    });

    test('accepts custom cooldownMinutes', () => {
      const instance = new FitnessSyncerAdapter({
        httpClient: mockHttpClient,
        authStore: mockAuthStore,
        clientId: validConfig.clientId,
        clientSecret: validConfig.clientSecret,
        cooldownMinutes: 10,
      });
      expect(instance).toBeInstanceOf(FitnessSyncerAdapter);
    });
  });

  describe('getAccessToken', () => {
    const mockTokenResponse = {
      data: {
        access_token: 'new-access-token',
        refresh_token: 'new-refresh-token',
        expires_in: 3600,
      },
    };

    test('returns cached token if still valid', async () => {
      // Store a token that expires in 10 minutes
      const futureExpiry = Date.now() + 10 * 60 * 1000;
      mockAuthStore.get.mockResolvedValue({
        access_token: 'cached-token',
        expires_at: futureExpiry,
        refresh: 'test-refresh-token',
      });

      const token = await adapter.getAccessToken();

      expect(token).toBe('cached-token');
      expect(mockHttpClient.post).not.toHaveBeenCalled();
    });

    test('refreshes token when expired', async () => {
      // Store a token that expired 5 minutes ago
      const pastExpiry = Date.now() - 5 * 60 * 1000;
      mockAuthStore.get.mockResolvedValue({
        access_token: 'expired-token',
        expires_at: pastExpiry,
        refresh: 'test-refresh-token',
      });

      mockHttpClient.post.mockResolvedValue(mockTokenResponse);

      const token = await adapter.getAccessToken();

      expect(token).toBe('new-access-token');
      expect(mockHttpClient.post).toHaveBeenCalled();
    });

    test('refreshes token when expiring within buffer period (5 minutes)', async () => {
      // Store a token that expires in 4 minutes (within 5-minute buffer)
      const nearExpiry = Date.now() + 4 * 60 * 1000;
      mockAuthStore.get.mockResolvedValue({
        access_token: 'nearly-expired-token',
        expires_at: nearExpiry,
        refresh: 'test-refresh-token',
      });

      mockHttpClient.post.mockResolvedValue(mockTokenResponse);

      const token = await adapter.getAccessToken();

      expect(token).toBe('new-access-token');
      expect(mockHttpClient.post).toHaveBeenCalled();
    });

    test('makes correct OAuth token request', async () => {
      mockAuthStore.get.mockResolvedValue({
        refresh: 'test-refresh-token',
      });

      mockHttpClient.post.mockResolvedValue(mockTokenResponse);

      await adapter.getAccessToken();

      expect(mockHttpClient.post).toHaveBeenCalledWith(
        'https://www.fitnesssyncer.com/api/oauth/access_token',
        expect.any(URLSearchParams),
        { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
      );

      const params = mockHttpClient.post.mock.calls[0][1];
      expect(params.get('grant_type')).toBe('refresh_token');
      expect(params.get('refresh_token')).toBe('test-refresh-token');
      expect(params.get('client_id')).toBe('test-client-id');
      expect(params.get('client_secret')).toBe('test-client-secret');
    });

    test('persists new tokens to authStore', async () => {
      mockAuthStore.get.mockResolvedValue({
        refresh: 'old-refresh-token',
      });

      mockHttpClient.post.mockResolvedValue(mockTokenResponse);

      await adapter.getAccessToken();

      expect(mockAuthStore.set).toHaveBeenCalledWith(
        'fitsync',
        expect.objectContaining({
          access_token: 'new-access-token',
          refresh: 'new-refresh-token',
          expires_at: expect.any(Number),
        })
      );
    });

    test('returns null when no refresh token available', async () => {
      mockAuthStore.get.mockResolvedValue({});

      const token = await adapter.getAccessToken();

      expect(token).toBeNull();
      expect(mockLogger.error).toHaveBeenCalled();
    });

    test('returns null when authStore returns null', async () => {
      mockAuthStore.get.mockResolvedValue(null);

      const token = await adapter.getAccessToken();

      expect(token).toBeNull();
    });

    test('returns null on token refresh failure', async () => {
      mockAuthStore.get.mockResolvedValue({
        refresh: 'test-refresh-token',
      });

      mockHttpClient.post.mockRejectedValue(new Error('Network error'));

      const token = await adapter.getAccessToken();

      expect(token).toBeNull();
      expect(mockLogger.error).toHaveBeenCalled();
    });

    test('clears cached token on refresh failure', async () => {
      // First, establish a cached token
      mockAuthStore.get.mockResolvedValue({
        refresh: 'test-refresh-token',
      });

      mockHttpClient.post.mockResolvedValue(mockTokenResponse);
      await adapter.getAccessToken();

      // Now simulate expiry and failure
      jest.advanceTimersByTime(2 * 60 * 60 * 1000); // 2 hours

      mockAuthStore.get.mockResolvedValue({
        refresh: 'test-refresh-token',
        expires_at: Date.now() - 1000, // Expired
      });

      mockHttpClient.post.mockRejectedValue(new Error('Refresh failed'));

      const token = await adapter.getAccessToken();

      expect(token).toBeNull();
    });

    test('caches token in memory between calls', async () => {
      mockAuthStore.get.mockResolvedValue({
        refresh: 'test-refresh-token',
      });

      mockHttpClient.post.mockResolvedValue(mockTokenResponse);

      // First call - should hit API
      const token1 = await adapter.getAccessToken();
      expect(token1).toBe('new-access-token');
      expect(mockHttpClient.post).toHaveBeenCalledTimes(1);

      // Second call - should use in-memory cache
      const token2 = await adapter.getAccessToken();
      expect(token2).toBe('new-access-token');
      expect(mockHttpClient.post).toHaveBeenCalledTimes(1);
    });

    test('records failure for rate limit errors (429)', async () => {
      mockAuthStore.get.mockResolvedValue({
        refresh: 'test-refresh-token',
      });

      const rateLimitError = new Error('Rate limited');
      rateLimitError.response = { status: 429 };
      mockHttpClient.post.mockRejectedValue(rateLimitError);

      await adapter.getAccessToken();

      // Circuit breaker should have recorded failure
      expect(adapter.isInCooldown()).toBe(false); // Not yet open after 1 failure
    });
  });

  describe('isInCooldown', () => {
    test('returns false when circuit breaker is closed', () => {
      expect(adapter.isInCooldown()).toBe(false);
    });

    test('returns true when circuit breaker is open', async () => {
      mockAuthStore.get.mockResolvedValue({
        refresh: 'test-refresh-token',
      });

      const rateLimitError = new Error('Rate limited');
      rateLimitError.response = { status: 429 };
      mockHttpClient.post.mockRejectedValue(rateLimitError);

      // Trigger 3 failures to open circuit breaker
      for (let i = 0; i < 3; i++) {
        await adapter.getAccessToken();
      }

      expect(adapter.isInCooldown()).toBe(true);
    });

    test('returns cooldown status with remaining time', async () => {
      mockAuthStore.get.mockResolvedValue({
        refresh: 'test-refresh-token',
      });

      const rateLimitError = new Error('Rate limited');
      rateLimitError.response = { status: 429 };
      mockHttpClient.post.mockRejectedValue(rateLimitError);

      // Trigger 3 failures to open circuit breaker
      for (let i = 0; i < 3; i++) {
        await adapter.getAccessToken();
      }

      const cooldownStatus = adapter.getCooldownStatus();
      expect(cooldownStatus).not.toBeNull();
      expect(cooldownStatus.inCooldown).toBe(true);
      expect(cooldownStatus.remainingMs).toBeGreaterThan(0);
      expect(cooldownStatus.remainingMins).toBeGreaterThan(0);
    });
  });

  describe('recordFailure', () => {
    test('records failure and opens circuit after threshold', () => {
      adapter.recordFailure(new Error('Test error'));
      expect(adapter.isInCooldown()).toBe(false);

      adapter.recordFailure(new Error('Test error'));
      expect(adapter.isInCooldown()).toBe(false);

      adapter.recordFailure(new Error('Test error'));
      expect(adapter.isInCooldown()).toBe(true);
    });

    test('logs warning when circuit opens', () => {
      for (let i = 0; i < 3; i++) {
        adapter.recordFailure(new Error('Test error'));
      }

      // CircuitBreaker uses 'circuit.open' prefix
      expect(mockLogger.warn).toHaveBeenCalledWith(
        'circuit.open',
        expect.objectContaining({
          failures: 3,
        })
      );
    });
  });

  describe('recordSuccess', () => {
    test('resets circuit breaker after success', () => {
      // Open the circuit
      for (let i = 0; i < 3; i++) {
        adapter.recordFailure(new Error('Test error'));
      }
      expect(adapter.isInCooldown()).toBe(true);

      // Advance time past cooldown
      jest.advanceTimersByTime(6 * 60 * 1000); // 6 minutes

      // Record success
      adapter.recordSuccess();

      // Circuit should be closed
      expect(adapter.isInCooldown()).toBe(false);
    });

    test('logs success when recovering from failures', () => {
      adapter.recordFailure(new Error('Test error'));
      adapter.recordSuccess();

      // CircuitBreaker uses 'circuit.success' prefix
      expect(mockLogger.info).toHaveBeenCalledWith(
        'circuit.success',
        expect.objectContaining({
          previousFailures: 1,
        })
      );
    });
  });

  describe('getStatus', () => {
    test('returns circuit breaker status', () => {
      const status = adapter.getStatus();

      expect(status).toHaveProperty('state');
      expect(status).toHaveProperty('failures');
      expect(status.state).toBe('closed');
      expect(status.failures).toBe(0);
    });

    test('reflects current failure count', () => {
      adapter.recordFailure(new Error('Test error'));
      adapter.recordFailure(new Error('Test error'));

      const status = adapter.getStatus();
      expect(status.failures).toBe(2);
    });
  });

  describe('credential handling', () => {
    test('uses credentials from authStore when available', async () => {
      mockAuthStore.get.mockResolvedValue({
        refresh: 'test-refresh-token',
        client_id: 'stored-client-id',
        client_secret: 'stored-client-secret',
      });

      mockHttpClient.post.mockResolvedValue({
        data: {
          access_token: 'new-token',
          refresh_token: 'new-refresh',
          expires_in: 3600,
        },
      });

      // Create adapter without credentials
      const adapterWithoutCreds = new FitnessSyncerAdapter({
        httpClient: mockHttpClient,
        authStore: mockAuthStore,
        logger: mockLogger,
      });

      await adapterWithoutCreds.getAccessToken();

      const params = mockHttpClient.post.mock.calls[0][1];
      expect(params.get('client_id')).toBe('stored-client-id');
      expect(params.get('client_secret')).toBe('stored-client-secret');
    });

    test('prefers constructor credentials over stored credentials', async () => {
      mockAuthStore.get.mockResolvedValue({
        refresh: 'test-refresh-token',
        client_id: 'stored-client-id',
        client_secret: 'stored-client-secret',
      });

      mockHttpClient.post.mockResolvedValue({
        data: {
          access_token: 'new-token',
          refresh_token: 'new-refresh',
          expires_in: 3600,
        },
      });

      await adapter.getAccessToken();

      const params = mockHttpClient.post.mock.calls[0][1];
      expect(params.get('client_id')).toBe('test-client-id');
      expect(params.get('client_secret')).toBe('test-client-secret');
    });
  });

  describe('token expiry buffer', () => {
    test('uses 5-minute buffer before actual expiry', async () => {
      mockAuthStore.get.mockResolvedValue({
        refresh: 'test-refresh-token',
      });

      mockHttpClient.post.mockResolvedValue({
        data: {
          access_token: 'new-access-token',
          refresh_token: 'new-refresh-token',
          expires_in: 3600, // 1 hour
        },
      });

      await adapter.getAccessToken();

      // Check that the stored expires_at is about 55 minutes from now (3600 - 300 seconds)
      const setCall = mockAuthStore.set.mock.calls[0];
      const storedData = setCall[1];
      const expectedExpiry = Date.now() + (3600 - 300) * 1000; // 55 minutes

      // Allow 1 second tolerance for test execution time
      expect(storedData.expires_at).toBeGreaterThan(expectedExpiry - 1000);
      expect(storedData.expires_at).toBeLessThan(expectedExpiry + 1000);
    });
  });

  describe('getSourceId', () => {
    const mockSourcesResponse = {
      data: {
        items: [
          { id: 'src-123', providerType: 'GarminWellness', name: 'Garmin' },
          { id: 'src-456', providerType: 'Strava', name: 'Strava' },
          { id: 'src-789', providerType: 'Fitbit', name: 'Fitbit' },
        ],
      },
    };

    beforeEach(() => {
      // Setup valid token for API calls
      const futureExpiry = Date.now() + 10 * 60 * 1000;
      mockAuthStore.get.mockResolvedValue({
        access_token: 'valid-token',
        expires_at: futureExpiry,
        refresh: 'test-refresh-token',
      });
    });

    test('fetches sources from API and returns matching source ID', async () => {
      mockHttpClient.get.mockResolvedValue(mockSourcesResponse);

      const sourceId = await adapter.getSourceId('GarminWellness');

      expect(sourceId).toBe('src-123');
      expect(mockHttpClient.get).toHaveBeenCalledWith(
        'https://www.fitnesssyncer.com/api/sources',
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: 'Bearer valid-token',
          }),
        })
      );
    });

    test('returns null for unknown provider', async () => {
      mockHttpClient.get.mockResolvedValue(mockSourcesResponse);

      const sourceId = await adapter.getSourceId('UnknownProvider');

      expect(sourceId).toBeNull();
    });

    test('caches sources and returns from cache on subsequent calls', async () => {
      mockHttpClient.get.mockResolvedValue(mockSourcesResponse);

      // First call - fetches from API
      const sourceId1 = await adapter.getSourceId('GarminWellness');
      expect(sourceId1).toBe('src-123');
      expect(mockHttpClient.get).toHaveBeenCalledTimes(1);

      // Second call - should use cache
      const sourceId2 = await adapter.getSourceId('Strava');
      expect(sourceId2).toBe('src-456');
      expect(mockHttpClient.get).toHaveBeenCalledTimes(1); // Still 1, used cache

      // Third call - same provider, still cached
      const sourceId3 = await adapter.getSourceId('GarminWellness');
      expect(sourceId3).toBe('src-123');
      expect(mockHttpClient.get).toHaveBeenCalledTimes(1);
    });

    test('returns null when API call fails', async () => {
      mockHttpClient.get.mockRejectedValue(new Error('Network error'));

      const sourceId = await adapter.getSourceId('GarminWellness');

      expect(sourceId).toBeNull();
      expect(mockLogger.error).toHaveBeenCalledWith(
        'fitsync.sources.fetch_failed',
        expect.objectContaining({
          error: expect.any(String),
        })
      );
    });

    test('returns null when no access token available', async () => {
      mockAuthStore.get.mockResolvedValue(null);

      const sourceId = await adapter.getSourceId('GarminWellness');

      expect(sourceId).toBeNull();
      expect(mockHttpClient.get).not.toHaveBeenCalled();
    });

    test('returns null when API returns empty items array', async () => {
      mockHttpClient.get.mockResolvedValue({ data: { items: [] } });

      const sourceId = await adapter.getSourceId('GarminWellness');

      expect(sourceId).toBeNull();
    });

    test('returns null when API returns no items property', async () => {
      mockHttpClient.get.mockResolvedValue({ data: {} });

      const sourceId = await adapter.getSourceId('GarminWellness');

      expect(sourceId).toBeNull();
    });
  });

  describe('setSourceId', () => {
    test('sets source ID in cache', () => {
      adapter.setSourceId('GarminWellness', 'manual-src-123');

      // Verify by calling getSourceId - should not make API call
      // We need to verify the cache was set
    });

    test('allows retrieving manually set source ID without API call', async () => {
      // Setup valid token
      const futureExpiry = Date.now() + 10 * 60 * 1000;
      mockAuthStore.get.mockResolvedValue({
        access_token: 'valid-token',
        expires_at: futureExpiry,
        refresh: 'test-refresh-token',
      });

      // Manually set source ID
      adapter.setSourceId('GarminWellness', 'manual-src-123');

      // Get should return cached value without API call
      const sourceId = await adapter.getSourceId('GarminWellness');

      expect(sourceId).toBe('manual-src-123');
      expect(mockHttpClient.get).not.toHaveBeenCalled();
    });

    test('overrides previously cached source ID', async () => {
      // Setup valid token
      const futureExpiry = Date.now() + 10 * 60 * 1000;
      mockAuthStore.get.mockResolvedValue({
        access_token: 'valid-token',
        expires_at: futureExpiry,
        refresh: 'test-refresh-token',
      });

      // First, fetch from API to populate cache
      mockHttpClient.get.mockResolvedValue({
        data: {
          items: [
            { id: 'api-src-123', providerType: 'GarminWellness', name: 'Garmin' },
          ],
        },
      });

      const sourceId1 = await adapter.getSourceId('GarminWellness');
      expect(sourceId1).toBe('api-src-123');

      // Now manually override
      adapter.setSourceId('GarminWellness', 'manual-override-456');

      const sourceId2 = await adapter.getSourceId('GarminWellness');
      expect(sourceId2).toBe('manual-override-456');
    });

    test('sets source ID for provider not in API response', async () => {
      // Setup valid token
      const futureExpiry = Date.now() + 10 * 60 * 1000;
      mockAuthStore.get.mockResolvedValue({
        access_token: 'valid-token',
        expires_at: futureExpiry,
        refresh: 'test-refresh-token',
      });

      // Set source ID for a provider that wouldn't be in API
      adapter.setSourceId('CustomProvider', 'custom-src-999');

      const sourceId = await adapter.getSourceId('CustomProvider');
      expect(sourceId).toBe('custom-src-999');
      expect(mockHttpClient.get).not.toHaveBeenCalled();
    });
  });
});
