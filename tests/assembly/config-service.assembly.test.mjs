// tests/assembly/config-service.assembly.test.mjs
import { describe, it, expect, beforeAll } from '@jest/globals';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

describe('ConfigService assembly', () => {
  let configService;

  beforeAll(async () => {
    // Set test data path before importing
    const testDataPath = path.join(__dirname, '../_fixtures/data');
    process.env = {
      ...process.env,
      path: {
        ...(process.env.path || {}),
        data: testDataPath
      }
    };

    const mod = await import('../../backend/lib/config/ConfigService.mjs');
    configService = mod.configService;
    configService.init({ dataDir: testDataPath });
  });

  it('loads _test household config', () => {
    const config = configService.getHouseholdConfig('_test');
    expect(config).toBeDefined();
    expect(config.id).toBe('_test');
    expect(config.head).toBe('_alice');
  });

  it('loads _alice user profile', () => {
    const profile = configService.getUserProfile('_alice');
    expect(profile).toBeDefined();
    expect(profile.id).toBe('_alice');
  });

  it('returns null for non-existent household', () => {
    const config = configService.getHouseholdConfig('nonexistent');
    expect(config).toBeNull();
  });
});
