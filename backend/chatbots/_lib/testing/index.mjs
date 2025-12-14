/**
 * Testing utilities barrel export
 * @module _lib/testing
 */

export { 
  TestContext, 
  TestScope, 
  createTestHelpers, 
  withTestMode 
} from './TestContext.mjs';

export {
  setupTestEnv,
  getProjectRoot,
  getDataDir,
  jestSetup,
} from './setupTestEnv.mjs';
