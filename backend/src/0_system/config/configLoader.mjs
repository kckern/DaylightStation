/**
 * Config Loader
 * 
 * Reads YAML files from disk and assembles a unified config object.
 * All I/O is done here - ConfigService receives the result and does no I/O.
 */

import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';

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
    secrets: loadSecrets(dataDir),
    services: loadServices(dataDir),
    households: loadAllHouseholds(dataDir),
    users: loadAllUsers(dataDir),
    auth: loadAllAuth(dataDir),
    apps: loadAllApps(dataDir),
    adapters: loadAdapters(dataDir),
    systemBots: loadSystemBots(dataDir),
    systemAuth: loadSystemAuth(dataDir),
    identityMappings: {},
  };

  // Build identity mappings from user profiles
  config.identityMappings = buildIdentityMappings(config.users);

  return config;
}

// ─── System ──────────────────────────────────────────────────

function loadSystemConfig(dataDir) {
  const systemPath = path.join(dataDir, 'system', 'system.yml');
  const systemYml = readYaml(systemPath) ?? {};

  // Load environment-specific overrides if DAYLIGHT_ENV is set
  const envName = process.env.DAYLIGHT_ENV;
  let localOverrides = {};
  if (envName) {
    const localPath = path.join(dataDir, 'system', `system-local.${envName}.yml`);
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
    configDir: path.join(dataDir, 'system'),
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

function deepMerge(target, source) {
  const result = { ...target };
  for (const key of Object.keys(source)) {
    if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])) {
      result[key] = deepMerge(result[key] ?? {}, source[key]);
    } else {
      result[key] = source[key];
    }
  }
  return result;
}

// ─── Adapters ─────────────────────────────────────────────────

function loadAdapters(dataDir) {
  const adaptersPath = path.join(dataDir, 'system', 'adapters.yml');
  return readYaml(adaptersPath) ?? {};
}

// ─── Services ─────────────────────────────────────────────────

function loadServices(dataDir) {
  const servicesPath = path.join(dataDir, 'system', 'services.yml');
  return readYaml(servicesPath) ?? {};
}

// ─── Secrets ─────────────────────────────────────────────────

function loadSecrets(dataDir) {
  const secretsPath = path.join(dataDir, 'system', 'secrets.yml');
  return readYaml(secretsPath) ?? {};
}

// ─── Households ──────────────────────────────────────────────

function loadAllHouseholds(dataDir) {
  const households = {};

  // Load from flat structure (household/, household-*/)
  const flatDirs = listHouseholdDirs(dataDir);

  for (const dir of flatDirs) {
    const householdId = parseHouseholdId(dir);
    const configPath = path.join(dataDir, dir, 'household.yml');
    const config = readYaml(configPath);
    if (config) {
      households[householdId] = {
        ...config,
        _folderName: dir, // Store for path resolution
        integrations: loadHouseholdIntegrations(dataDir, dir),
        apps: loadHouseholdApps(dataDir, dir),
      };
    }
  }

  return households;
}

/**
 * List household directories in the data directory.
 * Matches: household/ and household-{name}/ patterns.
 */
export function listHouseholdDirs(dataDir) {
  if (!fs.existsSync(dataDir)) return [];

  return fs.readdirSync(dataDir)
    .filter(name => {
      if (name.startsWith('.') || name.startsWith('_')) return false;
      // Only match 'household' exactly or 'household-*' pattern
      if (name !== 'household' && !name.startsWith('household-')) return false;
      return fs.statSync(path.join(dataDir, name)).isDirectory();
    });
}

/**
 * Parse household ID from folder name.
 * household/ -> 'default'
 * household-jones/ -> 'jones'
 */
export function parseHouseholdId(folderName) {
  if (folderName === 'household') return 'default';
  return folderName.replace(/^household-/, '');
}

/**
 * Convert household ID to folder name.
 * 'default' -> 'household'
 * 'jones' -> 'household-jones'
 */
export function toFolderName(householdId) {
  if (householdId === 'default') return 'household';
  return `household-${householdId}`;
}

/**
 * Load apps for a household.
 */
function loadHouseholdApps(dataDir, folderName) {
  const appsDir = path.join(dataDir, folderName, 'apps');
  return loadAppsFromDir(appsDir);
}

/**
 * Load integrations for a household.
 */
function loadHouseholdIntegrations(dataDir, folderName) {
  const integrationsPath = path.join(dataDir, folderName, 'integrations.yml');
  return readYaml(integrationsPath) ?? {};
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

// ─── Auth ────────────────────────────────────────────────────

function loadAllAuth(dataDir) {
  return {
    users: loadUserAuth(dataDir),
    households: loadHouseholdAuth(dataDir),
  };
}

function loadUserAuth(dataDir) {
  const usersDir = path.join(dataDir, 'users');
  const auth = {};

  for (const username of listDirs(usersDir)) {
    const authDir = path.join(usersDir, username, 'auth');
    if (!fs.existsSync(authDir)) continue;

    auth[username] = {};
    for (const file of listYamlFiles(authDir)) {
      const service = path.basename(file, '.yml');
      const creds = readYaml(file);
      if (creds) {
        auth[username][service] = creds;
      }
    }
  }

  return auth;
}

function loadHouseholdAuth(dataDir) {
  const auth = {};

  // Load from flat structure (household/, household-*/)
  const flatDirs = listHouseholdDirs(dataDir);

  for (const dir of flatDirs) {
    const householdId = parseHouseholdId(dir);
    const authDir = path.join(dataDir, dir, 'auth');
    if (!fs.existsSync(authDir)) continue;

    auth[householdId] = {};
    for (const file of listYamlFiles(authDir)) {
      const service = path.basename(file, '.yml');
      const creds = readYaml(file);
      if (creds) {
        auth[householdId][service] = creds;
      }
    }
  }

  return auth;
}

// ─── Apps ────────────────────────────────────────────────────

function loadAllApps(dataDir) {
  const appsDir = path.join(dataDir, 'system', 'apps');
  const apps = {};

  for (const file of listYamlFiles(appsDir)) {
    const appName = path.basename(file, '.yml');
    const config = readYaml(file);
    if (config) {
      apps[appName] = config;
    }
  }

  return apps;
}

// ─── System Bots ─────────────────────────────────────────────

/**
 * Load system-level bot configurations from system/bots.yml
 * @param {string} dataDir - Path to data directory
 * @returns {object} Bot configurations keyed by bot name
 */
function loadSystemBots(dataDir) {
  const botsPath = path.join(dataDir, 'system', 'bots.yml');
  return readYaml(botsPath) ?? {};
}

// ─── System Auth ─────────────────────────────────────────────

/**
 * Load system-level auth credentials from system/auth/*.yml
 * Each file represents a platform (e.g., telegram.yml -> systemAuth.telegram)
 * @param {string} dataDir - Path to data directory
 * @returns {object} Auth credentials keyed by platform, then by key
 */
function loadSystemAuth(dataDir) {
  const authDir = path.join(dataDir, 'system', 'auth');
  const auth = {};

  for (const file of listYamlFiles(authDir)) {
    // Skip example files
    const basename = path.basename(file);
    if (basename.includes('.example.')) continue;

    const platform = path.basename(file, '.yml');
    const creds = readYaml(file);
    if (creds) {
      auth[platform] = creds;
    }
  }

  return auth;
}

// ─── Identity Mappings ───────────────────────────────────────

function buildIdentityMappings(users) {
  const mappings = {};

  for (const [username, profile] of Object.entries(users)) {
    const identities = profile.identities ?? {};

    for (const [platform, data] of Object.entries(identities)) {
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
