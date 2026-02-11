/**
 * Admin Config Router
 *
 * Generic CRUD for YAML config files within allowed data directories.
 * Provides the backbone for the YAML editor fallback and purpose-built config forms.
 *
 * Endpoints (all under /api/v1/admin/config):
 * - GET    /files       - List all editable config files with metadata
 * - GET    /files/*     - Read file contents (raw YAML + parsed object)
 * - PUT    /files/*     - Write file (accepts raw YAML string or parsed object)
 *
 * Allowed directories (relative to data root):
 *   system/config, household/config
 *
 * Masked directories (listed but not readable/writable):
 *   system/auth, household/auth
 */
import express from 'express';
import path from 'path';
import fs from 'fs';
import yaml from 'js-yaml';

// Directories users can list, read, and write (relative to data root)
const ALLOWED_DIRS = [
  'system/config',
  'household/config'
];

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
  return ALLOWED_DIRS.some(dir => normalized.startsWith(dir + '/') || normalized === dir);
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

/**
 * Create Admin Config Router
 *
 * @param {Object} config
 * @param {Object} config.configService - ConfigService for data directory paths
 * @param {Object} [config.logger] - Logger instance
 * @returns {express.Router}
 */
export function createAdminConfigRouter(config) {
  const {
    configService,
    logger = console
  } = config;

  const router = express.Router();

  /**
   * Get the resolved data root directory
   */
  function getDataRoot() {
    return path.resolve(configService.getDataDir());
  }

  // ===========================================================================
  // GET /files - List all editable config files
  // ===========================================================================

  router.get('/files', (req, res) => {
    try {
      const dataRoot = getDataRoot();
      const files = [];

      for (const dir of ALL_DIRS) {
        const absDir = path.join(dataRoot, dir);
        files.push(...collectYamlFiles(absDir, dataRoot));
      }

      logger.info?.('admin.config.files.listed', { count: files.length });

      res.json({ files, count: files.length });
    } catch (error) {
      logger.error?.('admin.config.files.list.failed', { error: error.message });
      res.status(500).json({ error: 'Failed to list config files' });
    }
  });

  // ===========================================================================
  // GET /files/* - Read a config file
  // ===========================================================================

  router.get('/files/*', (req, res) => {
    try {
      const rawPath = req.params[0];
      if (!rawPath) {
        return res.status(400).json({ error: 'File path is required' });
      }

      // YAML files only
      if (!/\.ya?ml$/i.test(rawPath)) {
        return res.status(400).json({ error: 'Only YAML files (.yml, .yaml) can be read' });
      }

      const dataRoot = getDataRoot();
      const absPath = path.resolve(dataRoot, rawPath);

      // Path traversal protection
      if (!isWithinDataRoot(absPath, dataRoot)) {
        logger.error?.('admin.config.file.read.blocked', { path: rawPath, reason: 'path traversal' });
        return res.status(403).json({ error: 'Access denied: path outside data root' });
      }

      // Use NORMALIZED relative path for directory checks (prevents ../auth bypass)
      const relPath = path.relative(dataRoot, absPath).replace(/\\/g, '/');

      // Check if file is in a masked directory
      if (isMasked(relPath)) {
        logger.error?.('admin.config.file.read.blocked', { path: relPath, reason: 'masked' });
        return res.status(403).json({ error: 'Access denied: file is in a protected directory' });
      }

      // Check if file is in an allowed directory
      if (!isAllowed(relPath)) {
        logger.error?.('admin.config.file.read.blocked', { path: relPath, reason: 'not allowed' });
        return res.status(403).json({ error: 'Access denied: file is not in an allowed directory' });
      }

      // Check file exists
      if (!fs.existsSync(absPath)) {
        return res.status(404).json({ error: 'File not found', path: relPath });
      }

      const raw = fs.readFileSync(absPath, 'utf8');
      let parsed;
      try {
        parsed = yaml.load(raw);
      } catch (parseError) {
        // File exists but has invalid YAML - return raw with parse error
        parsed = null;
        logger.info?.('admin.config.file.read.parse_warning', { path: relPath, error: parseError.message });
      }

      const stat = fs.statSync(absPath);

      logger.info?.('admin.config.file.read', { path: relPath, size: stat.size });

      res.json({
        path: relPath,
        name: path.basename(absPath),
        raw,
        parsed,
        size: stat.size,
        modified: stat.mtime.toISOString()
      });
    } catch (error) {
      logger.error?.('admin.config.file.read.failed', { error: error.message });
      res.status(500).json({ error: 'Failed to read config file' });
    }
  });

  // ===========================================================================
  // PUT /files/* - Write a config file
  // ===========================================================================

  router.put('/files/*', (req, res) => {
    try {
      const rawPath = req.params[0];
      if (!rawPath) {
        return res.status(400).json({ error: 'File path is required' });
      }

      // YAML files only
      if (!/\.ya?ml$/i.test(rawPath)) {
        return res.status(400).json({ error: 'Only YAML files (.yml, .yaml) can be written' });
      }

      const dataRoot = getDataRoot();
      const absPath = path.resolve(dataRoot, rawPath);

      // Path traversal protection
      if (!isWithinDataRoot(absPath, dataRoot)) {
        logger.error?.('admin.config.file.write.blocked', { path: rawPath, reason: 'path traversal' });
        return res.status(403).json({ error: 'Access denied: path outside data root' });
      }

      // Use NORMALIZED relative path for directory checks (prevents ../auth bypass)
      const relPath = path.relative(dataRoot, absPath).replace(/\\/g, '/');

      // Check if file is in a masked directory
      if (isMasked(relPath)) {
        logger.error?.('admin.config.file.write.blocked', { path: relPath, reason: 'masked' });
        return res.status(403).json({ error: 'Access denied: file is in a protected directory' });
      }

      // Check if file is in an allowed directory
      if (!isAllowed(relPath)) {
        logger.error?.('admin.config.file.write.blocked', { path: relPath, reason: 'not allowed' });
        return res.status(403).json({ error: 'Access denied: file is not in an allowed directory' });
      }

      const { raw, parsed } = req.body || {};

      if (raw === undefined && parsed === undefined) {
        return res.status(400).json({ error: 'Request body must include either "raw" (YAML string) or "parsed" (object)' });
      }

      let yamlContent;

      if (raw !== undefined) {
        // Validate that the raw string is valid YAML
        try {
          yaml.load(raw);
        } catch (parseError) {
          return res.status(400).json({
            error: 'Invalid YAML syntax',
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
          return res.status(400).json({
            error: 'Failed to serialize object to YAML',
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

      logger.info?.('admin.config.file.written', { path: relPath, size: stat.size });

      res.json({
        ok: true,
        path: relPath,
        size: stat.size,
        modified: stat.mtime.toISOString()
      });
    } catch (error) {
      logger.error?.('admin.config.file.write.failed', { error: error.message });
      res.status(500).json({ error: 'Failed to write config file' });
    }
  });

  return router;
}

export default createAdminConfigRouter;
