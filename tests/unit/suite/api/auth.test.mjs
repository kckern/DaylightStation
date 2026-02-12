// tests/unit/suite/api/auth.test.mjs
import { describe, it, expect, jest } from '@jest/globals';
import { createAuthRouter } from '#api/v1/routers/auth.mjs';

describe('Auth Router', () => {
  it('creates a router with required dependencies', () => {
    const mockAuthService = {
      needsSetup: jest.fn(),
      setup: jest.fn(),
      login: jest.fn(),
      generateInvite: jest.fn(),
      resolveInviteToken: jest.fn(),
      acceptInvite: jest.fn(),
      getAuthConfig: jest.fn()
    };

    const router = createAuthRouter({
      authService: mockAuthService,
      jwtSecret: 'test-secret',
      jwtConfig: { issuer: 'daylight-station', expiry: '10y', algorithm: 'HS256' },
      configService: { getDefaultHouseholdId: jest.fn() },
      dataService: { household: { read: jest.fn() } },
      logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() }
    });

    expect(router).toBeDefined();
    expect(typeof router.get).toBe('function');
    expect(typeof router.post).toBe('function');
  });
});
