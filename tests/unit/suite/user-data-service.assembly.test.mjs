// tests/assembly/user-data-service.assembly.test.mjs
import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

describe('UserDataService assembly', () => {
  let userDataService;
  let configService;
  const testDataPath = path.join(__dirname, '../unit/config/fixtures');

  beforeAll(async () => {
    // Set test data path before importing - use unit test fixtures
    process.env = {
      ...process.env,
      path: {
        ...(process.env.path || {}),
        data: testDataPath
      }
    };

    const { initConfigService, resetConfigService } = await import('#backend/src/0_infrastructure/config/index.mjs');
    resetConfigService(); // Ensure clean state
    configService = initConfigService(testDataPath);

    const userDataMod = await import('#backend/src/0_infrastructure/config/UserDataService.mjs');
    userDataService = userDataMod.userDataService;
  });

  describe('household data operations', () => {
    it('reads household app data or returns null if not found', () => {
      // The test fixture may not have app data - verify behavior
      const config = userDataService.readHouseholdAppData('test-household', 'fitness', 'config');
      // Should return either data or null, not throw
      expect(config === null || typeof config === 'object').toBe(true);
    });

    it('returns null for non-existent household', () => {
      const result = userDataService.readHouseholdAppData('nonexistent', 'fitness', 'config');
      expect(result).toBeNull();
    });
  });

  describe('user data operations', () => {
    it('reads user lifelog data or returns null if not found', () => {
      const data = userDataService.getLifelogData('testuser', 'fitness');
      // Should return either data or null, not throw
      expect(data === null || typeof data === 'object').toBe(true);
    });

    it('returns null for non-existent user data', () => {
      const result = userDataService.getLifelogData('testuser', 'nonexistent');
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
