// backend/src/0_infrastructure/utils/FileIO.mjs
import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';

/**
 * FileIO - Centralized filesystem gateway for the DDD backend.
 *
 * ALL file operations in adapters/services MUST go through these utilities.
 * NEVER use direct fs.* calls outside of this file.
 *
 * Features:
 * - Automatic .yml/.yaml extension resolution for YAML files
 * - Path containment validation for security
 * - Consistent error handling
 */

/**
 * Resolve a path to an existing YAML file, trying .yml first then .yaml
 * @param {string} basePath - Path without extension (e.g., '/data/content/scripture/bom/sebom/31103')
 * @returns {string|null} Full path to existing file, or null if neither exists
 */
export function resolveYamlPath(basePath) {
  // If basePath already has extension, check if it exists
  if (basePath.endsWith('.yml') || basePath.endsWith('.yaml')) {
    return fs.existsSync(basePath) ? basePath : null;
  }

  const ymlPath = `${basePath}.yml`;
  if (fs.existsSync(ymlPath)) return ymlPath;

  const yamlPath = `${basePath}.yaml`;
  if (fs.existsSync(yamlPath)) return yamlPath;

  return null;
}

/**
 * Check if a YAML file exists (either .yml or .yaml extension)
 * @param {string} basePath - Path without extension
 * @returns {boolean}
 */
export function yamlExists(basePath) {
  return resolveYamlPath(basePath) !== null;
}

/**
 * Load and parse a YAML file, trying .yml first then .yaml
 * @param {string} basePath - Path without extension
 * @returns {any|null} Parsed YAML content, or null if file doesn't exist
 * @throws {Error} If file exists but parsing fails
 */
export function loadYaml(basePath) {
  const resolvedPath = resolveYamlPath(basePath);
  if (!resolvedPath) return null;

  const content = fs.readFileSync(resolvedPath, 'utf8');
  return yaml.load(content);
}

/**
 * Load a YAML file with error handling (returns null on parse error)
 * @param {string} basePath - Path without extension
 * @returns {any|null} Parsed YAML content, or null if file doesn't exist or fails to parse
 */
export function loadYamlSafe(basePath) {
  try {
    return loadYaml(basePath);
  } catch {
    return null;
  }
}

/**
 * List all YAML files in a directory (both .yml and .yaml)
 * @param {string} dirPath - Directory path
 * @param {Object} options
 * @param {boolean} options.stripExtension - If true, return filenames without extension (default: true)
 * @param {boolean} options.excludeHidden - If true, exclude files starting with ._ (default: true)
 * @returns {string[]} Array of filenames
 */
export function listYamlFiles(dirPath, options = {}) {
  const { stripExtension = true, excludeHidden = true } = options;

  if (!fs.existsSync(dirPath)) return [];

  const files = fs.readdirSync(dirPath).filter(f => {
    if (excludeHidden && f.startsWith('._')) return false;
    return f.endsWith('.yml') || f.endsWith('.yaml');
  });

  if (!stripExtension) return files;

  return files.map(f => f.replace(/\.(yml|yaml)$/, ''));
}

/**
 * Save content as YAML file (always uses .yml extension)
 * @param {string} basePath - Path without extension
 * @param {any} content - Content to serialize
 * @param {Object} options - js-yaml dump options
 */
export function saveYaml(basePath, content, options = {}) {
  const filePath = basePath.endsWith('.yml') || basePath.endsWith('.yaml')
    ? basePath
    : `${basePath}.yml`;

  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const yamlContent = yaml.dump(content, { lineWidth: -1, ...options });
  fs.writeFileSync(filePath, yamlContent, 'utf8');
}

/**
 * Build a validated path that stays within a base directory
 * @param {string} baseDir - Base directory (containment boundary)
 * @param {string} relativePath - Relative path to resolve
 * @returns {string|null} Resolved path if valid, null if escapes containment
 */
export function buildContainedPath(baseDir, relativePath) {
  // Normalize to resolve any . or .. segments
  const normalizedPath = path.normalize(relativePath).replace(/^(\.\.[/\\])+/, '');
  const candidatePath = path.resolve(baseDir, normalizedPath);

  // Ensure path stays within base directory
  if (!candidatePath.startsWith(baseDir + path.sep) && candidatePath !== baseDir) {
    return null;
  }

  return candidatePath;
}

