/**
 * Admin Content Router
 *
 * CRUD endpoints for managing household watchlist content.
 *
 * Endpoints:
 * - GET    /lists              - List all folders with item counts
 * - POST   /lists              - Create new folder
 * - GET    /lists/:folder      - Get items in folder
 * - PUT    /lists/:folder      - Replace folder contents (reorder)
 * - DELETE /lists/:folder      - Delete entire folder
 * - POST   /lists/:folder/items          - Add item to folder
 * - PUT    /lists/:folder/items/:index   - Update item at index
 * - DELETE /lists/:folder/items/:index   - Remove item at index
 */
import express from 'express';
import path from 'path';
import {
  loadYamlSafe,
  saveYaml,
  listYamlFiles,
  ensureDir,
  deleteYaml
} from '#system/utils/FileIO.mjs';
import {
  ValidationError,
  NotFoundError,
  ConflictError
} from '#system/utils/errors/index.mjs';

// Validation pattern for folder names (lowercase, alphanumeric, hyphens)
const FOLDER_NAME_PATTERN = /^[a-z0-9-]+$/;

/**
 * Convert display name to kebab-case folder name
 * @param {string} name - Display name (e.g., "Morning Program")
 * @returns {string} - Kebab-case name (e.g., "morning-program")
 */
function toKebabCase(name) {
  return name
    .toLowerCase()
    .trim()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '');
}

/**
 * Create Admin Content Router
 *
 * @param {Object} config
 * @param {Object} config.userDataService - UserDataService for household paths
 * @param {Object} config.configService - ConfigService for default household
 * @param {Object} [config.logger] - Logger instance
 * @returns {express.Router}
 */
