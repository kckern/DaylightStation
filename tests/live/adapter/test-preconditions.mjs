/**
 * Live Test Precondition Helpers
 *
 * These utilities ensure tests FAIL or SKIP properly instead of silently passing.
 * Per CLAUDE.md: "Skipping is NOT passing" - tests must either pass or fail,
 * never silently skip assertions.
 *
 * Usage:
 *   import { requireAuth, requireConfig, skipIf } from '../test-preconditions.mjs';
 *
 *   beforeAll(() => {
 *     requireAuth('buxfer', configService);  // Throws if not configured
 *   });
 *
 *   it('does something', () => {
 *     skipIf(circuitBreakerOpen, 'circuit breaker open');  // Explicit skip
 *   });
 */

/**
 * Require authentication to be configured. Throws if missing.
 * Use in beforeAll() to fail the entire suite when auth is missing.
 *
 * @param {string} service - Service name (e.g., 'buxfer', 'strava')
 * @param {object} configService - ConfigService instance
 * @param {object} [options] - Options
 * @param {string} [options.authType] - 'user', 'household', or 'secret'
 * @throws {Error} If auth is not configured
 */
export function requireAuth(service, configService, options = {}) {
  const { authType = 'auto' } = options;

  let auth = null;
  let source = null;

  if (authType === 'secret' || authType === 'auto') {
    // Try secret pattern (e.g., STRAVA_CLIENT_ID)
    const secretKey = `${service.toUpperCase()}_API_KEY`;
    auth = configService.getSecret?.(secretKey);
    if (auth) source = 'secret';
  }

  if (!auth && (authType === 'user' || authType === 'auto')) {
    auth = configService.getUserAuth?.(service);
    if (auth) source = 'userAuth';
  }

  if (!auth && (authType === 'household' || authType === 'auto')) {
    auth = configService.getHouseholdAuth?.(service);
    if (auth) source = 'householdAuth';
  }

  if (!auth) {
    throw new Error(
      `[PRECONDITION FAILED] ${service} auth not configured. ` +
      `Expected: getUserAuth('${service}'), getHouseholdAuth('${service}'), or getSecret('${service.toUpperCase()}_API_KEY')`
    );
  }

  return { auth, source };
}

/**
 * Require a secret to be configured. Throws if missing.
 *
 * @param {string} key - Secret key (e.g., 'OPENAI_API_KEY')
 * @param {object} configService - ConfigService instance
 * @throws {Error} If secret is not configured
 */
export function requireSecret(key, configService) {
  const value = configService.getSecret?.(key);
  if (!value) {
    throw new Error(
      `[PRECONDITION FAILED] Secret '${key}' not configured. ` +
      `Add it to secrets.yml or environment.`
    );
  }
  return value;
}

/**
 * Require config to exist. Throws if missing.
 *
 * @param {string} description - What config is required
 * @param {*} value - The config value to check
 * @throws {Error} If config is falsy
 */
export function requireConfig(description, value) {
  if (!value) {
    throw new Error(
      `[PRECONDITION FAILED] ${description} not configured.`
    );
  }
  return value;
}

/**
 * Require data path to be available. Throws if missing.
 *
 * @param {function} getDataPath - Function that returns data path
 * @throws {Error} If data path is not available
 */
export function requireDataPath(getDataPath) {
  const dataPath = typeof getDataPath === 'function' ? getDataPath() : getDataPath;
  if (!dataPath) {
    throw new Error(
      `[PRECONDITION FAILED] Data path not configured. ` +
      `Set DAYLIGHT_DATA_PATH environment variable.`
    );
  }
  return dataPath;
}

/**
 * Skip a test with an explicit reason. Use this instead of early return.
 * This makes skips visible in test output.
 *
 * @param {boolean} condition - If true, skip the test
 * @param {string} reason - Why the test is being skipped
 * @throws {Error} With special message that test runners recognize as skip
 */
export function skipIf(condition, reason) {
  if (condition) {
    // Jest recognizes this pattern for conditional skips
    console.log(`[SKIP] ${reason}`);
    // Use pending() in Jest or throw with skip marker
    throw new SkipTestError(reason);
  }
}

/**
 * Custom error for skipped tests.
 * Test harness should recognize this and mark as skipped, not failed.
 */
export class SkipTestError extends Error {
  constructor(reason) {
    super(`[SKIP] ${reason}`);
    this.name = 'SkipTestError';
    this.isSkip = true;
  }
}

/**
 * Assert that a harvest result indicates success.
 * Use this instead of checking result properties manually.
 *
 * @param {object} result - Harvest result
 * @param {string} service - Service name for error messages
 */
export function assertHarvestSuccess(result, service) {
  if (!result) {
    throw new Error(`[ASSERTION FAILED] ${service} harvest returned null/undefined`);
  }

  if (result.error) {
    throw new Error(`[ASSERTION FAILED] ${service} harvest error: ${result.error}`);
  }

  if (result.status === 'error') {
    throw new Error(`[ASSERTION FAILED] ${service} harvest failed: ${result.reason || 'unknown'}`);
  }

  // Circuit breaker / rate limit - explicit skip, not silent pass
  if (result.skipped || result.status === 'skipped') {
    throw new SkipTestError(`${service} skipped: ${result.reason || 'unknown'}`);
  }

  return result;
}

/**
 * Create a test suite that requires certain preconditions.
 * If preconditions fail in beforeAll, all tests in the suite are skipped.
 *
 * Usage:
 *   const { describe, beforeAll, it } = createTestSuite({
 *     name: 'Strava',
 *     requires: ['auth:strava', 'secret:STRAVA_CLIENT_ID']
 *   });
 */
export function createTestSuite(options) {
  // This is a placeholder for a more sophisticated test wrapper
  // For now, we use the simpler requireAuth/requireConfig helpers
  return { describe, beforeAll, it };
}
