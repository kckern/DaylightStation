/**
 * Test Environment Setup
 * @module _lib/testing/setupTestEnv
 * 
 * Sets up process.env exactly like backend/index.js does.
 */

import path from 'path';
import { existsSync, readFileSync } from 'fs';
import { parse } from 'yaml';

/**
 * Find project root by looking for config.app.yml
 */
function findProjectRoot() {
  let dir = path.dirname(new URL(import.meta.url).pathname);
  while (dir !== '/') {
    if (existsSync(path.join(dir, 'config.app.yml'))) {
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
  
  const configAppPath = path.join(projectRoot, 'config.app.yml');
  const configSecretsPath = path.join(projectRoot, 'config.secrets.yml');
  const configLocalPath = path.join(projectRoot, 'config.app-local.yml');
  
  // Parse configs exactly like index.js does
  const appConfig = existsSync(configAppPath) 
    ? parse(readFileSync(configAppPath, 'utf8')) 
    : {};
  const secretsConfig = existsSync(configSecretsPath) 
    ? parse(readFileSync(configSecretsPath, 'utf8')) 
    : {};
  const localConfig = existsSync(configLocalPath) 
    ? parse(readFileSync(configLocalPath, 'utf8')) 
    : {};
  
  // THIS IS THE KEY: Replace process.env entirely with a plain object
  // This allows nested objects like path.data to work
  process.env = { ...process.env, ...appConfig, ...secretsConfig, ...localConfig };
}

export function getDataDir() {
  return process.env.path?.data || path.join(process.cwd(), 'data');
}

export default setupTestEnv;
