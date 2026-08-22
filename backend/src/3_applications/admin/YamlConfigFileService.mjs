/**
 * YamlConfigFileService - Application service for the admin YAML config editor.
 *
 * SECURITY-SENSITIVE. Owns the directory allow/mask policy, path-traversal
 * guard, and YAML parse/dump logic that the admin config router used to inline.
 * The router becomes a thin shell: GET /files → listFiles(), GET /files/* →
 * readFile(), PUT /files/* → writeFile(). All guard failures throw typed errors
 * that the router's string error-middleware maps to HTTP status:
 *   ValidationError    → 400 (bad path, non-YAML, invalid/undumpable YAML, no body)
 *   AuthorizationError → 403 (traversal, masked dir, not-allowed dir)
 *   NotFoundError      → 404 (allowed file missing)
 *
 * Security semantics are preserved VERBATIM from the router, plus an
 * explicit-file addendum for task-13:
 * - Allowed dirs: system/config (list + read + write)
 * - Allowed files: individual app configs colocated with their own domain
 *   folder (household/fitness/config.yml, etc.), DERIVED from the household
 *   config registry (shared/contracts/householdConfig.mjs) — listed one file
 *   at a time, NOT as a directory grant. A directory grant on
 *   e.g. household/fitness would also expose household/fitness/log/, a
 *   2000+-entry session-telemetry tree that has nothing to do with config.
 *   MASKED_DIRS is checked BEFORE this list, so no allowlist entry — derived
 *   or hand-added — can ever reach household/auth or system/auth.
 * - Masked dirs:  system/auth, household/auth (listed, but NOT readable/writable)
 * - Directory checks run on the NORMALIZED relative path derived from the
 *   RESOLVED absolute path (prevents ../auth bypass), after an absolute
 *   within-data-root traversal check.
 */
import path from 'path';
import fs from 'fs';
import yaml from 'js-yaml';
import {
  ValidationError,
  NotFoundError,
  AuthorizationError
} from '#system/utils/errors/index.mjs';
import { HOUSEHOLD_APP_CONFIGS } from '#shared/contracts/householdConfig.mjs';

// Directories users can list, read, and write (relative to data root).
// `household/config` was removed in Phase E along with the directory itself —
// every household app config is now reached through ALLOWED_FILES, derived from
// the registry.
const ALLOWED_DIRS = [
  'system/config'
];

/**
 * Individual files the admin YAML browser may read and write, even though they
 * sit outside ALLOWED_DIRS.
 *
 * DERIVED from the household config registry — deliberately a file allowlist,
 * never a directory one: a grant on `household/fitness` would also expose
 * `household/fitness/log/`, a 2000+-entry session-telemetry tree that has
 * nothing to do with config.
 *
 * This list used to be hand-maintained and it drifted: it shipped covering 3 of
 * the 11 files task-13 colocated, silently 403ing the other 8 with no error
 * anywhere — a file missing here is uneditable with no signal at all. Deriving
 * it means adding an app to the registry is the only edit an app needs.
 *
 * BOTH extensions are derived per registry entry. The registry stores paths
 * WITHOUT an extension because every runtime reader resolves .yml OR .yaml via
 * `resolveYamlPath`; appending only `.yml` here would let an app whose file
 * landed as `.yaml` boot fine and then 403 in the admin YAML browser — exactly
 * the silent, signal-free failure this derivation exists to kill. Listing a
 * path that does not exist on disk costs nothing: `listFiles` skips missing
 * files, and read/write still hit the real fs.
 */
const bothExtensions = (rel) => [`household/${rel}.yml`, `household/${rel}.yaml`];

export const ALLOWED_FILES = Object.freeze([
  ...Object.values(HOUSEHOLD_APP_CONFIGS).flatMap(bothExtensions),
  // Not an app config: no dedicated write surface exists — IntegrationsQueryService
  // (backend/src/3_applications/admin/IntegrationsQueryService.mjs) has ZERO write
  // methods, so without this entry the file is editable only by shelling into the
  // container. household.yml and hardware/devices.yml DO have real dedicated write
  // surfaces and correctly stay off this list.
  'household/integrations.yml',
  'household/media/content-prefixes.yml',
  // Trigger bindings, not an app config — but it WAS admin-editable via
  // AppsConfigService before this migration. Without this entry, moving
  // keyboard.yml out of the app registry would silently take away the only UI
  // for editing the Office Keypad bindings.
  'household/triggers/bindings/keyboard.yml',
]);

// Directories that appear in file listings but cannot be read or written
const MASKED_DIRS = [
  'system/auth',
  'household/auth'
];

// All directories that appear in listings
const ALL_DIRS = [...ALLOWED_DIRS, ...MASKED_DIRS];

