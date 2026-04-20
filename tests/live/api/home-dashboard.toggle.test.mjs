// tests/live/api/home-dashboard.toggle.test.mjs
/**
 * Live API integration test: POST /api/v1/home-dashboard/toggle
 *
 * Verifies the whitelist guard: toggling an entityId that is NOT declared
 * in the dashboard YAML (i.e., not on any room's `lights` list) must be
 * rejected with HTTP 403.
 *
 * This test uses an obviously-fake entity ID (`light.not_on_dashboard_xxx`)
 * that no real YAML config would list, so it exercises the whitelist
 * rejection path deterministically.
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

// Entity ID guaranteed to be absent from any real dashboard config.
const NON_WHITELISTED_ENTITY = 'light.not_on_dashboard_xyz';

describe('POST /api/v1/home-dashboard/toggle', () => {
  beforeAll(async () => {
    const health = await fetch(`${BASE_URL}/api/v1/health`).catch(() => null);
    if (!health?.ok) {
      throw new Error(
        `Backend not reachable at ${BASE_URL}/api/v1/health. ` +
        `Start the dev server before running live API tests.`
      );
    }

    // Probe the /state endpoint to confirm the home-dashboard router is mounted.
    // (A POST to /toggle with a bad body would also 404 here, but state is a
    // cleaner probe that doesn't conflate routing vs. validation failures.)
    const probe = await fetch(`${BASE_URL}/api/v1/home-dashboard/state`);
    if (probe.status === 404) {
      throw new Error(
        `/api/v1/home-dashboard/* returned 404. ` +
        `The home-dashboard router is only mounted when haGateway is available. ` +
        `Verify Home Assistant configuration in data/household/apps/home-automation/config.yml.`
      );
    }
  });

  it('rejects a non-whitelisted entityId with 403', async () => {
    const res = await fetch(`${BASE_URL}/api/v1/home-dashboard/toggle`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        entityId: NON_WHITELISTED_ENTITY,
        desiredState: 'on',
      }),
    });

    // Whitelist violations MUST return 403 per ToggleDashboardEntity contract.
    expect(res.status).toBe(403);
  });
});
