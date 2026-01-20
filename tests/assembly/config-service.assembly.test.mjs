// tests/assembly/config-service.assembly.test.mjs
import { describe, it, expect, beforeAll } from '@jest/globals';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

describe('ConfigService assembly', () => {
  let configService;

  beforeAll(async () => {
    // Set test data path before importing - use unit test fixtures which have system config
    const testDataPath = path.join(__dirname, '../unit/config/fixtures');
    process.env = {
      ...process.env,
      path: {
        ...(process.env.path || {}),
        data: testDataPath
      }
    };

    const { createConfigService } = await import('../../backend/_legacy/lib/config/index.mjs');
    configService = createConfigService(testDataPath);
  });

  it('returns default household id', () => {
    const hid = configService.getDefaultHouseholdId();
    expect(hid).toBe('test-household');
  });

  it('returns head of household', () => {
    const head = configService.getHeadOfHousehold('test-household');
    expect(head).toBe('testuser');
  });

  it('loads testuser user profile', () => {
    const profile = configService.getUserProfile('testuser');
    expect(profile).toBeDefined();
    expect(profile.name).toBe('Test User');
  });

  it('returns null for non-existent user', () => {
    const profile = configService.getUserProfile('nonexistent');
    expect(profile).toBeNull();
  });
});