/**
 * Resolve a contained YAML file path (combines containment validation with extension resolution)
 * @param {string} baseDir - Base directory (containment boundary)
 * @param {string} relativePath - Relative path without extension
 * @returns {string|null} Full path to existing file, or null if invalid/doesn't exist
 */
export function resolveContainedYaml(baseDir, relativePath) {
  const basePath = buildContainedPath(baseDir, relativePath);
  if (!basePath) return null;
  return resolveYamlPath(basePath);
}

/**
 * Load a contained YAML file (combines containment validation with loading)
 * @param {string} baseDir - Base directory (containment boundary)
 * @param {string} relativePath - Relative path without extension
 * @returns {any|null} Parsed content, or null if invalid/doesn't exist
 */
export function loadContainedYaml(baseDir, relativePath) {
  const basePath = buildContainedPath(baseDir, relativePath);
  if (!basePath) return null;
  return loadYamlSafe(basePath);
}

// ============================================================
// Directory utilities
// ============================================================

/**
 * Check if a directory exists
 * @param {string} dirPath - Directory path
 * @returns {boolean}
 */
export function dirExists(dirPath) {
  try {
    return fs.existsSync(dirPath) && fs.statSync(dirPath).isDirectory();
  } catch {
    return false;
  }
}

/**
 * Check if a file exists (any type)
 * @param {string} filePath - File path
 * @returns {boolean}
 */
export function fileExists(filePath) {
  return fs.existsSync(filePath);
}

/**
 * Ensure a directory exists, creating it if necessary
 * @param {string} dirPath - Directory path
 */
export function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

/**
 * List subdirectories in a directory
 * @param {string} dirPath - Directory path
 * @returns {string[]} Array of directory names
 */
export function listDirs(dirPath) {
  if (!fs.existsSync(dirPath)) return [];
  return fs.readdirSync(dirPath).filter(f => {
    try {
      return fs.statSync(path.join(dirPath, f)).isDirectory();
    } catch {
      return false;
    }
  });
}

/**
 * List all files in a directory (non-recursive)
 * @param {string} dirPath - Directory path
 * @param {Object} options
 * @param {boolean} options.excludeHidden - Exclude files starting with ._ (default: true)
 * @returns {string[]} Array of filenames
 */
export function listFiles(dirPath, options = {}) {
  const { excludeHidden = true } = options;
  if (!fs.existsSync(dirPath)) return [];
  return fs.readdirSync(dirPath).filter(f => {
    if (excludeHidden && f.startsWith('._')) return false;
    try {
      return fs.statSync(path.join(dirPath, f)).isFile();
    } catch {
      return false;
    }
  });
}

// ============================================================
// Raw file operations (for non-YAML files)
// ============================================================

/**
 * Read a file as string (for non-YAML files)
 * @param {string} filePath - Full file path
 * @returns {string|null} File content, or null if doesn't exist
 */
export function readFile(filePath) {
  try {
    if (!fs.existsSync(filePath)) return null;
    return fs.readFileSync(filePath, 'utf8');
  } catch {
    return null;
  }
}

/**
 * Write a file (for non-YAML files)
 * @param {string} filePath - Full file path
 * @param {string} content - File content
 */
export function writeFile(filePath, content) {
  const dir = path.dirname(filePath);
  ensureDir(dir);
  fs.writeFileSync(filePath, content, 'utf8');
}

/**
 * Load YAML from a full path (when extension is already known)
 * @param {string} filePath - Full file path with extension
 * @returns {any|null} Parsed content, or null if doesn't exist
 */
export function loadYamlFromPath(filePath) {
  try {
    if (!fs.existsSync(filePath)) return null;
    const content = fs.readFileSync(filePath, 'utf8');
    return yaml.load(content);
  } catch {
    return null;
  }
}

/**
 * Save YAML to a full path (when extension is already known)
 * @param {string} filePath - Full file path with extension
 * @param {any} content - Content to serialize
 * @param {Object} options - js-yaml dump options
 */
export function saveYamlToPath(filePath, content, options = {}) {
  const dir = path.dirname(filePath);
  ensureDir(dir);
  const yamlContent = yaml.dump(content, { lineWidth: -1, ...options });
  fs.writeFileSync(filePath, yamlContent, 'utf8');
}

/**
 * Delete a file if it exists
 * @param {string} filePath - Full file path
 * @returns {boolean} True if file was deleted, false if didn't exist
 */
