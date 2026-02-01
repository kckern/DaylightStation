// tests/unit/suite/api/admin/content.test.mjs
import { describe, it, expect, jest } from '@jest/globals';
import { createAdminContentRouter } from '#api/v1/routers/admin/content.mjs';

describe('Admin Content Router', () => {
  it('should create a router with required dependencies', () => {
    const mockConfig = {
      userDataService: { getHouseholdPath: jest.fn(() => '/data/household') },
      configService: { getDefaultHouseholdId: jest.fn(() => 'default') },
      logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn() }
    };

    const router = createAdminContentRouter(mockConfig);
    expect(router).toBeDefined();
    expect(typeof router.get).toBe('function');
    expect(typeof router.post).toBe('function');
    expect(typeof router.put).toBe('function');
    expect(typeof router.delete).toBe('function');
  });

  it('should create a router with default logger if not provided', () => {
    const mockConfig = {
      userDataService: { getHouseholdPath: jest.fn(() => '/data/household') },
      configService: { getDefaultHouseholdId: jest.fn(() => 'default') }
    };

    const router = createAdminContentRouter(mockConfig);
    expect(router).toBeDefined();
  });
});
