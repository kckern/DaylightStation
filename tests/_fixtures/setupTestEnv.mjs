import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Configure process.env for test mode
 * Points data paths to test fixtures
 */
export function setupTestEnv(options = {}) {
  const { household = '_test' } = options;

  // Set test data path
  const testDataPath = path.join(__dirname, 'data');

  // Configure environment
  process.env.HOUSEHOLD_ID = household;
  process.env.NODE_ENV = 'test';

  // Override path.data if not already set for tests
  if (!process.env.TEST_DATA_PATH) {
    process.env.TEST_DATA_PATH = testDataPath;
  }

  return {
    dataPath: testDataPath,
    household,
    users: ['_alice', '_bob', '_charlie']
  };
}

export const TEST_USERS = {
  alice: '_alice',
  bob: '_bob',
  charlie: '_charlie'
};

export const TEST_HOUSEHOLD = '_test';
