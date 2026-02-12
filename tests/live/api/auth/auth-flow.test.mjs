// tests/live/api/auth/auth-flow.test.mjs
/**
 * Auth Flow Integration Tests
 *
 * Exercises the auth API endpoints against a running server:
 * - GET /api/v1/auth/setup-status
 * - GET /api/v1/auth/context
 * - POST /api/v1/auth/token (invalid credentials)
 */

import { getAppPort } from '../../../_lib/configHelper.mjs';

const APP_PORT = getAppPort();
const BASE_URL = `http://localhost:${APP_PORT}`;

describe('Auth flow', () => {
  test('GET /api/v1/auth/setup-status returns needsSetup', async () => {
    const res = await fetch(`${BASE_URL}/api/v1/auth/setup-status`);
    expect(res.ok).toBe(true);

    const body = await res.json();
    expect(body).toHaveProperty('needsSetup');
    expect(typeof body.needsSetup).toBe('boolean');
  });

  test('GET /api/v1/auth/context returns household info', async () => {
    const res = await fetch(`${BASE_URL}/api/v1/auth/context`);
    expect(res.ok).toBe(true);

    const body = await res.json();
    expect(body).toHaveProperty('householdId');
    expect(body).toHaveProperty('authMethod');
  });

  test('POST /api/v1/auth/token with invalid credentials returns 401', async () => {
    const res = await fetch(`${BASE_URL}/api/v1/auth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'nonexistent', password: 'wrong' }),
    });

    expect(res.status).toBe(401);
  });
});
