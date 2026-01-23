/**
 * Config Helper for Tests
 *
 * Reads port configuration from system YAML files (SSOT).
 * Used by playwright.config.js and test fixtures.
 */

import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Get the data path from environment
 */
function getDataPath() {
  const basePath = process.env.DAYLIGHT_BASE_PATH;
  const dataPath = process.env.DAYLIGHT_DATA_PATH;

  if (dataPath) return dataPath;
  if (basePath) return path.join(basePath, 'data');

  // Fallback: try to find .env in project root
  const projectRoot = path.resolve(__dirname, '../..');
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
  const projectRoot = path.resolve(__dirname, '../..');
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
 * Load system config from YAML
 */
function loadSystemConfig() {
  const dataPath = getDataPath();
  const envName = getEnvName();

  if (!dataPath) {
    console.warn('[configHelper] Could not determine data path');
    return null;
  }

  const configPath = path.join(dataPath, 'system', `system-local.${envName}.yml`);

  if (!fs.existsSync(configPath)) {
    console.warn(`[configHelper] Config not found: ${configPath}`);
    return null;
  }

  try {
    return yaml.load(fs.readFileSync(configPath, 'utf8'));
  } catch (err) {
    console.warn(`[configHelper] Failed to load config: ${err.message}`);
    return null;
  }
}

/**
 * Get port configuration from system YAML
 * @returns {{ backend: number, frontend: number, webhook: number }}
 */
export function getPorts() {
  const config = loadSystemConfig();

  // Docker defaults (production)
  const defaults = {
    backend: 3111,
    frontend: 3111,  // In prod, frontend is served by backend
    webhook: 3119
  };

  if (!config) return defaults;

  return {
    backend: config.server?.port ?? defaults.backend,
    frontend: config.vite?.port ?? defaults.frontend,
    webhook: config.webhook?.port ?? defaults.webhook
  };
}

/**
 * Get test URLs based on system config
 * @returns {{ frontend: string, backend: string, ws: string }}
 */
export function getTestUrls() {
  const ports = getPorts();

  return {
    frontend: `http://localhost:${ports.frontend}`,
    backend: `http://localhost:${ports.backend}`,
    ws: `ws://localhost:${ports.frontend}/ws`
  };
}

export default { getPorts, getTestUrls };
