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
      authPublicContext: { get: jest.fn() },
      logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() }
    });

    expect(router).toBeDefined();
    expect(typeof router.get).toBe('function');
    expect(typeof router.post).toBe('function');
  });
});

describe('POST /auth/token with a session store', () => {
  it('returns the session token (carrying the sid) in the body, not a bare token', async () => {
    const express = (await import('express')).default;
    const request = (await import('supertest')).default;
    const jwt = (await import('jsonwebtoken')).default;
    const user = { username: 'kckern', householdId: 'default', roles: [] };
    const router = createAuthRouter({
      authService: { needsSetup: jest.fn(), login: jest.fn(async () => user), getAuthConfig: jest.fn() },
      jwtSecret: 'test-secret',
      jwtConfig: { issuer: 'daylight-station', expiry: '10y', algorithm: 'HS256' },
      authPublicContext: { get: jest.fn() },
      sessionStore: { create: jest.fn(() => ({ id: 'sid-1' })), revoke: jest.fn(), list: jest.fn(() => []) },
      logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() },
    });
    const app = express().use(express.json()).use('/auth', router);
    const res = await request(app).post('/auth/token').send({ username: 'kckern', password: 'pw' });
    expect(res.status).toBe(200);
    // The browser stores this and sends it as a Bearer header, which wins over the cookie.
    expect(jwt.decode(res.body.token).sid).toBe('sid-1');
    expect(res.headers['set-cookie'][0]).toContain(encodeURIComponent(res.body.token));
  });
});
