import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';

// Small local copy of backend/src/0_system/utils/deepMerge.mjs's semantics.
// Duplicated (not imported) on purpose: vite.config.js loads at Vite startup
// via frontend/'s own package.json, which has no "#backend/*" subpath import,
// so reaching into backend/ here would mean a brittle relative cross-package
// path. Keep this in sync with the backend original if its merge rules change.
//   - `undefined` override values are skipped (base value preserved).
//   - Arrays are replaced wholesale (override wins), never concatenated.
//   - Non-null, non-object override values replace the base value.
//   - A `null` override does NOT overwrite an existing base value.
export function deepMerge(base, over) {
  if (over === undefined) return base;
  if (Array.isArray(base) || Array.isArray(over)) return over ?? base;
  if (typeof base !== 'object' || base === null) return over ?? base;
  if (typeof over !== 'object' || over === null) return over ?? base;
  const out = { ...base };
  for (const [k, v] of Object.entries(over)) {
    if (v === undefined) continue;
    out[k] = (k in base) ? deepMerge(base[k], v) : v;
  }
  return out;
}

export const DEFAULT_APP_PORT = 3111;

function defaultReadYaml(filePath) {
  return yaml.load(fs.readFileSync(filePath, 'utf8'));
}

/**
 * Resolve the dev-server app/backend ports from system config.
 *
 * Mirrors ConfigService.getAppPort() / backend configLoader.mjs's
 * loadSystemConfig: read base system.yml, then deep-merge
 * system-local.<env>.yml OVER it (local wins, base fills gaps) — the local
 * file must never *replace* the base file wholesale, which was the bug this
 * function fixes (a host with a local-override file that omits `app`
 * silently lost every base `app.ports` value).
 *
 * @param {object} [opts]
 * @param {string} [opts.dataPath] - resolved data directory (system/config lives under it)
 * @param {string} [opts.envName] - DAYLIGHT_ENV
 * @param {(p: string) => boolean} [opts.exists] - injectable for tests
 * @param {(p: string) => object|null} [opts.readYaml] - injectable for tests
 * @returns {{ app: number, backend: number, usedDefault: boolean }}
 */
export function resolvePorts({
  dataPath,
  envName,
  exists = fs.existsSync,
  readYaml = defaultReadYaml,
} = {}) {
  if (!dataPath || !envName) {
    return { app: DEFAULT_APP_PORT, backend: DEFAULT_APP_PORT + 1, usedDefault: true };
  }

  const baseConfigPath = path.join(dataPath, 'system', 'config', 'system.yml');
  const localConfigPath = path.join(dataPath, 'system', 'config', `system-local.${envName}.yml`);

  const baseExists = exists(baseConfigPath);
  const localExists = exists(localConfigPath);
  const baseConfig = baseExists ? (readYaml(baseConfigPath) ?? {}) : {};
  const localConfig = localExists ? (readYaml(localConfigPath) ?? {}) : {};

  const config = deepMerge(baseConfig, localConfig);

  // Match ConfigService.getAppPort(): app.ports.{env} or legacy app.port
  const ports = config?.app?.ports;
  const appPort = (ports && typeof ports === 'object')
    ? (ports[envName] ?? ports.default ?? DEFAULT_APP_PORT)
    : (config?.app?.port ?? DEFAULT_APP_PORT);
  const backendPort = appPort + 1; // Backend always +1 in dev (Vite only runs in dev)

  // Neither YAML existed on disk: whatever port fell out of the merge is the
  // hardcoded default, not a resolved value — say so, so callers don't log it
  // as "resolved from config" and suppress the fallback warning.
  const usedDefault = !baseExists && !localExists;

  return { app: appPort, backend: backendPort, usedDefault };
}

export default resolvePorts;
