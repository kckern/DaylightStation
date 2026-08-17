  /**
 * Config Loader
 * 
 * Reads YAML files from disk and assembles a unified config object.
 * All I/O is done here - ConfigService receives the result and does no I/O.
 */

import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';
import { deepMerge } from '../utils/deepMerge.mjs';
import { listHouseholdDirs, parseHouseholdId, toFolderName } from '../utils/householdDirs.mjs';
import { resolveYamlPath } from '../utils/FileIO.mjs';

/**
 * Load all config from the data directory.
 * Returns a unified config object ready for validation.
 *
 * @param {string} dataDir - Path to data directory
 * @returns {object} Unified config object
 */
export function loadConfig(dataDir) {
  const config = {
    system: loadSystemConfig(dataDir),
    // secrets, auth, systemAuth removed - now handled by SecretsHandler
    services: loadServices(dataDir),
    households: loadAllHouseholds(dataDir),
    users: loadAllUsers(dataDir),
    apps: loadAllApps(dataDir),
    adapters: loadAdapters(dataDir),
    systemBots: loadSystemBots(dataDir),
    identityMappings: {},
  };

  // Build identity mappings from user profiles
  config.identityMappings = buildIdentityMappings(config.users);

  return config;
}

// ─── System ──────────────────────────────────────────────────

function loadSystemConfig(dataDir) {
  const systemPath = path.join(dataDir, 'system', 'config', 'system.yml');
  const systemYml = readYaml(systemPath) ?? {};

  // Load environment-specific overrides if DAYLIGHT_ENV is set
  const envName = process.env.DAYLIGHT_ENV;
  let localOverrides = {};
  if (envName) {
    const localPath = path.join(dataDir, 'system', 'config', `system-local.${envName}.yml`);
    localOverrides = readYaml(localPath) ?? {};
  }

  // Merge base config with local overrides
  const merged = deepMerge(systemYml, localOverrides);

  // Derive base directory from dataDir (go up one level)
  const baseDir = path.dirname(dataDir);

  return {
    // Bootstrap paths (not from YML)
    dataDir,
    baseDir,
    configDir: path.join(dataDir, 'system', 'config'),
    // Environment
    env: envName ?? merged.env ?? 'default',
    // Core settings from YML
    defaultHouseholdId: merged.households?.default ?? 'default',
    timezone: merged.timezone ?? 'America/Los_Angeles',
    // Server settings
    server: merged.server ?? {},
    // Paths (media, watchState, img, etc.)
    paths: merged.paths ?? {},
    // Scheduler
    scheduler: merged.scheduler ?? {},
    // Pass through any other top-level keys
    ...Object.fromEntries(
      Object.entries(merged).filter(([k]) =>
        !['households', 'timezone', 'server', 'paths', 'scheduler', 'env'].includes(k)
      )
    ),
  };
}

// ─── Adapters ─────────────────────────────────────────────────

function loadAdapters(dataDir) {
  const adaptersPath = path.join(dataDir, 'system', 'config', 'adapters.yml');
  return readYaml(adaptersPath) ?? {};
}

// ─── Services ─────────────────────────────────────────────────

function loadServices(dataDir) {
  const servicesPath = path.join(dataDir, 'system', 'config', 'services.yml');
  return readYaml(servicesPath) ?? {};
}

// ─── Households ──────────────────────────────────────────────

function loadAllHouseholds(dataDir) {
  const households = {};

  // Load from flat structure (household/, household-*/)
  const flatDirs = listHouseholdDirs(dataDir);

  for (const dir of flatDirs) {
    const householdId = parseHouseholdId(dir);
    // Colocated first: household.yml at the household root (task-13). Legacy
    // config/household.yml is still read so an un-migrated household still
    // boots — drop this fallback once every household has been moved.
    const colocatedPath = path.join(dataDir, dir, 'household.yml');
    const legacyPath = path.join(dataDir, dir, 'config', 'household.yml');
    const config = readYaml(colocatedPath) ?? readYaml(legacyPath);
    if (config) {
      households[householdId] = {
        ...config,
        _folderName: dir, // Store for path resolution
        integrations: loadHouseholdIntegrations(dataDir, dir),
        devices: loadHouseholdDevices(dataDir, dir),
        apps: loadHouseholdApps(dataDir, dir),
      };
    }
  }

  return households;
}

// Household directory helpers now live in system utils so adapters can import
// them without pulling in the config singleton. Re-exported here for the many
// existing callers that expect them on configLoader.
export { listHouseholdDirs, parseHouseholdId, toFolderName };

