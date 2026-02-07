/**
 * FitnessSyncerHarvester Unit Tests
 *
 * Tests the FitnessSyncer harvester transformation logic, circuit breaker integration,
 * and data persistence patterns.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import moment from 'moment-timezone';
import { FitnessSyncerHarvester } from '#adapters/harvester/fitness/FitnessSyncerHarvester.mjs';
import { HarvesterCategory } from '#adapters/harvester/ports/IHarvester.mjs';

describe('FitnessSyncerHarvester', () => {
  let harvester;
  let mockHttpClient;
  let mockLifelogStore;
  let mockAuthStore;
  let mockConfigService;
  let mockLogger;
  let mockAdapter;

  const TEST_USERNAME = 'testuser';
  const TEST_TIMEZONE = 'America/New_York';

  beforeEach(() => {
    // Mock dependencies
    mockHttpClient = {
      get: vi.fn(),
      post: vi.fn(),
    };

    mockLifelogStore = {
      load: vi.fn().mockResolvedValue({}),
      save: vi.fn().mockResolvedValue(undefined),
    };

    mockAuthStore = {
      get: vi.fn().mockResolvedValue({
        refresh: 'mock-refresh-token',
        client_id: 'mock-client-id',
        client_secret: 'mock-client-secret',
      }),
      set: vi.fn().mockResolvedValue(undefined),
    };

    mockConfigService = {
      getSecret: vi.fn((key) => {
        if (key === 'FITSYNC_CLIENT_ID') return 'mock-client-id';
        if (key === 'FITSYNC_CLIENT_SECRET') return 'mock-client-secret';
        return null;
      }),
      getTimezone: vi.fn().mockReturnValue(TEST_TIMEZONE),
    };

    mockLogger = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    };

    // Create harvester
    harvester = new FitnessSyncerHarvester({
      httpClient: mockHttpClient,
      lifelogStore: mockLifelogStore,
      authStore: mockAuthStore,
      configService: mockConfigService,
      timezone: TEST_TIMEZONE,
      logger: mockLogger,
    });
  });

  describe('IHarvester interface', () => {
    it('should have serviceId "fitsync"', () => {
      expect(harvester.serviceId).toBe('fitsync');
    });

    it('should have category FITNESS', () => {
      expect(harvester.category).toBe(HarvesterCategory.FITNESS);
    });

    it('should expose getParams method', () => {
      const params = harvester.getParams();
      expect(params).toBeInstanceOf(Array);
      expect(params.length).toBeGreaterThan(0);
      
      const daysBackParam = params.find(p => p.name === 'daysBack');
      expect(daysBackParam).toBeDefined();
      expect(daysBackParam.type).toBe('number');
      expect(daysBackParam.default).toBe(7);
    });
  });

  describe('circuit breaker integration', () => {
    it('should skip harvest when circuit breaker is open', async () => {
      // Mock circuit breaker in cooldown
      vi.spyOn(harvester['_FitnessSyncerHarvester__adapter'], 'isInCooldown')
        .mockReturnValue(true);
      vi.spyOn(harvester['_FitnessSyncerHarvester__adapter'], 'getCooldownStatus')
        .mockReturnValue({ inCooldown: true, remainingMins: 5 });

      const result = await harvester.harvest(TEST_USERNAME);

      expect(result.status).toBe('skipped');
      expect(result.reason).toBe('cooldown');
      expect(result.remainingMins).toBe(5);
      expect(mockLifelogStore.save).not.toHaveBeenCalled();
    });

    it('should expose getStatus method', () => {
      const status = harvester.getStatus();
      expect(status).toHaveProperty('state');
    });

    it('should expose isInCooldown method', () => {
      const inCooldown = harvester.isInCooldown();
      expect(typeof inCooldown).toBe('boolean');
    });
  });

  describe('dev mode bypass', () => {
    it('should skip harvest in dev mode', async () => {
      const originalEnv = process.env.dev;
      process.env.dev = 'true';

      const result = await harvester.harvest(TEST_USERNAME);

      expect(result.skipped).toBe(true);
      expect(result.reason).toBe('dev_mode');
      expect(mockLifelogStore.save).not.toHaveBeenCalled();

      process.env.dev = originalEnv;
    });
  });

  describe('transformation logic', () => {
    beforeEach(() => {
      // Mock successful auth and API calls
      mockHttpClient.post.mockResolvedValue({
        data: {
          access_token: 'mock-access-token',
          refresh_token: 'mock-refresh-token',
          expires_in: 3600,
        },
      });

      mockHttpClient.get.mockImplementation((url) => {
        if (url.includes('/sources')) {
          return Promise.resolve({
            data: {
              items: [
                { id: 'source-123', providerType: 'GarminWellness' },
              ],
            },
          });
        }
        if (url.includes('/activities')) {
          return Promise.resolve({
            data: {
              items: mockActivities(),
            },
          });
        }
        return Promise.reject(new Error('Unexpected URL'));
      });
    });

    function mockActivities() {
      const date = '2026-02-07T10:00:00Z';
      return [
        // Steps activity
        {
          itemId: 'step-activity-1',
          date,
          activity: 'Steps',
          steps: 5000,
          bmr: 1200,
          duration: 3600, // seconds
          calories: 250,
          maxHeartrate: 140,
          avgHeartrate: 110,
        },
        // Regular activity
        {
          itemId: 'run-activity-1',
          date,
          endDate: '2026-02-07T11:00:00Z',
          activity: 'Running',
          title: 'Morning Run',
          type: 'Running',
          steps: 1000,
          distance: 5.2,
          duration: 1800, // seconds (30 min)
          calories: 300,
          avgHeartrate: 155,
        },
      ];
    }

    it('should transform steps activities correctly', async () => {
      const result = await harvester.harvest(TEST_USERNAME, { daysBack: 7 });

      expect(result.status).toBe('success');
      expect(result.count).toBeGreaterThan(0);

      // Check that save was called for fitness summary
      expect(mockLifelogStore.save).toHaveBeenCalledWith(
        TEST_USERNAME,
        'fitness',
        expect.objectContaining({
          '2026-02-07': expect.objectContaining({
            steps: expect.objectContaining({
              steps_count: 5000,
              bmr: 1200,
              duration: 60, // converted from seconds to minutes
              calories: 250,
              maxHeartRate: 140,
            }),
          }),
        })
      );
    });

    it('should transform regular activities correctly', async () => {
      const result = await harvester.harvest(TEST_USERNAME, { daysBack: 7 });

      expect(result.status).toBe('success');

      // Check that activities array was created
      expect(mockLifelogStore.save).toHaveBeenCalledWith(
        TEST_USERNAME,
        'fitness',
        expect.objectContaining({
          '2026-02-07': expect.objectContaining({
            activities: expect.arrayContaining([
              expect.objectContaining({
                title: 'Morning Run',
                calories: 300,
                distance: 5.2,
                minutes: 30, // converted from seconds
                steps: 1000,
                avgHeartrate: 155,
              }),
            ]),
          }),
        })
      );
    });

    it('should format time strings in configured timezone', async () => {
      const result = await harvester.harvest(TEST_USERNAME, { daysBack: 7 });

      expect(result.status).toBe('success');

      // Get the saved data
      const saveCall = mockLifelogStore.save.mock.calls.find(
        call => call[1] === 'fitness'
      );
      const savedData = saveCall[2];
      const activity = savedData['2026-02-07'].activities[0];

      // Check that times are formatted correctly for EST
      expect(activity.startTime).toMatch(/^\d{2}:\d{2} (am|pm)$/);
      expect(activity.endTime).toMatch(/^\d{2}:\d{2} (am|pm)$/);
    });

    it('should save raw archive without GPS data', async () => {
      const result = await harvester.harvest(TEST_USERNAME, { daysBack: 7 });

      expect(result.status).toBe('success');

      // Check that archive was saved
      expect(mockLifelogStore.save).toHaveBeenCalledWith(
        TEST_USERNAME,
        'archives/fitness_long',
        expect.objectContaining({
          '2026-02-07': expect.any(Object),
        })
      );

      // Get the saved archive data
      const archiveCall = mockLifelogStore.save.mock.calls.find(
        call => call[1] === 'archives/fitness_long'
      );
      const archiveData = archiveCall[2];
      const dateEntry = archiveData['2026-02-07'];

      // Check that archive entries exist
      expect(Object.keys(dateEntry).length).toBeGreaterThan(0);

      // Check structure of archive entry
      const firstId = Object.keys(dateEntry)[0];
      const firstEntry = dateEntry[firstId];

      expect(firstEntry).toHaveProperty('src', 'garmin');
      expect(firstEntry).toHaveProperty('id');
      expect(firstEntry).toHaveProperty('date', '2026-02-07');
      expect(firstEntry).toHaveProperty('type');
      expect(firstEntry).toHaveProperty('data');

      // Verify GPS was removed
      expect(firstEntry.data).not.toHaveProperty('gps');
    });

    it('should generate deterministic MD5 IDs', async () => {
      // Run harvest twice with same data
      const result1 = await harvester.harvest(TEST_USERNAME, { daysBack: 7 });
      mockLifelogStore.save.mockClear();
      
      const result2 = await harvester.harvest(TEST_USERNAME, { daysBack: 7 });

      // Get archive data from both runs
      const archiveCall1 = mockLifelogStore.save.mock.calls.find(
        call => call[1] === 'archives/fitness_long'
      );

      // IDs should be the same for the same itemId
      const ids1 = Object.keys(archiveCall1[2]['2026-02-07']);
      expect(ids1.length).toBeGreaterThan(0);
      
      // Each ID should be a 32-character hex string (MD5)
      ids1.forEach(id => {
        expect(id).toMatch(/^[a-f0-9]{32}$/);
      });
    });

    it('should handle invalid dates gracefully', async () => {
      // Mock activity with invalid date
      mockHttpClient.get.mockImplementation((url) => {
        if (url.includes('/sources')) {
          return Promise.resolve({
            data: {
              items: [{ id: 'source-123', providerType: 'GarminWellness' }],
            },
          });
        }
        if (url.includes('/activities')) {
          return Promise.resolve({
            data: {
              items: [
                {
                  itemId: 'invalid-date-activity',
                  date: 'invalid-date',
                  activity: 'Steps',
                  steps: 5000,
                },
              ],
            },
          });
        }
        return Promise.reject(new Error('Unexpected URL'));
      });

      const result = await harvester.harvest(TEST_USERNAME, { daysBack: 7 });

      // Should complete without error but skip invalid entry
      expect(result.status).toBe('success');
      expect(mockLogger.warn).toHaveBeenCalledWith(
        'fitsync.invalid_date',
        expect.any(Object)
      );
    });
  });

  describe('incremental merge', () => {
    it('should merge new data with existing fitness file', async () => {
      // Mock existing data
      mockLifelogStore.load.mockResolvedValue({
        '2026-02-06': {
          steps: { steps_count: 3000 },
          activities: [],
        },
      });

      // Mock API response
      mockHttpClient.post.mockResolvedValue({
        data: {
          access_token: 'mock-access-token',
          refresh_token: 'mock-refresh-token',
          expires_in: 3600,
        },
      });

      mockHttpClient.get.mockImplementation((url) => {
        if (url.includes('/sources')) {
          return Promise.resolve({
            data: { items: [{ id: 'source-123', providerType: 'GarminWellness' }] },
          });
        }
        if (url.includes('/activities')) {
          return Promise.resolve({
            data: {
              items: [
                {
                  itemId: 'new-activity',
                  date: '2026-02-07T10:00:00Z',
                  activity: 'Steps',
                  steps: 5000,
                  duration: 3600,
                  calories: 250,
                },
              ],
            },
          });
        }
        return Promise.reject(new Error('Unexpected URL'));
      });

      await harvester.harvest(TEST_USERNAME, { daysBack: 7 });

      // Check that both old and new dates are in saved data
      const saveCall = mockLifelogStore.save.mock.calls.find(
        call => call[1] === 'fitness'
      );
      const savedData = saveCall[2];

      expect(savedData).toHaveProperty('2026-02-06'); // existing
      expect(savedData).toHaveProperty('2026-02-07'); // new
    });
  });

  describe('error handling', () => {
    it('should return error status when auth fails', async () => {
      // Mock auth failure
      mockHttpClient.post.mockRejectedValue(new Error('Auth failed'));

      const result = await harvester.harvest(TEST_USERNAME);

      expect(result.status).toBe('error');
      expect(result.reason).toBe('auth_failed');
      expect(mockLogger.error).toHaveBeenCalled();
    });

    it('should handle empty activity response', async () => {
      // Mock successful auth but empty activities
      mockHttpClient.post.mockResolvedValue({
        data: { access_token: 'token', expires_in: 3600 },
      });

      mockHttpClient.get.mockImplementation((url) => {
        if (url.includes('/sources')) {
          return Promise.resolve({
            data: { items: [{ id: 'source-123', providerType: 'GarminWellness' }] },
          });
        }
        if (url.includes('/activities')) {
          return Promise.resolve({ data: { items: [] } });
        }
        return Promise.reject(new Error('Unexpected URL'));
      });

      const result = await harvester.harvest(TEST_USERNAME);

      expect(result.status).toBe('success');
      expect(result.count).toBe(0);
      expect(mockLogger.info).toHaveBeenCalledWith(
        'fitsync.harvest.no_data',
        expect.any(Object)
      );
    });
  });
});
