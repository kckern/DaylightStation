/**
 * Admin Apps Config Router
 *
 * Lists and reads/writes per-app config files within the household config directory.
 * A thin, purpose-built layer that maps friendly app IDs to their config file paths.
 *
 * Endpoints (all under /api/v1/admin/apps):
 * - GET    /             - List all known apps with config file existence check
 * - GET    /:appId/config - Read app config (parsed + raw)
 * - PUT    /:appId/config - Write app config (accepts raw YAML or parsed object)
 */
import express from 'express';
import path from 'path';
import fs from 'fs';
import yaml from 'js-yaml';

/**
 * Registry mapping app IDs to their config file paths (relative to data root)
 */
const APP_CONFIGS = {
  fitness: 'household/config/fitness.yml',
  finance: 'household/config/finance.yml',
  gratitude: 'household/config/gratitude.yml',
  shopping: 'household/config/harvesters.yml',
  media: 'household/config/media-app.yml',
  chatbots: 'household/config/chatbots.yml',
  entropy: 'household/config/entropy.yml',
  keyboard: 'household/config/keyboard.yml',
  piano: 'household/config/piano.yml',
};

/**
 * Create Admin Apps Config Router
 *
 * @param {Object} config
 * @param {Object} config.configService - ConfigService for data directory paths
 * @param {Object} [config.logger] - Logger instance
 * @returns {express.Router}
 */
export function createAdminAppsRouter(config) {
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
  // GET / - List all known apps with config file metadata
  // ===========================================================================

  router.get('/', (req, res) => {
    try {
      const dataRoot = getDataRoot();
      const apps = Object.entries(APP_CONFIGS).map(([appId, configPath]) => {
        const absPath = path.join(dataRoot, configPath);
        const exists = fs.existsSync(absPath);
        let size = null, modified = null;
        if (exists) {
          const stat = fs.statSync(absPath);
          size = stat.size;
          modified = stat.mtime.toISOString();
        }
        return { appId, configPath, exists, size, modified };
      });

      logger.info?.('admin.apps.listed', { count: apps.length });
      res.json({ apps });
    } catch (error) {
      logger.error?.('admin.apps.list.failed', { error: error.message });
      res.status(500).json({ error: 'Failed to list apps' });
    }
  });

  // ===========================================================================
  // GET /:appId/config - Read app config file
  // ===========================================================================

  router.get('/:appId/config', (req, res) => {
    try {
      const appId = req.params.appId;
      const configPath = APP_CONFIGS[appId];
      if (!configPath) {
        return res.status(404).json({ error: `Unknown app "${appId}"` });
      }

      const dataRoot = getDataRoot();
      const absPath = path.join(dataRoot, configPath);

      if (!fs.existsSync(absPath)) {
        return res.status(404).json({ error: `Config file not found for "${appId}"` });
      }

      const raw = fs.readFileSync(absPath, 'utf8');
      let parsed;
      try {
        parsed = yaml.load(raw);
      } catch (e) {
        parsed = null;
      }

      const stat = fs.statSync(absPath);

      logger.info?.('admin.apps.config.read', { appId });
      res.json({
        appId,
        configPath,
        raw,
        parsed,
        size: stat.size,
        modified: stat.mtime.toISOString()
      });
    } catch (error) {
      logger.error?.('admin.apps.config.read.failed', { error: error.message });
      res.status(500).json({ error: 'Failed to read app config' });
    }
  });

  // ===========================================================================
  // PUT /:appId/config - Write app config file
  // ===========================================================================

  router.put('/:appId/config', (req, res) => {
    try {
      const appId = req.params.appId;
      const configPath = APP_CONFIGS[appId];
      if (!configPath) {
        return res.status(404).json({ error: `Unknown app "${appId}"` });
      }

      const { raw, parsed } = req.body || {};

      if (raw === undefined && parsed === undefined) {
        return res.status(400).json({ error: 'Must provide either "raw" or "parsed"' });
      }

      let content;

      if (raw !== undefined) {
        // Validate that the raw string is valid YAML
        try {
          yaml.load(raw);
        } catch (parseError) {
          return res.status(400).json({
            error: 'Invalid YAML',
            details: { message: parseError.message, mark: parseError.mark }
          });
        }
        content = raw;
      } else {
        content = yaml.dump(parsed, { indent: 2, lineWidth: -1, noRefs: true });
      }

      const dataRoot = getDataRoot();
      const absPath = path.join(dataRoot, configPath);
      const dir = path.dirname(absPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      fs.writeFileSync(absPath, content, 'utf8');

      const stat = fs.statSync(absPath);

      logger.info?.('admin.apps.config.written', { appId });
      res.json({
        ok: true,
        appId,
        configPath,
        size: stat.size,
        modified: stat.mtime.toISOString()
      });
    } catch (error) {
      if (error instanceof yaml.YAMLException) {
        return res.status(400).json({
          error: 'Invalid YAML',
          details: { message: error.message, mark: error.mark }
        });
      }
      logger.error?.('admin.apps.config.write.failed', { error: error.message });
      res.status(500).json({ error: 'Failed to write app config' });
    }
  });

  return router;
}

export default createAdminAppsRouter;
