/**
 * Jest Setup File
 * 
 * This file runs before all tests to initialize the test environment.
 * It ensures process.env.path.data and other required config values are set.
 */

import { setupTestEnv } from './_lib/testing/setupTestEnv.mjs';

// Initialize test environment
setupTestEnv({ loadConfigs: true });