/**
 * Load apps for a household.
 * Merges from three locations, later entries winning on key collision:
 *   1. apps/ directory              (legacy: subdirs with config.yml, top-level YAMLs)
 *   2. config/<appName>.yml         (retiring: config-only apps)
 *   3. <appName>/config.yml         (colocated, task-13 — preferred)
 * Non-app configs (household, integrations, devices) live outside both the
 * config/ scan and the colocated scan — household.yml and integrations.yml
 * sit at the household root, devices.yml under hardware/ — so they are never
 * picked up here regardless of migration state.
 */
function loadHouseholdApps(dataDir, folderName) {
  // Legacy: load from apps/ directory
  const appsDir = path.join(dataDir, folderName, 'apps');
  const appsFromLegacy = loadAppsFromDir(appsDir);

  // Retiring: load app configs from config/ directory
  // Excludes known non-app configs (household, integrations, devices)
  const NON_APP_CONFIGS = new Set(['household', 'integrations', 'devices']);
  const configDir = path.join(dataDir, folderName, 'config');
  const appsFromConfig = {};
  for (const file of listYamlFiles(configDir)) {
    const name = path.basename(file, '.yml');
    if (NON_APP_CONFIGS.has(name)) continue;
    const config = readYaml(file);
    if (config) {
      appsFromConfig[name] = config;
    }
  }

  // Colocated: <household>/<appName>/config.yml — a direct child of the
  // household root that itself has a config.yml. `config` and `apps` are
  // excluded so the two loaders above are never re-scanned as if they were
  // app domains.
  const NON_APP_DIRS = new Set(['config', 'apps']);
  const appsFromColocated = {};
  for (const subdir of listDirs(path.join(dataDir, folderName))) {
    if (NON_APP_DIRS.has(subdir)) continue;
    // .yml OR .yaml, matching ConfigService#getHouseholdAppConfigPath /
    // #resolveHouseholdAppConfigPath's yamlExists-based resolution — task-13
    // review, Minor M5: this used to hardcode 'config.yml' only, so a
    // colocated config.yaml would resolve on reload but silently not exist
    // at boot.
    const resolvedPath = resolveYamlPath(path.join(dataDir, folderName, subdir, 'config'));
    const config = resolvedPath ? readYaml(resolvedPath) : null;
    if (config) {
      appsFromColocated[subdir] = config;
    }
  }

  // Merge: colocated takes precedence over config/, which takes precedence
  // over apps/.
  return { ...appsFromLegacy, ...appsFromConfig, ...appsFromColocated };
}

/**
 * Load integrations for a household.
 * Colocated first: integrations.yml at the household root, beside
 * household.yml (task-13). Legacy config/integrations.yml is still read as a
 * fallback until every household has been migrated.
 */
function loadHouseholdIntegrations(dataDir, folderName) {
  const colocatedPath = path.join(dataDir, folderName, 'integrations.yml');
  const legacyPath = path.join(dataDir, folderName, 'config', 'integrations.yml');
  return readYaml(colocatedPath) ?? readYaml(legacyPath) ?? {};
}

/**
 * Load devices config for a household.
 * Colocated first: hardware/devices.yml, beside the device state hardware/
 * already holds (task-13). Legacy config/devices.yml is still read as a
 * fallback until every household has been migrated.
 */
function loadHouseholdDevices(dataDir, folderName) {
  const colocatedPath = path.join(dataDir, folderName, 'hardware', 'devices.yml');
  const legacyPath = path.join(dataDir, folderName, 'config', 'devices.yml');
  return readYaml(colocatedPath) ?? readYaml(legacyPath) ?? {};
}

/**
 * Load apps from an apps directory.
 * Handles both top-level YAML files and subdirectories with config.yml.
 */
function loadAppsFromDir(appsDir) {
  const apps = {};

  // Load top-level YAML files in apps/ (e.g., chatbots.yml -> apps.chatbots)
  for (const file of listYamlFiles(appsDir)) {
    const appName = path.basename(file, '.yml');
    const config = readYaml(file);
    if (config) {
      apps[appName] = config;
    }
  }

  // Load app subdirectories with config.yml (e.g., fitness/config.yml -> apps.fitness)
  for (const subdir of listDirs(appsDir)) {
    const configPath = path.join(appsDir, subdir, 'config.yml');
    const config = readYaml(configPath);
    if (config) {
      apps[subdir] = config;
    }
  }

  return apps;
}