/**
 * Check if a relative file path falls within a masked directory
 * @param {string} relPath - Path relative to data root
 * @returns {boolean}
 */
function isMasked(relPath) {
  const normalized = relPath.replace(/\\/g, '/');
  return MASKED_DIRS.some(dir => normalized.startsWith(dir + '/') || normalized === dir);
}

/**
 * Check if a relative file path falls within an allowed directory
 * @param {string} relPath - Path relative to data root
 * @returns {boolean}
 */
function isAllowed(relPath) {
  const normalized = relPath.replace(/\\/g, '/');
  return ALLOWED_DIRS.some(dir => normalized.startsWith(dir + '/') || normalized === dir)
    || ALLOWED_FILES.includes(normalized);
}

/**
 * Validate that a resolved absolute path stays within the data root.
 * Prevents path traversal attacks.
 * @param {string} absPath - Resolved absolute path
 * @param {string} dataRoot - Resolved absolute data root
 * @returns {boolean}
 */
function isWithinDataRoot(absPath, dataRoot) {
  const resolved = path.resolve(absPath);
  const root = path.resolve(dataRoot);
  return resolved.startsWith(root + path.sep) || resolved === root;
}

/**
 * Recursively collect YAML files from a directory
 * @param {string} dirPath - Absolute directory path
 * @param {string} dataRoot - Absolute data root for computing relative paths
 * @returns {Array<Object>} File metadata objects
 */
function collectYamlFiles(dirPath, dataRoot) {
  const results = [];
  if (!fs.existsSync(dirPath)) return results;

  const entries = fs.readdirSync(dirPath, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory() && !entry.isSymbolicLink()) {
      results.push(...collectYamlFiles(fullPath, dataRoot));
    } else if (entry.isFile() && /\.ya?ml$/i.test(entry.name)) {
      const relPath = path.relative(dataRoot, fullPath).replace(/\\/g, '/');
      const stat = fs.statSync(fullPath);
      results.push({
        path: relPath,
        name: entry.name,
        directory: path.dirname(relPath),
        size: stat.size,
        modified: stat.mtime.toISOString(),
        masked: isMasked(relPath)
      });
    }
  }
  return results;
}

export class YamlConfigFileService {
  /**
   * @param {Object} deps
   * @param {Object} deps.configService - ConfigService for data directory paths
   * @param {Object} [deps.logger=console] - Logger instance
   */
  constructor({ configService, logger = console }) {
    if (!configService) {
      throw new Error('YamlConfigFileService requires a configService dependency');
    }
    this.configService = configService;
    this.logger = logger;
  }

