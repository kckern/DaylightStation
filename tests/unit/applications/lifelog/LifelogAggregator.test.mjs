/**
 * LifelogAggregator Integration Test
 *
 * Tests that LifelogAggregator (now in application layer) correctly loads
 * lifelog data using userDataService with default household and head of household.
 */

import { jest } from '@jest/globals';
import { LifelogAggregator } from '#apps/lifelog/LifelogAggregator.mjs';
import { HarvestedLifelogSourceRegistry } from '#adapters/lifelog/HarvestedLifelogSourceRegistry.mjs';
import { initConfigService, resetConfigService, configService } from '#system/config/index.mjs';
import { userDataService } from '#adapters/persistence/files/UserDataService.mjs';
import { getDataPath } from '../../../_lib/configHelper.mjs';

// Get data dir from config helper (SSOT)
const DATA_DIR = getDataPath();

describe('LifelogAggregator', () => {
  let username;

  beforeAll(async () => {
    // Initialize config service with real data directory
    resetConfigService();
    await initConfigService(DATA_DIR);

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
        sourceRegistry: new HarvestedLifelogSourceRegistry({ userLoadFile }),
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
      const aggregator = new LifelogAggregator({
        sourceRegistry: { availableSources: () => [], readDay: async () => [],
          readRange: async (_user, dates) => ({ days: Object.fromEntries(dates.map(date => [date, []])), availableSources: [] }) },
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
        sourceRegistry: new HarvestedLifelogSourceRegistry({ userLoadFile: () => null }),
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
      const { JournalistContainer } = await import('#apps/journalist/JournalistContainer.mjs');

      // Minimal config for container
      const config = {
        username,
        dataDir: DATA_DIR,
        getUserTimezone: () => 'America/Los_Angeles',
      };

      // Create container with its application reader port.
      const container = new JournalistContainer(config, {
        lifelogAggregator: new LifelogAggregator({
          sourceRegistry: new HarvestedLifelogSourceRegistry({
            userLoadFile: (user, filename) => userDataService.getLifelogData(user, filename),
          }),
        }),
        logger: console,
        // Other dependencies would be mocked in a full test
      });

      // Get the lifelog aggregator
      const aggregator = container.getLifelogAggregator();

      expect(aggregator.getAvailableSources().length).toBeGreaterThan(0);

      // Aggregate should work
      const result = await aggregator.aggregate(username);
      expect(result).toHaveProperty('_meta');

      // The key assertion: with the reader port, we should get data
      // (assuming the user has some lifelog data)
      console.log(`JournalistContainer aggregated ${result._meta.availableSourceCount} sources`);
    });

    it('should reject a missing semantic lifelog aggregator', async () => {
      const { JournalistContainer } = await import('#apps/journalist/JournalistContainer.mjs');

      const config = {
        username,
        dataDir: DATA_DIR,
        getUserTimezone: () => 'America/Los_Angeles',
      };

      // Create container without the reader port.
      const warnFn = jest.fn();
      const container = new JournalistContainer(config, {
        // userLoadFile intentionally not provided.
        logger: {
          info: jest.fn(),
          warn: warnFn,
          debug: jest.fn(),
        },
      });

      expect(() => container.getLifelogAggregator()).toThrow('lifelogAggregator not configured');
    });
  });
});