// ─── Users ───────────────────────────────────────────────────

function loadAllUsers(dataDir) {
  const usersDir = path.join(dataDir, 'users');
  const users = {};

  for (const username of listDirs(usersDir)) {
    const profilePath = path.join(usersDir, username, 'profile.yml');
    const profile = readYaml(profilePath);
    if (profile) {
      users[username] = profile;
    }
  }

  return users;
}

// ─── Apps ────────────────────────────────────────────────────

/**
 * Load system-level app configs from system/config/.
 * Excludes infrastructure configs (system, adapters, services, etc.)
 * which are loaded by their own dedicated loaders.
 */
function loadAllApps(dataDir) {
  const INFRASTRUCTURE_CONFIGS = new Set([
    'system', 'adapters', 'services', 'bots', 'logging',
    'archive', 'dev', 'jobs', 'media', 'testdata', 'secrets',
  ]);

  const configDir = path.join(dataDir, 'system', 'config');

  // Also check legacy system/apps/ for backward compat
  const appsDir = path.join(dataDir, 'system', 'apps');

  const apps = {};

  // Legacy: load from system/apps/ first (if still exists)
  for (const file of listYamlFiles(appsDir)) {
    const appName = path.basename(file, '.yml');
    const config = readYaml(file);
    if (config) {
      apps[appName] = config;
    }
  }

  // New: load app configs from system/config/, excluding infrastructure
  for (const file of listYamlFiles(configDir)) {
    const name = path.basename(file, '.yml');
    if (INFRASTRUCTURE_CONFIGS.has(name)) continue;
    if (name.startsWith('system-local.')) continue;
    const config = readYaml(file);
    if (config) {
      apps[name] = config;
    }
  }

  return apps;
}

// ─── System Bots ─────────────────────────────────────────────

/**
 * Load system-level bot configurations from system/config/bots.yml
 * @param {string} dataDir - Path to data directory
 * @returns {object} Bot configurations keyed by bot name
 */
function loadSystemBots(dataDir) {
  const botsPath = path.join(dataDir, 'system', 'config', 'bots.yml');
  return readYaml(botsPath) ?? {};
}

// ─── Identity Mappings ───────────────────────────────────────

function buildIdentityMappings(users) {
  const mappings = {};

  for (const [username, profile] of Object.entries(users)) {
    const identities = profile.identities ?? {};

    for (const [platform, data] of Object.entries(identities)) {
      // An identity value can be null (e.g. an empty `fingerprints:` key) or a
      // non-object (an array/string) — never assume it's a keyed object.
      if (!data || typeof data !== 'object' || Array.isArray(data)) continue;
      const platformId = data.user_id ?? data.id;
      if (platformId) {
        mappings[platform] ??= {};
        mappings[platform][String(platformId)] = username;
      }
    }
  }

  return mappings;
}

// ─── File Helpers ────────────────────────────────────────────

function readYaml(filePath) {
  if (!fs.existsSync(filePath)) return null;

  try {
    const content = fs.readFileSync(filePath, 'utf8');
    return yaml.load(content) ?? null;
  } catch (err) {
    console.error(`Failed to parse ${filePath}: ${err.message}`);
    return null;
  }
}

function listDirs(dir) {
  if (!fs.existsSync(dir)) return [];

  return fs.readdirSync(dir).filter(name => {
    if (name.startsWith('.') || name.startsWith('_') || name === 'example') {
      return false;
    }
    return fs.statSync(path.join(dir, name)).isDirectory();
  });
}

function listYamlFiles(dir) {
  if (!fs.existsSync(dir)) return [];

  return fs.readdirSync(dir)
    .filter(f => (f.endsWith('.yml') || f.endsWith('.yaml')) && !f.startsWith('.'))
    .map(f => path.join(dir, f));
}

export default loadConfig;

// Export loadSystemConfig for bootstrap (needed to determine secrets provider)
export { loadSystemConfig };

// ─── Legacy Compatibility ─────────────────────────────────────

/**
 * Legacy function - no-op since ConfigService handles everything
 * @deprecated Use ConfigService instead
 */
export function loadAllConfig() {
  // No-op: Config is loaded via initConfigService
}

/**
 * Legacy function - no-op
 * @deprecated Use ConfigService.getSafeConfig() instead
 */
export function logConfigSummary() {
  // No-op: Config summary logged during initConfigService
}