export function deleteFile(filePath) {
  try {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

/**
 * Write binary data to a file
 * @param {string} filePath - Full file path
 * @param {Buffer} buffer - Binary data
 */
export function writeBinary(filePath, buffer) {
  const dir = path.dirname(filePath);
  ensureDir(dir);
  fs.writeFileSync(filePath, buffer);
}

/**
 * Check if a path is a file (not directory)
 * @param {string} filePath - Path to check
 * @returns {boolean}
 */
export function isFile(filePath) {
  try {
    return fs.existsSync(filePath) && fs.statSync(filePath).isFile();
  } catch {
    return false;
  }
}

/**
 * Get file stats
 * @param {string} filePath - File path
 * @returns {fs.Stats|null}
 */
export function getStats(filePath) {
  try {
    return fs.statSync(filePath);
  } catch {
    return null;
  }
}

/**
 * List directory entries (files and dirs)
 * @param {string} dirPath - Directory path
 * @returns {string[]} Array of entry names
 */
export function listEntries(dirPath) {
  if (!fs.existsSync(dirPath)) return [];
  return fs.readdirSync(dirPath);
}

/**
 * List directories matching a pattern
 * @param {string} dirPath - Directory to search
 * @param {RegExp} pattern - Pattern to match directory names
 * @returns {string[]} Matching directory names
 */
export function listDirsMatching(dirPath, pattern) {
  return listDirs(dirPath).filter(d => pattern.test(d));
}

/**
 * Find a file by numeric prefix in a directory.
 * Files are named like "0017-some-title.ext" and matched by prefix "17" or "0017".
 * @param {string} dirPath - Directory to search
 * @param {string|number} prefix - Numeric prefix to match (e.g., '17', '0017', '017', 17)
 * @param {string|string[]} extensions - File extension(s) to match (e.g., '.yml' or ['.yml', '.yaml'])
 * @returns {string|null} Full path to matching file, or null if not found
 */
export function findFileByPrefix(dirPath, prefix, extensions) {
  if (!fs.existsSync(dirPath)) return null;

  // Normalize prefix: remove leading zeros for comparison
  const normalizedPrefix = String(prefix).replace(/^0+/, '') || '0';

  // Normalize extensions to array
  const extArray = Array.isArray(extensions) ? extensions : [extensions];

  const files = fs.readdirSync(dirPath).filter(f => {
    if (f.startsWith('._')) return false;
    return extArray.some(ext => f.endsWith(ext));
  });

  const match = files.find(file => {
    // Extract leading digits from filename
    const m = file.match(/^(\d+)/);
    if (!m) return false;
    // Remove leading zeros for comparison
    const fileNum = m[1].replace(/^0+/, '') || '0';
    return fileNum === normalizedPrefix;
  });

  return match ? path.join(dirPath, match) : null;
}

/**
 * Find a YAML file by numeric prefix in a directory.
 * Files are named like "0017-some-title.yml" and matched by prefix "17" or "0017".
 * @param {string} dirPath - Directory to search
 * @param {string|number} prefix - Numeric prefix to match (e.g., '17', '0017', '017', 17)
 * @returns {string|null} Full path to matching file, or null if not found
 */
export function findYamlByPrefix(dirPath, prefix) {
  return findFileByPrefix(dirPath, prefix, ['.yml', '.yaml']);
}

/**
 * Find a media file by numeric prefix in a directory.
 * Files are named like "0017-some-title.mp3" and matched by prefix "17" or "0017".
 * @param {string} dirPath - Directory to search
 * @param {string|number} prefix - Numeric prefix to match
 * @returns {string|null} Full path to matching file, or null if not found
 */
export function findMediaFileByPrefix(dirPath, prefix) {
  return findFileByPrefix(dirPath, prefix, ['.mp3', '.m4a', '.wav', '.flac', '.ogg']);
}

/**
 * Load a YAML file by numeric prefix in a directory.
 * Combines findYamlByPrefix with YAML parsing.
 * @param {string} dirPath - Directory to search
 * @param {string|number} prefix - Numeric prefix to match
 * @returns {any|null} Parsed YAML content, or null if not found
 */
export function loadYamlByPrefix(dirPath, prefix) {
  const filePath = findYamlByPrefix(dirPath, prefix);
  if (!filePath) return null;
  return loadYamlFromPath(filePath);
}
