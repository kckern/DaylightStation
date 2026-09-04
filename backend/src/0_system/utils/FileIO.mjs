// backend/src/0_system/utils/FileIO.mjs
import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';
import axios from 'axios';

/**
 * Log actionable diagnostics for EACCES errors
 */
function logPermissionError(filePath, err) {
  if (err.code !== 'EACCES') return;
  let stat;
  try { stat = fs.statSync(filePath); } catch { /* ignore */ }
  if (!stat) try { stat = fs.statSync(path.dirname(filePath)); } catch { /* ignore */ }
  console.error(
    `[FileIO] EACCES writing ${filePath} — ` +
    `owner uid=${stat?.uid ?? '?'}, ` +
    `running as uid=${process.getuid?.() ?? '?'}. ` +
    `Fix: chown node:node "${filePath}"`
  );
}

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
 * @param {boolean} options.recursive - If true, also descend into subdirectories and return
 *   POSIX-style relative paths ("book/chapter"). Off by default: every existing caller
 *   treats the result as a flat list of ids.
 * @returns {string[]} Array of filenames
 */
export function listYamlFiles(dirPath, options = {}) {
  const { stripExtension = true, excludeHidden = true, recursive = false } = options;

  if (!fs.existsSync(dirPath)) return [];

  const isYaml = (f) => f.endsWith('.yml') || f.endsWith('.yaml');
  const hidden = (f) => f.startsWith('._') || f.startsWith('.');

  const walk = (dir, prefix) => {
    const out = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (excludeHidden && hidden(entry.name)) continue;
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        if (recursive) out.push(...walk(path.join(dir, entry.name), rel));
      } else if (isYaml(entry.name)) {
        out.push(rel);
      }
    }
    return out;
  };

  // Preserve the original (non-recursive) behaviour exactly: hidden-file filtering
  // there only ever excluded the "._" AppleDouble prefix.
  const files = recursive
    ? walk(dirPath, '')
    : fs.readdirSync(dirPath).filter(f => {
      if (excludeHidden && f.startsWith('._')) return false;
      return isYaml(f);
    });

  if (!stripExtension) return files;

  return files.map(f => f.replace(/\.(yml|yaml)$/, ''));
}

/**
 * List subdirectory names in a directory
 * @param {string} dirPath - Directory to list
 * @returns {string[]} Array of subdirectory names
 */
