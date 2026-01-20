// tests/integration/api/_utils/plexHealthCheck.mjs
/**
 * Plex server connectivity check.
 * Used to fail-fast if Plex is offline before running Plex tests.
 */

import { loadTestConfig } from './testServer.mjs';

const PLEX_TIMEOUT_MS = 5000;

/**
 * Check if Plex server is reachable.
 *
 * @returns {Promise<{online: boolean, host: string|null, error: string|null}>}
 */
export async function checkPlexHealth() {
  let config;

  try {
    config = await loadTestConfig();
  } catch (err) {
    return {
      online: false,
      host: null,
      error: `Config error: ${err.message}`
    };
  }

  const { host, token } = config.plex;

  if (!host) {
    return {
      online: false,
      host: null,
      error: 'Plex host not configured. Configure in households/*/auth.yml or set PLEX_HOST env var.'
    };
  }

  if (!token) {
    return {
      online: false,
      host,
      error: 'Plex token not configured. Configure in households/*/auth.yml or set PLEX_TOKEN env var.'
    };
  }

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), PLEX_TIMEOUT_MS);

    // Hit Plex identity endpoint to verify connectivity
    const url = `${host}/identity`;
    const response = await fetch(url, {
      headers: {
        'X-Plex-Token': token,
        'Accept': 'application/json'
      },
      signal: controller.signal
    });

    clearTimeout(timeoutId);

    if (response.ok) {
      return {
        online: true,
        host,
        error: null
      };
    } else {
      return {
        online: false,
        host,
        error: `Plex returned status ${response.status}`
      };
    }
  } catch (err) {
    if (err.name === 'AbortError') {
      return {
        online: false,
        host,
        error: `Plex connection timed out after ${PLEX_TIMEOUT_MS}ms`
      };
    }

    return {
      online: false,
      host,
      error: `Plex connection failed: ${err.message}`
    };
  }
}

/**
 * Assert Plex is online. Throws if offline.
 * Use in beforeAll() to fail-fast for Plex test suites.
 *
 * @throws {Error} If Plex is not reachable
 */
export async function assertPlexOnline() {
  const result = await checkPlexHealth();

  if (!result.online) {
    throw new Error(
      `PLEX OFFLINE: Cannot run Plex integration tests.\n\n` +
      `Host: ${result.host || '(not configured)'}\n` +
      `Error: ${result.error}\n\n` +
      `Ensure Plex server is running and accessible.\n` +
      `Required environment variables:\n` +
      `  - PLEX_HOST (e.g., http://192.168.1.100:32400)\n` +
      `  - PLEX_TOKEN (your Plex auth token)\n\n` +
      `To skip Plex tests:\n` +
      `  npm run test:api -- --testPathIgnorePatterns=plex`
    );
  }

  return result;
}

/**
 * Get Plex configuration status (for test reports).
 */
export async function getPlexStatus() {
  const result = await checkPlexHealth();

  return {
    ...result,
    configured: !!(result.host),
    canRunTests: result.online
  };
}

export default checkPlexHealth;
