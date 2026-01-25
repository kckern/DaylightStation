import { describe, it, expect } from '@jest/globals';
import path from 'path';
import { loadConfig } from '#backend/src/0_infrastructure/config/configLoader.mjs';

// Use Jest's rootDir-relative path for fixtures
const fixturesPath = path.resolve(process.cwd(), 'tests/_fixtures/data');

describe('configLoader', () => {
  describe('loadConfig', () => {
    it('loads household apps from households/{hid}/apps/', () => {
      const config = loadConfig(fixturesPath);

      expect(config.households.test.apps).toBeDefined();
      expect(config.households.test.apps.chatbots).toBeDefined();
      expect(config.households.test.apps.chatbots.identity_mappings).toBeDefined();
      expect(config.households.test.apps.chatbots.identity_mappings.telegram['111111111']).toBe('_alice');
    });

    it('loads nested app configs from subdirectories', () => {
      const config = loadConfig(fixturesPath);

      // fitness/config.yml should be loaded as apps.fitness
      expect(config.households.test.apps.fitness).toBeDefined();
      expect(config.households.test.apps.fitness.devices).toBeDefined();
      expect(config.households.test.apps.fitness.devices.heart_rate['12345']).toBe('_alice');
    });
  });
});