export function listSubdirectories(dirPath) {
  if (!fs.existsSync(dirPath)) return [];
  return fs.readdirSync(dirPath, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(d => d.name);
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

  try {
    const yamlContent = yaml.dump(content, { lineWidth: -1, ...options });
    fs.writeFileSync(filePath, yamlContent, 'utf8');
  } catch (err) {
    logPermissionError(filePath, err);
    throw err;
  }
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

/** Asynchronously ensure a directory exists. */
export async function ensureDirAsync(dirPath) {
  await fs.promises.mkdir(dirPath, { recursive: true });
}

/** Create a uniquely named temporary directory from a full prefix path. */
export async function createTempDir(prefix) {
  return fs.promises.mkdtemp(prefix);
}

/** Whether a path is executable by this process. */
export function isExecutable(filePath) {
  try { fs.accessSync(filePath, fs.constants.X_OK); return true; } catch { return false; }
}

/**
 * List subdirectories in a directory
 * @param {string} dirPath - Directory path
 * @returns {string[]} Array of directory names
 */
export function listDirs(dirPath) {
  if (!fs.existsSync(dirPath)) return [];
  // Use withFileTypes so the directory check comes from the single readdir call
  // rather than a per-entry statSync. On large histories (e.g. fitness/log/
  // with thousands of date-folders) this turns N+1 sync syscalls into one,
  // which is the dominant cost of the fitness /sessions + /suggestions queries.
  // Symlinks report isDirectory()=false from a dirent, so resolve only those few
  // with statSync — preserving the prior behavior of including symlinked dirs.
  try {
    const out = [];
    for (const d of fs.readdirSync(dirPath, { withFileTypes: true })) {
      if (d.isDirectory()) {
        out.push(d.name);
      } else if (d.isSymbolicLink()) {
        try {
          if (fs.statSync(path.join(dirPath, d.name)).isDirectory()) out.push(d.name);
        } catch {
          // dangling symlink — skip, matching the old statSync-in-try behavior
        }
      }
    }
    return out;
  } catch {
    return [];
  }
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
  // Use withFileTypes so the is-it-a-file check rides along on the single
  // scandir call instead of costing a statSync per entry. Measured on the
  // cloud-synced media tree (warm cache): 1,321-entry dir 9.4ms -> 0.9ms,
  // 3,866-entry dir 25.9ms -> 2.6ms, i.e. the same cost as a bare readdir.
  // Symlinks report isFile()===false from a dirent, so resolve just those with
  // statSync — preserving the previous behaviour of including symlinked files.
  try {
    const out = [];
    for (const entry of fs.readdirSync(dirPath, { withFileTypes: true })) {
      if (excludeHidden && entry.name.startsWith('._')) continue;
      if (entry.isFile()) {
        out.push(entry.name);
      } else if (entry.isSymbolicLink()) {
        try {
          if (fs.statSync(path.join(dirPath, entry.name)).isFile()) out.push(entry.name);
        } catch {
          // dangling symlink — skip, matching the old statSync-in-try behavior
        }
      }
    }
    return out;
  } catch {
    return [];
  }
}

/**
 * List directory entries without turning filesystem failures into an empty
 * result. Use when an adapter's caller must retain the native error contract.
 */
export function readDirectory(dirPath, options = undefined) {
  return options === undefined ? fs.readdirSync(dirPath) : fs.readdirSync(dirPath, options);
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
 * Read a text file without masking errors. Persistence adapters use this when
 * a missing file has a defined meaning but malformed/unreadable data must not
 * be silently treated as absent.
 */
export function readTextFromPath(filePath) {
  return fs.readFileSync(filePath, 'utf8');
}

/** Asynchronously read text without masking filesystem errors. */
export async function readTextFromPathAsync(filePath) {
  return fs.promises.readFile(filePath, 'utf8');
}

/** Asynchronously list directory entries without masking filesystem errors. */
export async function readDirectoryAsync(dirPath, options = undefined) {
  return options === undefined ? fs.promises.readdir(dirPath) : fs.promises.readdir(dirPath, options);
}

/** Asynchronously stat a path without masking filesystem errors. */
export async function getFileStatsAsync(filePath) {
  return fs.promises.stat(filePath);
}

/** Asynchronously test for a path while treating only absence as false. */
export async function fileExistsAsync(filePath) {
  try {
    await fs.promises.access(filePath);
    return true;
  } catch (error) {
    if (error?.code === 'ENOENT') return false;
    throw error;
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
  try {
    fs.writeFileSync(filePath, content, 'utf8');
  } catch (err) {
    logPermissionError(filePath, err);
    throw err;
  }
}

/** Asynchronously write text, creating the parent directory first. */
export async function writeTextFileAsync(filePath, content, options = {}) {
  const dir = path.dirname(filePath);
  await fs.promises.mkdir(dir, { recursive: true });
  try {
    await fs.promises.writeFile(filePath, content, { encoding: 'utf8', ...options });
  } catch (err) {
    logPermissionError(filePath, err);
    throw err;
  }
}

/**
 * Asynchronously write text without creating a parent directory. This retains
 * Node's native ENOENT contract for adapters whose configured storage root
 * must already exist.
 */
export async function writeTextFileStrictAsync(filePath, content) {
  try {
    await fs.promises.writeFile(filePath, content, 'utf8');
  } catch (err) {
    logPermissionError(filePath, err);
    throw err;
  }
}

/** Asynchronously rename a path, preserving Node's native failure contract. */
export async function renameFileAsync(sourcePath, destinationPath) {
  await fs.promises.rename(sourcePath, destinationPath);
}

/** Create a hard link while preserving native filesystem errors. */
export async function createHardLinkAsync(sourcePath, destinationPath) {
  await fs.promises.link(sourcePath, destinationPath);
}

/** Copy one file while preserving native filesystem errors. */
export async function copyFileAsync(sourcePath, destinationPath) {
  await fs.promises.copyFile(sourcePath, destinationPath);
}

/**
 * Write text only when a destination is absent. The native EEXIST error is
 * intentionally preserved for durable claim/receipt adapters.
 */
export function writeFileExclusive(filePath, content, { mode } = {}) {
  ensureDir(path.dirname(filePath));
  const options = { encoding: 'utf8', flag: 'wx', ...(mode === undefined ? {} : { mode }) };
  return fs.writeFileSync(filePath, content, options);
}

/** Append text to a file, creating its parent directory if needed. */
export function appendTextFile(filePath, content) {
  ensureDir(path.dirname(filePath));
  fs.appendFileSync(filePath, content, 'utf8');
}

/** Truncate an existing file to an exact byte length. */
export function truncateFile(filePath, length) {
  fs.truncateSync(filePath, length);
}

/**
 * Atomically replace a text file by staging beside it and renaming. Readers
 * observe either the old complete file or the new complete one, never the
 * truncated middle that `writeFile` briefly exposes.
 *
 * The text counterpart to `saveYamlToPathAtomic` / `writeBinaryAtomic`; it
 * existed for YAML and for buffers but not for plain text, which pushed
 * callers back onto `node:fs` for the one case it did not cover.
 * @param {string} filePath - Full file path
 * @param {string} content - File content
 */
export function writeFileAtomic(filePath, content) {
  const dir = path.dirname(filePath);
  ensureDir(dir);
  const stagingPath = atomicStagingPath(filePath);
  try {
    fs.writeFileSync(stagingPath, content, 'utf8');
    fs.renameSync(stagingPath, filePath);
  } catch (err) {
    try { if (fs.existsSync(stagingPath)) fs.unlinkSync(stagingPath); } catch { /* preserve original error */ }
    logPermissionError(filePath, err);
    throw err;
  }
}

/** Atomically move a prepared file into place on the same filesystem. */
export function renameFile(sourcePath, destinationPath) {
  fs.renameSync(sourcePath, destinationPath);
}

/** Set filesystem timestamps synchronously, preserving native errors. */
export function setFileTimes(filePath, atime, mtime) {
  fs.utimesSync(filePath, atime, mtime);
}

/**
 * Open a text/binary file for synchronous append, creating its parent
 * directory first. Kept here so adapter streaming sinks do not reach around
 * the central filesystem gateway for file-descriptor operations.
 * @param {string} filePath
 * @returns {number} file descriptor
 */
export function openFileForAppend(filePath) {
  ensureDir(path.dirname(filePath));
  return fs.openSync(filePath, 'a');
}

/** Create an append-mode write stream, creating its parent directory first. */
export function createAppendWriteStream(filePath) {
  ensureDir(path.dirname(filePath));
  return fs.createWriteStream(filePath, { flags: 'a' });
}

/** Create a write stream with caller-provided options. */
export function createWriteStream(filePath, options = undefined) {
  return options === undefined ? fs.createWriteStream(filePath) : fs.createWriteStream(filePath, options);
}

/** Create a read stream with caller-provided byte-range options. */
export function createReadStream(filePath, options = undefined) {
  return options === undefined ? fs.createReadStream(filePath) : fs.createReadStream(filePath, options);
}

/** Open a new file exclusively, preserving Node's EEXIST conflict signal. */
export function openFileExclusive(filePath) {
  ensureDir(path.dirname(filePath));
  return fs.openSync(filePath, 'wx');
}

/** Write a complete chunk to an open synchronous file descriptor. */
export function writeToFileDescriptor(fd, content) {
  const chunk = Buffer.isBuffer(content) ? content : Buffer.from(content);
  let offset = 0;
  while (offset < chunk.length) {
    const written = fs.writeSync(fd, chunk, offset, chunk.length - offset);
    if (!Number.isInteger(written) || written <= 0) {
      throw new Error(`File descriptor write made no progress at byte ${offset} of ${chunk.length}`);
    }
    offset += written;
  }
  return offset;
}

/** Close an open synchronous file descriptor. */
export function closeFileDescriptor(fd) {
  fs.closeSync(fd);
}

/** Flush an open synchronous file descriptor to durable storage. */
export function syncFileDescriptor(fd) {
  fs.fsyncSync(fd);
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
 * Load YAML from a known path without hiding read or parse failures.
 *
 * Use this when a caller must distinguish a missing file from corrupt or
 * unreadable data. `ENOENT` is deliberately left intact for the caller to
 * interpret; every other error is likewise preserved for logging or recovery.
 *
 * @param {string} filePath - Full path with extension
 * @returns {any} Parsed YAML content
 * @throws {Error} If the file cannot be read or parsed
 */
export function readYamlFromPath(filePath) {
  return yaml.load(fs.readFileSync(filePath, 'utf8'));
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
  try {
    const yamlContent = yaml.dump(content, { lineWidth: -1, ...options });
    fs.writeFileSync(filePath, yamlContent, 'utf8');
  } catch (err) {
    logPermissionError(filePath, err);
    throw err;
  }
}

/**
 * Atomically replace a YAML file by staging beside it and renaming. Readers
 * observe either the old complete document or the new complete document.
 */
export function saveYamlToPathAtomic(filePath, content, options = {}) {
  const { durable = false, ...yamlOptions } = options;
  const dir = path.dirname(filePath);
  ensureDir(dir);
  const stagingPath = atomicStagingPath(filePath);
  try {
    const yamlContent = yaml.dump(content, { lineWidth: -1, ...yamlOptions });
    fs.writeFileSync(stagingPath, yamlContent, 'utf8');
    if (durable) {
      const fd = fs.openSync(stagingPath, 'r');
      try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    }
    fs.renameSync(stagingPath, filePath);
    if (durable) {
      const fd = fs.openSync(dir, 'r');
      try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    }
  } catch (err) {
    try { if (fs.existsSync(stagingPath)) fs.unlinkSync(stagingPath); } catch { /* preserve original error */ }
    logPermissionError(filePath, err);
    throw err;
  }
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

/** Delete one path while preserving native filesystem errors for the caller. */
export function deleteFileStrict(filePath) {
  fs.unlinkSync(filePath);
}

/** Asynchronously delete one path while preserving native filesystem errors. */
export async function deleteFileStrictAsync(filePath) {
  await fs.promises.unlink(filePath);
}

/** Asynchronously remove a file, optionally treating absence as success. */
export async function removeFileAsync(filePath, { force = false } = {}) {
  await fs.promises.rm(filePath, { force });
}

/**
 * Delete a YAML file (tries both .yml and .yaml extensions)
 * @param {string} basePath - Path without extension
 * @returns {boolean} True if any file was deleted
 */
export function deleteYaml(basePath) {
  const ymlDeleted = deleteFile(`${basePath}.yml`);
  const yamlDeleted = deleteFile(`${basePath}.yaml`);
  return ymlDeleted || yamlDeleted;
}

/**
 * Delete a directory and all its contents recursively
 * @param {string} dirPath - Directory path
 * @returns {boolean} True if directory was deleted, false if didn't exist
 */
export function deleteDir(dirPath) {
  try {
    if (!fs.existsSync(dirPath)) return false;
    fs.rmSync(dirPath, { recursive: true, force: true });
    return true;
  } catch {
    return false;
  }
}

/** Asynchronously delete a directory tree, preserving native failures. */
export async function deleteDirAsync(dirPath, { force = false } = {}) {
  await fs.promises.rm(dirPath, { recursive: true, force });
}

/**
 * Write binary data to a file
 * @param {string} filePath - Full file path
 * @param {Buffer} buffer - Binary data
 */
export function writeBinary(filePath, buffer) {
  const dir = path.dirname(filePath);
  ensureDir(dir);
  try {
    fs.writeFileSync(filePath, buffer);
  } catch (err) {
    logPermissionError(filePath, err);
    throw err;
  }
}

/** Atomically replace a binary file using a same-directory staging file. */
export function writeBinaryAtomic(filePath, buffer) {
  const dir = path.dirname(filePath);
  ensureDir(dir);
  const stagingPath = atomicStagingPath(filePath);
  try {
    fs.writeFileSync(stagingPath, buffer);
    fs.renameSync(stagingPath, filePath);
  } catch (err) {
    try { if (fs.existsSync(stagingPath)) fs.unlinkSync(stagingPath); } catch { /* preserve original error */ }
    logPermissionError(filePath, err);
    throw err;
  }
}

/**
 * Read binary data from a file
 * @param {string} filePath - Full file path
 * @returns {Buffer|null} File content as Buffer, or null if doesn't exist
 */
export function readBinary(filePath) {
  try {
    if (!fs.existsSync(filePath)) return null;
    return fs.readFileSync(filePath);
  } catch {
    return null;
  }
}

/** Read binary content without masking missing, permission, or I/O errors. */
export function readBinaryFromPath(filePath) {
  return fs.readFileSync(filePath);
}

/** Asynchronously read binary content without masking filesystem errors. */
export async function readBinaryFromPathAsync(filePath) {
  return fs.promises.readFile(filePath);
}

/** Asynchronously write binary data, creating the parent directory first. */
export async function writeBinaryAsync(filePath, buffer) {
  await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
  try {
    await fs.promises.writeFile(filePath, buffer);
  } catch (err) {
    logPermissionError(filePath, err);
    throw err;
  }
}

/** Asynchronously create a binary file exclusively, preserving EEXIST. */
export async function writeBinaryExclusiveAsync(filePath, buffer) {
  await fs.promises.writeFile(filePath, buffer, { flag: 'wx' });
}

/**
 * Write binary content only if the destination does not already exist.
 * The caller receives Node's EEXIST error, which is important for immutable
 * artifact stores that distinguish a replay from a newly-created artifact.
 */
export function writeBinaryExclusive(filePath, buffer, { mode } = {}) {
  ensureDir(path.dirname(filePath));
  return fs.writeFileSync(filePath, buffer, { flag: 'wx', ...(mode === undefined ? {} : { mode }) });
}

function atomicStagingPath(filePath) {
  return `${filePath}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

/**
 * Get the basename of a file path
 * @param {string} filePath - Full file path
 * @returns {string} Filename without directory
 */
export function getBasename(filePath) {
  return path.basename(filePath);
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

/** Read filesystem metadata while preserving native filesystem errors. */
export function getFileStats(filePath) {
  return fs.statSync(filePath);
}

/**
 * Resolve a path through symlinks. Returns null when it cannot be resolved so
 * callers that intentionally tolerate a vanished/unreadable path can retain
 * their existing fallback behavior.
 */
export function resolveRealPath(filePath) {
  try {
    return fs.realpathSync(filePath);
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
// mtime-keyed directory-listing cache: dirPath -> { mtimeMs, files }.
// findFileByPrefix is called once per item for both the YAML and the media
// lookup, so a large readalong watchlist re-readdir'd the same 921-entry
// scripture directory hundreds of times. Caching the raw listing (invalidated
// when the directory mtime changes — i.e. a file is added/removed) collapses
// that to one read per directory per change.
const _dirListCache = new Map();

function _readdirCached(dirPath) {
  const stat = getStats(dirPath);
  if (!stat || !stat.isDirectory()) return null;
  const cached = _dirListCache.get(dirPath);
  if (cached && cached.mtimeMs === stat.mtimeMs) return cached.files;
  const files = fs.readdirSync(dirPath);
  _dirListCache.set(dirPath, { mtimeMs: stat.mtimeMs, files });
  return files;
}

export function findFileByPrefix(dirPath, prefix, extensions) {
  const all = _readdirCached(dirPath);
  if (!all) return null;

  // Normalize prefix: remove leading zeros for comparison
  const normalizedPrefix = String(prefix).replace(/^0+/, '') || '0';

  // Normalize extensions to array
  const extArray = Array.isArray(extensions) ? extensions : [extensions];

  const files = all.filter(f => {
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

// ============================================================
// Image operations
// ============================================================

/**
 * Save an image from a URL to the local filesystem.
 * Mirrors legacy io.mjs saveImage behavior:
 * - Creates directory if needed
 * - Skips download if file exists and is < 24 hours old
 * - Downloads as stream and saves as .jpg
 *
 * @param {string} url - Source URL of the image
 * @param {string} baseDir - Base directory for images (e.g., media/img)
 * @param {string} folder - Subfolder name (e.g., 'lists', 'shopping')
 * @param {string} uid - Unique identifier for the file (becomes filename)
 * @returns {Promise<string|false>} File path on success, false on failure
 */
export async function saveImage(url, baseDir, folder, uid) {
  if (!url) return false;

  const filePath = path.join(baseDir, folder, `${uid}.jpg`);
  const dirPath = path.dirname(filePath);

  // Ensure directory exists
  ensureDir(dirPath);

  // Check if file already exists and is fresh (< 24 hours old)
  if (fs.existsSync(filePath)) {
    try {
      const stats = fs.statSync(filePath);
      const fileAgeMs = Date.now() - stats.mtimeMs;
      const oneDayMs = 24 * 60 * 60 * 1000;
      if (fileAgeMs < oneDayMs) {
        return filePath; // Skip download, file is fresh
      }
    } catch {
      // Stats failed, proceed with download
    }
  }

  try {
    const response = await axios({
      method: 'get',
      url: url,
      responseType: 'stream',
    });

    const writer = fs.createWriteStream(filePath);
    response.data.pipe(writer);

    return new Promise((resolve, reject) => {
      writer.on('finish', () => resolve(filePath));
      writer.on('error', reject);
    });
  } catch {
    return false;
  }
}

/**
 * Create an IO adapter with saveImage bound to a specific media directory.
 * Useful for passing to harvesters that expect io.saveImage(url, folder, uid).
 *
 * @param {string} mediaImgDir - Base directory for images (e.g., '/data/media/img')
 * @returns {Object} IO adapter with saveImage method
 */
export function createImageIO(mediaImgDir) {
  return {
    /**
     * Save image to folder/uid.jpg under the configured media directory
     * @param {string} url - Source URL
     * @param {string} folder - Subfolder name
     * @param {string} uid - Unique ID (filename without extension)
     * @returns {Promise<string|false>}
     */
    saveImage: (url, folder, uid) => saveImage(url, mediaImgDir, folder, uid),
  };
}
