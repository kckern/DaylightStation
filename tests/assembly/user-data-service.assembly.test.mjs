// tests/assembly/user-data-service.assembly.test.mjs
import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

describe('UserDataService assembly', () => {
  let userDataService;
  let configService;
  const testDataPath = path.join(__dirname, '../_fixtures/data');

  beforeAll(async () => {
    // Set test data path before importing
    process.env = {
      ...process.env,
      path: {
        ...(process.env.path || {}),
        data: testDataPath
      }
    };

    const configMod = await import('../../backend/lib/config/ConfigService.mjs');
    configService = configMod.configService;
    configService.init({ dataDir: testDataPath });

    const userDataMod = await import('../../backend/lib/config/UserDataService.mjs');
    userDataService = userDataMod.userDataService;
  });

  describe('household data operations', () => {
    it('reads household app data', () => {
      const config = userDataService.readHouseholdAppData('_test', 'fitness', 'config');
      expect(config).toBeDefined();
      expect(config.devices).toBeDefined();
      expect(config.users).toBeDefined();
    });

    it('returns null for non-existent household', () => {
      const result = userDataService.readHouseholdAppData('nonexistent', 'fitness', 'config');
      expect(result).toBeNull();
    });
  });

  describe('user data operations', () => {
    it('reads user lifelog data', () => {
      const data = userDataService.getLifelogData('_alice', 'fitness');
      expect(data).toBeDefined();
      expect(data.sessions).toBeDefined();
      expect(Array.isArray(data.sessions)).toBe(true);
    });

    it('returns null for non-existent user data', () => {
      const result = userDataService.getLifelogData('_alice', 'nonexistent');
      expect(result).toBeNull();
    });
  });

  describe('write operations', () => {
    const tmpHouseholdId = `_test_write_${Date.now()}`;
    const tmpHouseholdDir = path.join(testDataPath, 'households', tmpHouseholdId);

    afterAll(() => {
      // Cleanup
      if (fs.existsSync(tmpHouseholdDir)) {
        fs.rmSync(tmpHouseholdDir, { recursive: true });
      }
    });

    it('writes household shared data', () => {
      // Create household directory first
      userDataService.createHouseholdDirectory(tmpHouseholdId);

      const testData = { test: 'value', number: 42 };
      const result = userDataService.writeHouseholdSharedData(tmpHouseholdId, 'test-data', testData);
      expect(result).toBe(true);

      // Read it back
      const readBack = userDataService.readHouseholdSharedData(tmpHouseholdId, 'test-data');
      expect(readBack).toEqual(testData);
    });
  });
});
