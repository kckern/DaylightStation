/**
 * Test Environment Setup
 * @module _lib/testing/setupTestEnv
 * 
 * Sets up process.env exactly like backend/index.js does.
 */

import path from 'path';
import { existsSync } from 'fs';
import dotenv from 'dotenv';
import { resolveConfigPaths } from '../../../lib/config/pathResolver.mjs';
import { loadAllConfig } from '../../../lib/config/loader.mjs';

/**
 * Find project root by looking for docker-compose.yml
 */
function findProjectRoot() {
  let dir = path.dirname(new URL(import.meta.url).pathname);
  while (dir !== '/') {
    if (existsSync(path.join(dir, 'docker-compose.yml'))) {
      return dir;
    }
    dir = path.dirname(dir);
  }
  return process.cwd();
}

/**
 * Setup test environment - exactly like backend/index.js does:
 *   process.env = { ...process.env, ...appConfig, ...secretsConfig, ...localConfig }
 */
export function setupTestEnv() {
  const projectRoot = findProjectRoot();
  const isDocker = existsSync('/.dockerenv');
  
  // Load .env file from project root
  dotenv.config({ path: path.join(projectRoot, '.env') });
  
  // Resolve config paths (from env vars, mount, or fallback)
  const configPaths = resolveConfigPaths({ isDocker, codebaseDir: projectRoot });

  // Load all config using unified loader
  const configResult = loadAllConfig({
    configDir: configPaths.configDir,
    dataDir: configPaths.dataDir,
    isDocker,
    isDev: !isDocker
  });

  // Populate process.env with merged config
  const newEnv = { 
    ...process.env, 
    isDocker, 
    ...configResult.config
  };
  
  // Hack to allow object properties in process.env for testing
  // We replace the global process.env property descriptor if possible, 
  // or we just rely on the fact that we are in a test environment where we might be able to mock it.
  // But standard Node.js process.env coerces to strings.
  
  // Let's try to define it on the global object to override the native one?
  // Or just set the specific properties we need as strings if they are simple.
  // But path.data is nested.
  
  // Alternative: We can't easily override process.env to support objects in standard Node.
  // The original code in index.js might be relying on something else or I am misinterpreting it.
  // Let's check if we can just set the specific flattened keys we need for ConfigService auto-init.
  
  // For ConfigService auto-init, it checks process.env.path?.data
  // If we can't make process.env.path an object, we should initialize ConfigService manually.
  
  // Let's try to force it for the test environment:
  try {
      Object.defineProperty(process, 'env', {
          value: newEnv,
          writable: true,
          enumerable: true,
          configurable: true
      });
  } catch (e) {
      console.warn('[TestSetup] Failed to replace process.env:', e.message);
      // Fallback: copy properties (will stringify objects)
      Object.assign(process.env, configResult.config);
  }
}

export function getDataDir() {
  return process.env.path?.data || path.join(process.cwd(), 'data');
}

export default setupTestEnv;
