/**
 * Screens API Router
 * Serves screen configurations from YAML files
 *
 * @module api/v1/routers/screens
 */
import express from 'express';
import { promises as fs } from 'fs';
import path from 'path';
import yaml from 'js-yaml';
import { asyncHandler } from '#system/http/middleware/index.mjs';
import { resolvePreset } from '#adapters/content/art/presetResolver.mjs';
import { loadArtmodeConfig, loadArtCollections } from '#adapters/content/art/artmodeConfig.mjs';

/**
 * Create Screens API router
 *
 * @param {Object} config
 * @param {string} config.householdDir - Resolved household base dir (ConfigService.getHouseholdPath(''))
 * @param {Object} [config.logger] - Logger instance
 * @returns {express.Router}
 */
export function createScreensRouter(config = {}) {
  const { householdDir, logger = console } = config;
  const router = express.Router();

  /**
   * GET /screens
   * List available screens
   */
  router.get(
    '/',
    asyncHandler(async (req, res) => {
      const screensDir = path.join(householdDir, 'screens');

      try {
        const files = await fs.readdir(screensDir);
        // Keep the real filename — `.yaml` screens exist and re-appending
        // `.yml` to a stripped id would read the wrong path.
        const entries = files
          .filter(f => f.endsWith('.yml') || f.endsWith('.yaml'))
          .map(f => ({ id: f.replace(/\.ya?ml$/, ''), file: f }));

        // Each entry carries the screen's declared CSS-pixel `resolution` so a
        // caller that must render AT a screen's scale (the admin preview) sizes
        // itself from one request instead of N detail fetches. A file that fails
        // to parse degrades to id-only rather than failing the whole list.
        let unreadable = 0;
        const usable = (v) => Number.isFinite(v) && v > 0;
        const screens = await Promise.all(entries.map(async ({ id, file }) => {
          try {
            const raw = await fs.readFile(path.join(screensDir, file), 'utf-8');
            const cfg = yaml.load(raw) || {};
            const r = cfg.resolution;
            // A zero or negative dimension is not a size to render at; collapse
            // it into `null` so the caller takes its defined fallback instead of
            // laying out at nothing with no signal anything is wrong.
            const resolution = (usable(r?.width) && usable(r?.height))
              ? { width: r.width, height: r.height }
              : null;
            return { id, name: cfg.name || cfg.screen || id, resolution };
          } catch (err) {
            unreadable += 1;
            logger.warn?.('screens.list.unreadable', { id, code: err.code, error: err.message });
            return { id, name: id, resolution: null };
          }
        }));

        // `unreadable` turns a directory-wide failure — where every screen
        // degrades to null and the body still looks like a plausible "nobody
        // declares a resolution" — into one greppable line.
        logger.debug?.('screens.list.success', { count: screens.length, unreadable });
        res.json({ screens });
      } catch (err) {
        if (err.code === 'ENOENT') {
          // Directory doesn't exist yet
          logger.debug?.('screens.list.empty', { reason: 'directory not found' });
          res.json({ screens: [] });
        } else {
          throw err;
        }
      }
    })
  );

  /**
   * GET /screens/:screenId
   * Get screen configuration by ID
   */
  router.get(
    '/:screenId',
    asyncHandler(async (req, res) => {
      const { screenId } = req.params;

      // Validate screenId contains only safe characters (prevent path traversal)
      if (!/^[a-zA-Z0-9_-]+$/.test(screenId)) {
        logger.warn?.('screens.get.invalid_id', { screenId });
        return res.status(400).json({
          error: 'Invalid screen ID',
          message: 'Screen ID must contain only letters, numbers, hyphens, and underscores'
        });
      }

      const screenPath = path.join(householdDir, 'screens', `${screenId}.yml`);

      try {
        const content = await fs.readFile(screenPath, 'utf-8');
        const config = yaml.load(content);

        // Validate required fields
        if (!config.screen) {
          logger.warn?.('screens.get.invalid', { screenId, reason: 'missing screen field' });
          return res.status(400).json({
            error: 'Invalid screen config',
            message: 'Missing required "screen" field'
          });
        }

        // Expand an ArtMode screensaver preset reference into resolved props.
        // `defaults` + the named-frame catalog merge beneath the preset; a bare
        // collection name (no preset) resolves via collection-fallback.
        if (config.screensaver?.preset) {
          const { presets, defaults, frames } = await loadArtmodeConfig(householdDir, logger);
          const collections = await loadArtCollections(householdDir, logger);
          const presetKey = config.screensaver.preset;
          const known = Object.prototype.hasOwnProperty.call(presets, presetKey)
            || Object.prototype.hasOwnProperty.call(collections, presetKey);
          if (!known) {
            logger.warn?.('screens.preset.unknown', { screenId, preset: presetKey });
          }
          config.screensaver.props = resolvePreset(
            presets, presetKey, config.screensaver.props || {}, { defaults, frames, collections });
        }

        logger.debug?.('screens.get.success', { screenId });
        res.json(config);
      } catch (err) {
        if (err.code === 'ENOENT') {
          logger.debug?.('screens.get.notfound', { screenId });
          return res.status(404).json({
            error: 'Screen not found',
            screenId
          });
        }
        logger.error?.('screens.get.error', { screenId, error: err.message });
        throw err;
      }
    })
  );

  // ==========================================================================
  // Error Handler Middleware
  // ==========================================================================

  router.use((err, req, res, next) => {
    logger.error?.('screens.router.error', {
      error: err.message,
      stack: err.stack,
      url: req.url,
      method: req.method,
    });
    res.status(500).json({ error: err.message });
  });

  return router;
}

export default createScreensRouter;
