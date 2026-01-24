/**
 * Test Context Utility
 * @module infrastructure/testing/TestContext
 *
 * Provides test mode detection and path transformation for data isolation during tests.
 * When in test mode, data paths are prefixed to prevent test data from mixing with production.
 */

const TEST_PREFIX = '_test';

/**
 * Global test mode state
 */
let testMode = false;
let testPrefix = TEST_PREFIX;

/**
 * Test context utilities for data isolation during testing
 */
export const TestContext = {
  /**
   * Check if currently running in test mode
   * @returns {boolean}
   */
  isTestMode() {
    return testMode;
  },

  /**
   * Enable test mode with optional custom prefix
   * @param {string} [prefix='_test'] - Prefix to use for test data paths
   */
  enableTestMode(prefix = TEST_PREFIX) {
    testMode = true;
    testPrefix = prefix;
  },

  /**
   * Disable test mode
   */
  disableTestMode() {
    testMode = false;
    testPrefix = TEST_PREFIX;
  },

  /**
   * Get the current test prefix
   * @returns {string}
   */
  getTestPrefix() {
    return testPrefix;
  },

  /**
   * Transform a data path for test isolation
   * In test mode, prefixes the path to isolate test data
   * In normal mode, returns the path unchanged
   *
   * @param {string} basePath - The original data path
   * @returns {string} - Transformed path (with test prefix if in test mode)
   *
   * @example
   * // Normal mode
   * TestContext.transformPath('nutribot/logs') // => 'nutribot/logs'
   *
   * // Test mode
   * TestContext.enableTestMode();
   * TestContext.transformPath('nutribot/logs') // => '_test/nutribot/logs'
   */
  transformPath(basePath) {
    if (!testMode) {
      return basePath;
    }
    // Ensure we don't double-prefix
    if (basePath.startsWith(testPrefix + '/')) {
      return basePath;
    }
    return `${testPrefix}/${basePath}`;
  },

  /**
   * Reset test context to default state
   * Useful for cleanup between test runs
   */
  reset() {
    testMode = false;
    testPrefix = TEST_PREFIX;
  }
};

export default TestContext;