  /** Get the resolved data root directory */
  #getDataRoot() {
    return path.resolve(this.configService.getDataDir());
  }

  /**
   * Resolve a caller-supplied relative path, enforcing the YAML-only,
   * traversal, mask, and allow-list guards. Returns the resolved absolute path
   * plus the NORMALIZED relative path.
   * @param {string} rawPath
   * @param {'read'|'write'} op
   * @returns {{ absPath: string, relPath: string, dataRoot: string }}
   */
  #resolveGuarded(rawPath, op) {
    if (!rawPath) {
      throw new ValidationError('File path is required', { code: 'PATH_REQUIRED' });
    }

    // YAML files only
    if (!/\.ya?ml$/i.test(rawPath)) {
      throw new ValidationError(`Only YAML files (.yml, .yaml) can be ${op === 'write' ? 'written' : 'read'}`, {
        code: 'NOT_YAML'
      });
    }

    const dataRoot = this.#getDataRoot();
    const absPath = path.resolve(dataRoot, rawPath);

    // Path traversal protection
    if (!isWithinDataRoot(absPath, dataRoot)) {
      this.logger.error?.(`admin.config.file.${op}.blocked`, { path: rawPath, reason: 'path traversal' });
      throw new AuthorizationError('Access denied: path outside data root', { code: 'PATH_TRAVERSAL' });
    }

    // Use NORMALIZED relative path for directory checks (prevents ../auth bypass)
    const relPath = path.relative(dataRoot, absPath).replace(/\\/g, '/');

    // Check if file is in a masked directory
    if (isMasked(relPath)) {
      this.logger.error?.(`admin.config.file.${op}.blocked`, { path: relPath, reason: 'masked' });
      throw new AuthorizationError('Access denied: file is in a protected directory', { code: 'MASKED' });
    }

    // Check if file is in an allowed directory
    if (!isAllowed(relPath)) {
      this.logger.error?.(`admin.config.file.${op}.blocked`, { path: relPath, reason: 'not allowed' });
      throw new AuthorizationError('Access denied: file is not in an allowed directory', { code: 'NOT_ALLOWED' });
    }

    return { absPath, relPath, dataRoot };
  }

  /**
   * List all editable/listed config files (allowed + masked dirs).
   * @returns {{ files: Array<Object>, count: number }}
   */
  listFiles() {
    const dataRoot = this.#getDataRoot();
    const files = [];

    for (const dir of ALL_DIRS) {
      const absDir = path.join(dataRoot, dir);
      files.push(...collectYamlFiles(absDir, dataRoot));
    }

    // Individual colocated files — listed one at a time, not via directory
    // recursion. See the ALLOWED_FILES comment for why.
    for (const relPath of ALLOWED_FILES) {
      // Defence in depth: the file list is DERIVED, so a future registry entry
      // under household/auth would land here. read/write already refuse it
      // (isMasked runs before isAllowed), but without this guard the listing
      // would show a SECOND row for it with masked:false and the admin UI would
      // offer an edit affordance for a secret. Mask wins in the listing too.
      if (isMasked(relPath)) continue;
      const absPath = path.join(dataRoot, relPath);
      if (!fs.existsSync(absPath)) continue;
      const stat = fs.statSync(absPath);
      files.push({
        path: relPath,
        name: path.basename(relPath),
        directory: path.dirname(relPath),
        size: stat.size,
        modified: stat.mtime.toISOString(),
        masked: false
      });
    }

    this.logger.info?.('admin.config.files.listed', { count: files.length });
    return { files, count: files.length };
  }

  /**
   * Read a config file's raw + parsed contents.
   * @param {string} rawPath - Caller-supplied path relative to data root
   * @returns {{ path, name, raw, parsed, size, modified }}
   * @throws {ValidationError|AuthorizationError|NotFoundError}
   */
  readFile(rawPath) {
    const { absPath, relPath } = this.#resolveGuarded(rawPath, 'read');

    if (!fs.existsSync(absPath)) {
      throw new NotFoundError('File not found', undefined, { path: relPath, code: 'NOT_FOUND' });
    }

    const raw = fs.readFileSync(absPath, 'utf8');
    let parsed;
    try {
      parsed = yaml.load(raw);
    } catch (parseError) {
      // File exists but has invalid YAML - return raw with parse error
      parsed = null;
      this.logger.info?.('admin.config.file.read.parse_warning', { path: relPath, error: parseError.message });
    }

    const stat = fs.statSync(absPath);
    this.logger.info?.('admin.config.file.read', { path: relPath, size: stat.size });

    return {
      path: relPath,
      name: path.basename(absPath),
      raw,
      parsed,
      size: stat.size,
      modified: stat.mtime.toISOString()
    };
  }

  /**
   * Write a config file from either a raw YAML string or a parsed object.
   * @param {string} rawPath - Caller-supplied path relative to data root
   * @param {{ raw?: string, parsed?: Object }} content
   * @returns {{ ok: true, path, size, modified }}
   * @throws {ValidationError|AuthorizationError}
   */
  writeFile(rawPath, content = {}) {
    const { absPath, relPath } = this.#resolveGuarded(rawPath, 'write');

    const { raw, parsed } = content || {};

    if (raw === undefined && parsed === undefined) {
      throw new ValidationError('Request body must include either "raw" (YAML string) or "parsed" (object)', {
        code: 'EMPTY_BODY'
      });
    }

    let yamlContent;

    if (raw !== undefined) {
      // Validate that the raw string is valid YAML
      try {
        yaml.load(raw);
      } catch (parseError) {
        throw new ValidationError('Invalid YAML syntax', {
          code: 'INVALID_YAML',
          details: {
            message: parseError.message,
            line: parseError.mark?.line,
            column: parseError.mark?.column
          }
        });
      }
      yamlContent = raw;
    } else {
      // Convert parsed object to YAML
      try {
        yamlContent = yaml.dump(parsed, {
          indent: 2,
          lineWidth: -1,
          noRefs: true,
          sortKeys: false
        });
      } catch (dumpError) {
        throw new ValidationError('Failed to serialize object to YAML', {
          code: 'YAML_DUMP_FAILED',
          details: { message: dumpError.message }
        });
      }
    }

    // Ensure parent directory exists
    const parentDir = path.dirname(absPath);
    if (!fs.existsSync(parentDir)) {
      fs.mkdirSync(parentDir, { recursive: true });
    }

    fs.writeFileSync(absPath, yamlContent, 'utf8');

    const stat = fs.statSync(absPath);
    this.logger.info?.('admin.config.file.written', { path: relPath, size: stat.size });

    return {
      ok: true,
      path: relPath,
      size: stat.size,
      modified: stat.mtime.toISOString()
    };
  }
}

export default YamlConfigFileService;
