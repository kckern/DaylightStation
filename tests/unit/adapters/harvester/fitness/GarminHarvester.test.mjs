// tests/unit/adapters/harvester/fitness/GarminHarvester.test.mjs
import { describe, it, expect, beforeEach, jest } from '@jest/globals';

describe('GarminHarvester', () => {
  let harvester;
  let mockGarminClient;
  let mockGarminClientFactory;
  let mockLifelogStore;
  let mockConfigService;
  let mockLogger;

  beforeEach(() => {
    mockGarminClient = {
      login: jest.fn().mockResolvedValue(undefined),
      getActivities: jest.fn(),
      getActivity: jest.fn(),
      downloadOriginalActivityData: jest.fn(),
      getSteps: jest.fn(),
      getHeartRate: jest.fn()
    };

    mockGarminClientFactory = jest.fn().mockReturnValue(mockGarminClient);

    mockLifelogStore = {
      load: jest.fn().mockResolvedValue({}),
      save: jest.fn().mockResolvedValue(undefined)
    };

    mockConfigService = {
      getUserAuth: jest.fn().mockReturnValue({ token: 'test-token' })
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
      const { GarminHarvester } = await import(
        '../../../../../backend/src/2_adapters/harvester/fitness/GarminHarvester.mjs'
      );

      harvester = new GarminHarvester({
        garminClientFactory: mockGarminClientFactory,
        lifelogStore: mockLifelogStore,
        configService: mockConfigService,
        logger: mockLogger
      });

      expect(harvester).toBeInstanceOf(GarminHarvester);
    });

    it('should throw if garminClientFactory not provided', async () => {
      const { GarminHarvester } = await import(
        '../../../../../backend/src/2_adapters/harvester/fitness/GarminHarvester.mjs'
      );

      expect(() => new GarminHarvester({
        lifelogStore: mockLifelogStore
      })).toThrow('GarminHarvester requires garminClientFactory');
    });

    it('should throw if lifelogStore not provided', async () => {
      const { GarminHarvester } = await import(
        '../../../../../backend/src/2_adapters/harvester/fitness/GarminHarvester.mjs'
      );

      expect(() => new GarminHarvester({
        garminClientFactory: mockGarminClientFactory
      })).toThrow('GarminHarvester requires lifelogStore');
    });
  });

  describe('serviceId', () => {
    it('should return garmin', async () => {
      const { GarminHarvester } = await import(
        '../../../../../backend/src/2_adapters/harvester/fitness/GarminHarvester.mjs'
      );

      harvester = new GarminHarvester({
        garminClientFactory: mockGarminClientFactory,
        lifelogStore: mockLifelogStore,
        logger: mockLogger
      });

      expect(harvester.serviceId).toBe('garmin');
    });
  });

  describe('getActivityDetails', () => {
    it('should get activity details by ID', async () => {
      const { GarminHarvester } = await import(
        '../../../../../backend/src/2_adapters/harvester/fitness/GarminHarvester.mjs'
      );

      mockGarminClient.getActivity.mockResolvedValue({
        activityId: 12345,
        activityName: 'Morning Run',
        distance: 5000,
        duration: 1800
      });

      harvester = new GarminHarvester({
        garminClientFactory: mockGarminClientFactory,
        lifelogStore: mockLifelogStore,
        logger: mockLogger
      });

      const result = await harvester.getActivityDetails('testuser', 12345);

      expect(mockGarminClient.login).toHaveBeenCalled();
      expect(mockGarminClient.getActivity).toHaveBeenCalledWith({ activityId: 12345 });
      expect(result.activityId).toBe(12345);
    });

    it('should respect circuit breaker when in cooldown', async () => {
      const { GarminHarvester } = await import(
        '../../../../../backend/src/2_adapters/harvester/fitness/GarminHarvester.mjs'
      );

      // Force circuit breaker open by simulating failures
      mockGarminClient.getActivity.mockRejectedValue(new Error('API error'));

      harvester = new GarminHarvester({
        garminClientFactory: mockGarminClientFactory,
        lifelogStore: mockLifelogStore,
        logger: mockLogger
      });

      // Trigger enough failures to open circuit breaker
      for (let i = 0; i < 3; i++) {
        try {
          await harvester.getActivityDetails('testuser', 12345);
        } catch {}
      }

      // Now circuit breaker should be open
      const result = await harvester.getActivityDetails('testuser', 12345);
      expect(result.status).toBe('skipped');
      expect(result.reason).toBe('cooldown');
    });
  });

  describe('getSteps', () => {
    it('should get steps for a date', async () => {
      const { GarminHarvester } = await import(
        '../../../../../backend/src/2_adapters/harvester/fitness/GarminHarvester.mjs'
      );

      mockGarminClient.getSteps.mockResolvedValue({
        totalSteps: 8500,
        goalSteps: 10000,
        date: '2026-01-13'
      });

      harvester = new GarminHarvester({
        garminClientFactory: mockGarminClientFactory,
        lifelogStore: mockLifelogStore,
        logger: mockLogger
      });

      const result = await harvester.getSteps('testuser', new Date('2026-01-13'));

      expect(mockGarminClient.login).toHaveBeenCalled();
      expect(mockGarminClient.getSteps).toHaveBeenCalled();
      expect(result.totalSteps).toBe(8500);
    });

    it('should use current date if none provided', async () => {
      const { GarminHarvester } = await import(
        '../../../../../backend/src/2_adapters/harvester/fitness/GarminHarvester.mjs'
      );

      mockGarminClient.getSteps.mockResolvedValue({ totalSteps: 1000 });

      harvester = new GarminHarvester({
        garminClientFactory: mockGarminClientFactory,
        lifelogStore: mockLifelogStore,
        logger: mockLogger
      });

      await harvester.getSteps('testuser');

      expect(mockGarminClient.getSteps).toHaveBeenCalled();
    });
  });

  describe('getHeartRate', () => {
    it('should get heart rate data for a date', async () => {
      const { GarminHarvester } = await import(
        '../../../../../backend/src/2_adapters/harvester/fitness/GarminHarvester.mjs'
      );

      mockGarminClient.getHeartRate.mockResolvedValue({
        restingHeartRate: 58,
        maxHeartRate: 165,
        averageHeartRate: 72
      });

      harvester = new GarminHarvester({
        garminClientFactory: mockGarminClientFactory,
        lifelogStore: mockLifelogStore,
        logger: mockLogger
      });

      const result = await harvester.getHeartRate('testuser', new Date('2026-01-13'));

      expect(mockGarminClient.login).toHaveBeenCalled();
      expect(mockGarminClient.getHeartRate).toHaveBeenCalled();
      expect(result.restingHeartRate).toBe(58);
    });
  });

  describe('downloadActivityData', () => {
    it('should download activity data to directory', async () => {
      const { GarminHarvester } = await import(
        '../../../../../backend/src/2_adapters/harvester/fitness/GarminHarvester.mjs'
      );

      const mockActivity = { activityId: 12345, activityName: 'Run' };
      mockGarminClient.getActivity.mockResolvedValue(mockActivity);
      mockGarminClient.downloadOriginalActivityData.mockResolvedValue('/path/to/file.fit');

      harvester = new GarminHarvester({
        garminClientFactory: mockGarminClientFactory,
        lifelogStore: mockLifelogStore,
        logger: mockLogger
      });

      await harvester.downloadActivityData('testuser', 12345, '/output/dir');

      expect(mockGarminClient.getActivity).toHaveBeenCalledWith({ activityId: 12345 });
      expect(mockGarminClient.downloadOriginalActivityData).toHaveBeenCalledWith(
        mockActivity,
        '/output/dir'
      );
    });

    it('should use default directory if none provided', async () => {
      const { GarminHarvester } = await import(
        '../../../../../backend/src/2_adapters/harvester/fitness/GarminHarvester.mjs'
      );

      const mockActivity = { activityId: 12345 };
      mockGarminClient.getActivity.mockResolvedValue(mockActivity);
      mockGarminClient.downloadOriginalActivityData.mockResolvedValue(undefined);

      harvester = new GarminHarvester({
        garminClientFactory: mockGarminClientFactory,
        lifelogStore: mockLifelogStore,
        logger: mockLogger
      });

      await harvester.downloadActivityData('testuser', 12345);

      expect(mockGarminClient.downloadOriginalActivityData).toHaveBeenCalledWith(
        mockActivity,
        './'
      );
    });
  });

  describe('harvest', () => {
    it('should harvest activities and save to lifelog', async () => {
      const { GarminHarvester } = await import(
        '../../../../../backend/src/2_adapters/harvester/fitness/GarminHarvester.mjs'
      );

      mockGarminClient.getActivities.mockResolvedValue([
        {
          activityId: 1,
          activityName: 'Run',
          startTimeLocal: '2026-01-13T08:00:00',
          distance: 5000,
          duration: 1800
        }
      ]);

      harvester = new GarminHarvester({
        garminClientFactory: mockGarminClientFactory,
        lifelogStore: mockLifelogStore,
        logger: mockLogger
      });

      const result = await harvester.harvest('testuser');

      expect(result.status).toBe('success');
      expect(result.count).toBe(1);
      expect(mockLifelogStore.save).toHaveBeenCalled();
    });

    it('should return empty result when no activities', async () => {
      const { GarminHarvester } = await import(
        '../../../../../backend/src/2_adapters/harvester/fitness/GarminHarvester.mjs'
      );

      mockGarminClient.getActivities.mockResolvedValue([]);

      harvester = new GarminHarvester({
        garminClientFactory: mockGarminClientFactory,
        lifelogStore: mockLifelogStore,
        logger: mockLogger
      });

      const result = await harvester.harvest('testuser');

      expect(result.status).toBe('success');
      expect(result.count).toBe(0);
    });
  });

  describe('getStatus', () => {
    it('should return circuit breaker status', async () => {
      const { GarminHarvester } = await import(
        '../../../../../backend/src/2_adapters/harvester/fitness/GarminHarvester.mjs'
      );

      harvester = new GarminHarvester({
        garminClientFactory: mockGarminClientFactory,
        lifelogStore: mockLifelogStore,
        logger: mockLogger
      });

      const status = harvester.getStatus();

      expect(status).toHaveProperty('state');
      expect(status.state).toBe('closed');
    });
  });
});
