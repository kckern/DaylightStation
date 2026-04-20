// tests/live/api/home-dashboard.config.test.mjs
/**
 * Live API integration test: GET /api/v1/home-dashboard/config
 *
 * Verifies the config endpoint returns the dashboard YAML contract:
 * an object with a `summary` property and a `rooms` array.
 *
 * Preconditions:
 * - Dev server (Vite + backend) must be running on the configured app port.
 *   The live test harness ensures this; do NOT start servers from the test file.
 * - A Home Assistant gateway must be configured in the household config.
 *   If not, the home-dashboard router is NOT mounted in bootstrap and the
 *   endpoints return 404. In that case `beforeAll` fails loudly — per
 *   CLAUDE.md "fail fast on infrastructure issues", NOT a silent skip.
 */

import { describe, it, expect, beforeAll } from '@jest/globals';
import { getAppPort } from '#testlib/configHelper.mjs';

const APP_PORT = getAppPort();
const BASE_URL = `http://localhost:${APP_PORT}`;

describe('GET /api/v1/home-dashboard/config', () => {
  beforeAll(async () => {
    // 1. Backend reachable?
    const health = await fetch(`${BASE_URL}/api/v1/health`).catch(() => null);
    if (!health?.ok) {
      throw new Error(
        `Backend not reachable at ${BASE_URL}/api/v1/health. ` +
        `Start the dev server before running live API tests.`
      );
    }

    // 2. Home-dashboard router mounted?
    // Router is only mounted when haGateway is configured. 404 here means
    // Home Assistant is not wired up in this environment.
    const probe = await fetch(`${BASE_URL}/api/v1/home-dashboard/config`);
    if (probe.status === 404) {
      throw new Error(
        `/api/v1/home-dashboard/config returned 404. ` +
        `The home-dashboard router is only mounted when haGateway is available. ` +
        `Verify Home Assistant configuration in data/household/apps/home-automation/config.yml.`
      );
    }
  });

  it('returns 200 with summary + rooms array', async () => {
    const res = await fetch(`${BASE_URL}/api/v1/home-dashboard/config`);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body).toBeDefined();
    expect(body).not.toBeNull();
    expect(typeof body).toBe('object');

    // Contract: object with `summary` + `rooms` array
    expect(body).toHaveProperty('summary');
    expect(body).toHaveProperty('rooms');
    expect(Array.isArray(body.rooms)).toBe(true);
  });
});
