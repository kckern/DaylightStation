// tests/live/api/home-dashboard.state.test.mjs
/**
 * Live API integration test: GET /api/v1/home-dashboard/state
 *
 * Verifies the composed state endpoint returns the expected shape:
 * an object with a `rooms` array. Actual entity values may be empty or
 * `unavailable` because the scaffolded YAML uses placeholder entity IDs —
 * this test only validates the structural contract.
 *
 * Preconditions:
 * - Dev server must be running on the configured app port (harness ensures this).
 * - Home Assistant gateway must be configured; otherwise the router is not
 *   mounted and `beforeAll` fails loudly.
 */

import { describe, it, expect, beforeAll } from '@jest/globals';
import { getAppPort } from '#testlib/configHelper.mjs';

const APP_PORT = getAppPort();
const BASE_URL = `http://localhost:${APP_PORT}`;

describe('GET /api/v1/home-dashboard/state', () => {
  beforeAll(async () => {
    const health = await fetch(`${BASE_URL}/api/v1/health`).catch(() => null);
    if (!health?.ok) {
      throw new Error(
        `Backend not reachable at ${BASE_URL}/api/v1/health. ` +
        `Start the dev server before running live API tests.`
      );
    }

    const probe = await fetch(`${BASE_URL}/api/v1/home-dashboard/state`);
    if (probe.status === 404) {
      throw new Error(
        `/api/v1/home-dashboard/state returned 404. ` +
        `The home-dashboard router is only mounted when haGateway is available. ` +
        `Verify Home Assistant configuration in data/household/apps/home-automation/config.yml.`
      );
    }
  });

  it('returns 200 with rooms array (shape-only contract)', async () => {
    const res = await fetch(`${BASE_URL}/api/v1/home-dashboard/state`);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body).toBeDefined();
    expect(body).not.toBeNull();
    expect(typeof body).toBe('object');

    // Shape contract: rooms is an array. Actual entity values may be
    // empty/unavailable since YAML scaffold uses placeholder IDs.
    expect(body).toHaveProperty('rooms');
    expect(Array.isArray(body.rooms)).toBe(true);
  });
});