export function createAdminContentRouter(config) {
  const {
    userDataService,
    configService,
    logger = console
  } = config;

  const router = express.Router();

  /**
   * Get the watchlists directory path for a household
   */
  function getWatchlistsDir(householdId) {
    const hid = householdId || configService.getDefaultHouseholdId();
    const basePath = userDataService.getHouseholdPath(hid);
    return path.join(basePath, 'config', 'watchlists');
  }

  /**
   * Get full path to a watchlist file
   */
  function getWatchlistPath(folder, householdId) {
    const watchlistsDir = getWatchlistsDir(householdId);
    return path.join(watchlistsDir, folder);
  }

  // =============================================================================
  // Folder Endpoints
  // =============================================================================

  /**
   * GET /lists - List all folders with item counts
   */
  router.get('/lists', (req, res) => {
    const householdId = req.query.household || configService.getDefaultHouseholdId();

    try {
      const watchlistsDir = getWatchlistsDir(householdId);

      // Get all YAML files in the watchlists directory
      const folderNames = listYamlFiles(watchlistsDir);

      // Build folder list with counts
      const folders = folderNames.map(name => {
        const items = loadYamlSafe(path.join(watchlistsDir, name)) || [];
        return {
          name,
          count: Array.isArray(items) ? items.length : 0,
          path: `config/watchlists/${name}.yml`
        };
      });

      logger.info?.('admin.lists.listed', { household: householdId, folderCount: folders.length });

      res.json({
        folders,
        household: householdId
      });
    } catch (error) {
      logger.error?.('admin.lists.list.failed', { error: error.message, household: householdId });
      res.status(500).json({ error: 'Failed to list folders' });
    }
  });

  /**
   * POST /lists - Create new folder
   */
  router.post('/lists', (req, res) => {
    const householdId = req.query.household || configService.getDefaultHouseholdId();
    const { name } = req.body || {};

    if (!name || typeof name !== 'string' || !name.trim()) {
      throw new ValidationError('Folder name is required', { field: 'name' });
    }

    const folderName = toKebabCase(name);

    if (!FOLDER_NAME_PATTERN.test(folderName)) {
      throw new ValidationError('Invalid folder name', {
        field: 'name',
        hint: 'Use alphanumeric characters and hyphens only'
      });
    }

    const watchlistsDir = getWatchlistsDir(householdId);
    const watchlistPath = path.join(watchlistsDir, folderName);

    // Check if folder already exists
    const existing = loadYamlSafe(watchlistPath);
    if (existing !== null) {
      throw new ConflictError('Folder already exists', { folder: folderName });
    }

    try {
      // Ensure the watchlists directory exists
      ensureDir(watchlistsDir);

      // Create empty folder
      saveYaml(watchlistPath, []);

      logger.info?.('admin.lists.created', { folder: folderName, household: householdId });

      res.status(201).json({
        ok: true,
        folder: folderName,
        path: `config/watchlists/${folderName}.yml`
      });
    } catch (error) {
      logger.error?.('admin.lists.create.failed', { folder: folderName, error: error.message });
      res.status(500).json({ error: 'Failed to create folder' });
    }
  });

  /**
   * GET /lists/:folder - Get items in folder
   */
  router.get('/lists/:folder', (req, res) => {
    const { folder } = req.params;
    const householdId = req.query.household || configService.getDefaultHouseholdId();

    const watchlistPath = getWatchlistPath(folder, householdId);
    const items = loadYamlSafe(watchlistPath);

    if (items === null) {
      throw new NotFoundError('Folder', folder);
    }

    // Ensure items is an array and add indices
    const itemsArray = Array.isArray(items) ? items : [];
    const indexedItems = itemsArray.map((item, index) => ({
      index,
      ...item
    }));

    logger.info?.('admin.lists.folder.loaded', { folder, count: indexedItems.length, household: householdId });

    res.json({
      folder,
      items: indexedItems,
      count: indexedItems.length,
      household: householdId
    });
  });

  /**
   * PUT /lists/:folder - Replace folder contents (for reordering)
   */
  router.put('/lists/:folder', (req, res) => {
    const { folder } = req.params;
    const householdId = req.query.household || configService.getDefaultHouseholdId();
    const { items } = req.body || {};

    if (!items || !Array.isArray(items)) {
      throw new ValidationError('Items array is required', { field: 'items' });
    }

    const watchlistPath = getWatchlistPath(folder, householdId);

    // Check if folder exists
    const existing = loadYamlSafe(watchlistPath);
    if (existing === null) {
      throw new NotFoundError('Folder', folder);
    }

    try {
      // Remove index field if present (it's computed, not stored)
      const cleanItems = items.map(({ index, ...item }) => item);

      saveYaml(watchlistPath, cleanItems);

      logger.info?.('admin.lists.reordered', { folder, count: cleanItems.length, household: householdId });

      res.json({
        ok: true,
        folder,
        count: cleanItems.length
      });
    } catch (error) {
      logger.error?.('admin.lists.reorder.failed', { folder, error: error.message });
      res.status(500).json({ error: 'Failed to update folder' });
    }
  });

  /**
   * DELETE /lists/:folder - Delete entire folder
   */
  router.delete('/lists/:folder', (req, res) => {
    const { folder } = req.params;
    const householdId = req.query.household || configService.getDefaultHouseholdId();

    const watchlistPath = getWatchlistPath(folder, householdId);

    // Check if folder exists
    const existing = loadYamlSafe(watchlistPath);
    if (existing === null) {
      throw new NotFoundError('Folder', folder);
    }

    try {
      deleteYaml(watchlistPath);

      logger.info?.('admin.lists.deleted', { folder, household: householdId });

      res.json({
        ok: true,
        deleted: { folder }
      });
    } catch (error) {
      logger.error?.('admin.lists.delete.failed', { folder, error: error.message });
      res.status(500).json({ error: 'Failed to delete folder' });
    }
  });

  // =============================================================================
  // Item Endpoints
  // =============================================================================

  /**
   * POST /lists/:folder/items - Add item to folder
   */
  router.post('/lists/:folder/items', (req, res) => {
    const { folder } = req.params;
    const householdId = req.query.household || configService.getDefaultHouseholdId();
    const { label, input, action = 'Play', active = true, image = null } = req.body || {};

    // Validate required fields
    if (!label || typeof label !== 'string' || !label.trim()) {
      throw new ValidationError('Missing required field', { field: 'label' });
    }
    if (!input || typeof input !== 'string' || !input.trim()) {
      throw new ValidationError('Missing required field', { field: 'input' });
    }

    const watchlistPath = getWatchlistPath(folder, householdId);
    const items = loadYamlSafe(watchlistPath);

    if (items === null) {
      throw new NotFoundError('Folder', folder);
    }

    try {
      const itemsArray = Array.isArray(items) ? items : [];

      // Build new item
      const newItem = {
        label: label.trim(),
        input: input.trim(),
        action,
        active
      };

      // Only add image if provided
      if (image) {
        newItem.image = image;
      }

      itemsArray.push(newItem);
      saveYaml(watchlistPath, itemsArray);

      const newIndex = itemsArray.length - 1;

      logger.info?.('admin.lists.item.added', { folder, index: newIndex, label, household: householdId });

      res.status(201).json({
        ok: true,
        index: newIndex,
        folder
      });
    } catch (error) {
      logger.error?.('admin.lists.item.add.failed', { folder, label, error: error.message });
      res.status(500).json({ error: 'Failed to add item' });
    }
  });

  /**
   * PUT /lists/:folder/items/:index - Update item at index
   */
  router.put('/lists/:folder/items/:index', (req, res) => {
    const { folder, index: indexStr } = req.params;
    const householdId = req.query.household || configService.getDefaultHouseholdId();
    const updates = req.body || {};

    const index = parseInt(indexStr, 10);
    if (isNaN(index) || index < 0) {
      throw new ValidationError('Invalid index', { field: 'index' });
    }

    const watchlistPath = getWatchlistPath(folder, householdId);
    const items = loadYamlSafe(watchlistPath);

    if (items === null) {
      throw new NotFoundError('Folder', folder);
    }

    const itemsArray = Array.isArray(items) ? items : [];

    if (index >= itemsArray.length) {
      throw new NotFoundError('Item', index, { folder });
    }

    try {
      // Merge updates with existing item
      const existingItem = itemsArray[index];
      const updatedItem = { ...existingItem };

      // Apply updates (only for allowed fields)
      if (updates.label !== undefined) updatedItem.label = updates.label;
      if (updates.input !== undefined) updatedItem.input = updates.input;
      if (updates.action !== undefined) updatedItem.action = updates.action;
      if (updates.active !== undefined) updatedItem.active = updates.active;
      if (updates.image !== undefined) updatedItem.image = updates.image;

      itemsArray[index] = updatedItem;
      saveYaml(watchlistPath, itemsArray);

      logger.info?.('admin.lists.item.updated', { folder, index, household: householdId });

      res.json({
        ok: true,
        index,
        folder
      });
    } catch (error) {
      logger.error?.('admin.lists.item.update.failed', { folder, index, error: error.message });
      res.status(500).json({ error: 'Failed to update item' });
    }
  });

  /**
   * DELETE /lists/:folder/items/:index - Remove item at index
   */
  router.delete('/lists/:folder/items/:index', (req, res) => {
    const { folder, index: indexStr } = req.params;
    const householdId = req.query.household || configService.getDefaultHouseholdId();

    const index = parseInt(indexStr, 10);
    if (isNaN(index) || index < 0) {
      throw new ValidationError('Invalid index', { field: 'index' });
    }

    const watchlistPath = getWatchlistPath(folder, householdId);
    const items = loadYamlSafe(watchlistPath);

    if (items === null) {
      throw new NotFoundError('Folder', folder);
    }

    const itemsArray = Array.isArray(items) ? items : [];

    if (index >= itemsArray.length) {
      throw new NotFoundError('Item', index, { folder });
    }

    try {
      const deletedItem = itemsArray[index];
      itemsArray.splice(index, 1);
      saveYaml(watchlistPath, itemsArray);

      logger.info?.('admin.lists.item.deleted', { folder, index, label: deletedItem.label, household: householdId });

      res.json({
        ok: true,
        deleted: {
          index,
          label: deletedItem.label
        }
      });
    } catch (error) {
      logger.error?.('admin.lists.item.delete.failed', { folder, index, error: error.message });
      res.status(500).json({ error: 'Failed to delete item' });
    }
  });

  return router;
}

export default createAdminContentRouter;
