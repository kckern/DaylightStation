/**
 * Config Helper for Tests
 *
 * Reads app port from system YAML (SSOT).
 * Tests only need the public-facing port - same topology as prod.
 */

import fs from 'node:fs';
import path from 'path';
import { resolvePorts } from '../../frontend/vite.ports.mjs';

/**
 * Get the data path from environment
 */
function getDataPath() {
  const basePath = process.env.DAYLIGHT_BASE_PATH;
  const dataPath = process.env.DAYLIGHT_DATA_PATH;

  if (dataPath) return dataPath;
  if (basePath) return path.join(basePath, 'data');

  // Fallback: try to find .env in project root (uses process.cwd())
  const projectRoot = process.cwd();
  const envPath = path.join(projectRoot, '.env');

  if (fs.existsSync(envPath)) {
    const envContent = fs.readFileSync(envPath, 'utf8');
    const match = envContent.match(/DAYLIGHT_BASE_PATH=(.+)/);
    if (match) {
      return path.join(match[1].trim(), 'data');
    }
  }

  return null;
}

/**
 * Get the environment name
 */
function getEnvName() {
  if (process.env.DAYLIGHT_ENV) return process.env.DAYLIGHT_ENV;

  // Fallback: try to find .env in project root
  const projectRoot = process.cwd();
  const envPath = path.join(projectRoot, '.env');

  if (fs.existsSync(envPath)) {
    const envContent = fs.readFileSync(envPath, 'utf8');
    const match = envContent.match(/DAYLIGHT_ENV=(.+)/);
    if (match) {
      return match[1].trim();
    }
  }

  return 'default';
}

/**
 * Get the public-facing app port
 * This is the only port tests need - same topology as prod
 */
export function getAppPort() {
  return resolvePorts({ dataPath: getDataPath(), envName: getEnvName() }).app;
}

/**
 * Get test URLs based on app port
 * All URLs point to the same port - tests don't know about internal backend
 */
export function getTestUrls() {
  const appPort = getAppPort();

  return {
    frontend: `http://localhost:${appPort}`,
    backend: `http://localhost:${appPort}`,  // Same! Goes through Vite proxy in dev
    ws: `ws://localhost:${appPort}/ws`
  };
}

export { getDataPath };
export default { getAppPort, getTestUrls, getDataPath };
