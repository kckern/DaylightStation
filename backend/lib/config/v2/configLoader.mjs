/**
 * Config Loader
 * @module lib/config/v2/configLoader
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
    households: loadAllHouseholds(dataDir),
    users: loadAllUsers(dataDir),
    auth: loadAllAuth(dataDir),
    apps: loadAllApps(dataDir),
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

  return {
    dataDir,
    configDir: path.join(dataDir, 'system'),
    defaultHouseholdId: systemYml.households?.default ?? 'default',
    timezone: systemYml.timezone ?? 'America/Los_Angeles',
  };
}

// ─── Secrets ─────────────────────────────────────────────────

function loadSecrets(dataDir) {
  const secretsPath = path.join(dataDir, 'system', 'secrets.yml');
  return readYaml(secretsPath) ?? {};
}

// ─── Households ──────────────────────────────────────────────

function loadAllHouseholds(dataDir) {
  const householdsDir = path.join(dataDir, 'households');
  const households = {};

  for (const hid of listDirs(householdsDir)) {
    const configPath = path.join(householdsDir, hid, 'household.yml');
    const config = readYaml(configPath);
    if (config) {
      households[hid] = config;
    }
  }

  return households;
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
  const householdsDir = path.join(dataDir, 'households');
  const auth = {};

  for (const hid of listDirs(householdsDir)) {
    const authDir = path.join(householdsDir, hid, 'auth');
    if (!fs.existsSync(authDir)) continue;

    auth[hid] = {};
    for (const file of listYamlFiles(authDir)) {
      const service = path.basename(file, '.yml');
      const creds = readYaml(file);
      if (creds) {
        auth[hid][service] = creds;
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
