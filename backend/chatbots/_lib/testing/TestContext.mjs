/**
 * Test Context for Data Isolation
 * @module _lib/testing/TestContext
 * 
 * Provides test mode support that isolates test data from production data.
 * When test mode is enabled, all data paths are prefixed with `_test/`.
 * 
 * Usage:
 * ```javascript
 * import { TestContext } from './_lib/testing/TestContext.mjs';
 * 
 * // In test setup
 * TestContext.enableTestMode();
 * 
 * // In test teardown
 * await TestContext.cleanup();
 * TestContext.disableTestMode();
 * ```
 */

import fs from 'fs';
import path from 'path';

/**
 * Test data path prefix
 */
const TEST_PREFIX = '_test';

/**
 * Global test mode state
 */
let testModeEnabled = false;

/**
 * Track created test paths for cleanup
 * @type {Set<string>}
 */
const createdTestPaths = new Set();

/**
 * Test context for managing test data isolation
 */
export class TestContext {
  /**
   * Enable test mode - all data paths will be prefixed with _test/
   */
  static enableTestMode() {
    testModeEnabled = true;
  }

  /**
   * Disable test mode
   */
  static disableTestMode() {
    testModeEnabled = false;
  }

  /**
   * Check if test mode is enabled
   * @returns {boolean}
   */
  static isTestMode() {
    return testModeEnabled;
  }

  /**
   * Get the test prefix
   * @returns {string}
   */
  static getPrefix() {
    return TEST_PREFIX;
  }

  /**
   * Transform a data path for test mode
   * If test mode is enabled, prepends _test/ to the path
   * 
   * @param {string} dataPath - Original data path
   * @returns {string} - Transformed path (with _test/ prefix if in test mode)
   * 
   * @example
   * TestContext.enableTestMode();
   * TestContext.transformPath('nutribot/kirk/nutrilog.yml')
   * // Returns: '_test/nutribot/kirk/nutrilog.yml'
   */
  static transformPath(dataPath) {
    if (!testModeEnabled) {
      return dataPath;
    }

    // Don't double-prefix if already has test prefix
    if (dataPath.startsWith(`${TEST_PREFIX}/`)) {
      return dataPath;
    }

    const transformed = `${TEST_PREFIX}/${dataPath}`;
    createdTestPaths.add(transformed);
    return transformed;
  }

  /**
   * Register a path that was created during testing (for cleanup)
   * @param {string} testPath
   */
  static trackPath(testPath) {
    if (testModeEnabled && testPath.startsWith(`${TEST_PREFIX}/`)) {
      createdTestPaths.add(testPath);
    }
  }

  /**
   * Get all tracked test paths
   * @returns {string[]}
   */
  static getTrackedPaths() {
    return Array.from(createdTestPaths);
  }

  /**
   * Clear tracked paths without deleting files
   */
  static clearTrackedPaths() {
    createdTestPaths.clear();
  }

  /**
   * Cleanup test data directory
   * Removes all files in the _test/ directory
   * 
   * @param {string} [baseDataDir] - Base data directory path
   * @returns {Promise<{ deleted: string[], errors: string[] }>}
   */
  static async cleanup(baseDataDir) {
    const deleted = [];
    const errors = [];

    // If no base dir provided, just clear tracking
    if (!baseDataDir) {
      createdTestPaths.clear();
      return { deleted, errors };
    }

    const testDir = path.join(baseDataDir, TEST_PREFIX);

    try {
      if (fs.existsSync(testDir)) {
        await fs.promises.rm(testDir, { recursive: true, force: true });
        deleted.push(testDir);
      }
    } catch (err) {
      errors.push(`Failed to delete ${testDir}: ${err.message}`);
    }

    createdTestPaths.clear();
    return { deleted, errors };
  }

  /**
   * Create a scoped test context that auto-cleans up
   * Useful for individual test suites
   * 
   * @param {Object} [options]
   * @param {string} [options.baseDataDir] - Base data directory for cleanup
   * @returns {TestScope}
   */
  static createScope(options = {}) {
    return new TestScope(options);
  }
}

/**
 * Scoped test context for automatic setup/teardown
 */
export class TestScope {
  #baseDataDir;
  #wasEnabled;

  constructor(options = {}) {
    this.#baseDataDir = options.baseDataDir;
    this.#wasEnabled = testModeEnabled;
  }

  /**
   * Setup - enable test mode
   */
  setup() {
    this.#wasEnabled = testModeEnabled;
    TestContext.enableTestMode();
  }

  /**
   * Teardown - cleanup and restore previous state
   * @returns {Promise<void>}
   */
  async teardown() {
    if (this.#baseDataDir) {
      await TestContext.cleanup(this.#baseDataDir);
    } else {
      TestContext.clearTrackedPaths();
    }

    // Restore previous state
    if (!this.#wasEnabled) {
      TestContext.disableTestMode();
    }
  }
}

/**
 * Jest/test framework helper - creates beforeEach/afterEach hooks
 * 
 * @param {Object} [options]
 * @param {string} [options.baseDataDir] - Base data directory for cleanup
 * @returns {{ beforeEach: Function, afterEach: Function }}
 * 
 * @example
 * const testHelpers = createTestHelpers({ baseDataDir: '/path/to/data' });
 * beforeEach(testHelpers.beforeEach);
 * afterEach(testHelpers.afterEach);
 */
export function createTestHelpers(options = {}) {
  const scope = new TestScope(options);

  return {
    beforeEach: () => scope.setup(),
    afterEach: async () => await scope.teardown(),
  };
}

/**
 * Decorator for test functions that need test mode
 * 
 * @param {Function} testFn - Test function to wrap
 * @param {Object} [options]
 * @returns {Function}
 */
export function withTestMode(testFn, options = {}) {
  return async (...args) => {
    const scope = TestContext.createScope(options);
    scope.setup();
    try {
      return await testFn(...args);
    } finally {
      await scope.teardown();
    }
  };
}

export default TestContext;
