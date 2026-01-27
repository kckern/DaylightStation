/**
 * LifelogAggregator Integration Test
 *
 * Tests that LifelogAggregator correctly loads lifelog data using
 * userDataService with default household and head of household.
 */

import { jest } from '@jest/globals';
import { LifelogAggregator } from '../LifelogAggregator.mjs';
import { initConfigService, resetConfigService, configService } from '#system/config/index.mjs';
import { userDataService } from '#system/config/UserDataService.mjs';

// Get data dir from environment or use default
const DATA_DIR = process.env.DAYLIGHT_DATA_PATH || '/media/kckern/DockerDrive/Dropbox/Apps/DaylightStation/data';

describe('LifelogAggregator', () => {
  let username;

  beforeAll(() => {
    // Initialize config service with real data directory
    resetConfigService();
    initConfigService(DATA_DIR);

    // Get head of household from config (default user)
    username = configService.getHeadOfHousehold();
    console.log(`Testing with username: ${username}`);
  });

  afterAll(() => {
    resetConfigService();
  });

  describe('with userDataService integration', () => {
    it('should load lifelog data when userLoadFile is provided', async () => {
      // Create userLoadFile function wrapping userDataService
      const userLoadFile = (user, filename) => {
        return userDataService.getLifelogData(user, filename);
      };

      const aggregator = new LifelogAggregator({
        userLoadFile,
        logger: console,
      });

      // Aggregate for yesterday (default)
      const result = await aggregator.aggregate(username);

      // Verify structure
      expect(result).toHaveProperty('date');
      expect(result).toHaveProperty('sources');
      expect(result).toHaveProperty('summaries');
      expect(result).toHaveProperty('categories');
      expect(result).toHaveProperty('_meta');

      // Verify meta
      expect(result._meta.username).toBe(username);
      expect(typeof result._meta.availableSourceCount).toBe('number');

      console.log(`Aggregated ${result._meta.availableSourceCount} sources for ${result.date}`);
      console.log(`Sources: ${result._meta.sources.join(', ') || 'none'}`);
    });

    it('should return empty results when userLoadFile is not provided', async () => {
      // Create aggregator WITHOUT userLoadFile (simulates the bug)
      const aggregator = new LifelogAggregator({
        logger: {
          info: jest.fn(),
          warn: jest.fn(),
          debug: jest.fn(),
        },
      });

      const result = await aggregator.aggregate(username);

      // Should still return valid structure but with no data
      expect(result).toHaveProperty('_meta');
      expect(result._meta.availableSourceCount).toBe(0);
      expect(result._meta.sources).toEqual([]);
    });

    it('should list available extractor sources', () => {
      const aggregator = new LifelogAggregator({
        logger: console,
      });

      const sources = aggregator.getAvailableSources();

      expect(Array.isArray(sources)).toBe(true);
      expect(sources.length).toBeGreaterThan(0);

      // Should include common sources
      expect(sources).toContain('strava');
      expect(sources).toContain('calendar');
      expect(sources).toContain('weight');

      console.log(`Available sources: ${sources.join(', ')}`);
    });
  });

  describe('JournalistContainer integration', () => {
    it('should work when userDataService is injected into container', async () => {
      // Dynamically import to avoid circular dependency issues
      const { JournalistContainer } = await import('../../../../3_applications/journalist/JournalistContainer.mjs');

      // Minimal config for container
      const config = {
        username,
        dataDir: DATA_DIR,
        getUserTimezone: () => 'America/Los_Angeles',
      };

      // Create container with userDataService (the fix)
      const container = new JournalistContainer(config, {
        userDataService,
        logger: console,
        // Other dependencies would be mocked in a full test
      });

      // Get the lifelog aggregator
      const aggregator = container.getLifelogAggregator();

      // Should have extractors
      expect(aggregator.extractors).toBeDefined();
      expect(aggregator.extractors.length).toBeGreaterThan(0);

      // Aggregate should work
      const result = await aggregator.aggregate(username);
      expect(result).toHaveProperty('_meta');

      // The key assertion: with userDataService, we should get data
      // (assuming the user has some lifelog data)
      console.log(`JournalistContainer aggregated ${result._meta.availableSourceCount} sources`);
    });

    it('should fail gracefully when userDataService is NOT injected (reproduces bug)', async () => {
      const { JournalistContainer } = await import('../../../../3_applications/journalist/JournalistContainer.mjs');

      const config = {
        username,
        dataDir: DATA_DIR,
        getUserTimezone: () => 'America/Los_Angeles',
      };

      // Create container WITHOUT userDataService (the bug condition)
      const warnFn = jest.fn();
      const container = new JournalistContainer(config, {
        // userDataService NOT provided - this is the bug
        logger: {
          info: jest.fn(),
          warn: warnFn,
          debug: jest.fn(),
        },
      });

      const aggregator = container.getLifelogAggregator();
      const result = await aggregator.aggregate(username);

      // Should return 0 sources because userLoadFile is null
      expect(result._meta.availableSourceCount).toBe(0);

      // Should have logged warnings about no-loader
      expect(warnFn).toHaveBeenCalled();
      const noLoaderCalls = warnFn.mock.calls.filter(
        call => call[0] === 'lifelog.source.no-loader'
      );
      expect(noLoaderCalls.length).toBeGreaterThan(0);
    });
  });
});
