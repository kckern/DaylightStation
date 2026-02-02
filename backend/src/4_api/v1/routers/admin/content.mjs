/**
 * Admin Content Router
 *
 * CRUD endpoints for managing household config lists.
 *
 * Config Lists come in three types:
 * - menus: Navigation structures (listable only, may contain non-playables)
 * - watchlists: Content pools with progress tracking (listable + queueable)
 * - programs: Ordered sequences for scheduled playback (listable + queueable)
 *
 * Endpoints:
 * - GET    /lists                     - List all types with counts
 * - GET    /lists/:type               - List all lists of a type
 * - POST   /lists/:type               - Create new list
 * - GET    /lists/:type/:name         - Get items in list
 * - PUT    /lists/:type/:name/settings       - Update list metadata
 * - PUT    /lists/:type/:name         - Replace list contents (reorder)
 * - DELETE /lists/:type/:name         - Delete entire list
 * - POST   /lists/:type/:name/items          - Add item to list
 * - PUT    /lists/:type/:name/items/:index   - Update item at index
 * - DELETE /lists/:type/:name/items/:index   - Remove item at index
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

// Valid list types
const LIST_TYPES = ['menus', 'watchlists', 'programs'];

// Validation pattern for list names (lowercase, alphanumeric, hyphens)
const LIST_NAME_PATTERN = /^[a-z0-9-]+$/;

/**
 * Convert display name to kebab-case list name
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
 * Parse list file content - supports both old (array) and new (object with items) formats
 * @param {string} filename - List filename (without extension)
 * @param {any} content - Parsed YAML content
 * @returns {Object} - Normalized list object with metadata and items
 */
function parseListContent(filename, content) {
  // Old format: array at root
  if (Array.isArray(content)) {
    return {
      title: formatFilename(filename),
      items: content
    };
  }

  // New format: object with items key
  if (content && typeof content === 'object') {
    return {
      title: content.title || formatFilename(filename),
      description: content.description || null,
      group: content.group || null,
      icon: content.icon || null,
      sorting: content.sorting || 'manual',
      days: content.days || null,
      active: content.active !== false,
      defaultAction: content.defaultAction || 'Play',
      defaultVolume: content.defaultVolume || null,
      defaultPlaybackRate: content.defaultPlaybackRate || null,
      items: Array.isArray(content.items) ? content.items : []
    };
  }

  // Fallback for empty/null
  return {
    title: formatFilename(filename),
    items: []
  };
}

/**
 * Convert filename to display title
 * @param {string} filename - Kebab-case filename
 * @returns {string} - Title case display name
 */
function formatFilename(filename) {
  if (!filename || typeof filename !== 'string') {
    return 'Untitled';
  }
  return filename
    .replace(/-/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase());
}

/**
 * Serialize list to YAML-ready object (new format, omitting defaults)
 * @param {Object} list - List object with metadata and items
 * @returns {Object} - Clean object for YAML serialization
 */
function serializeList(list) {
  const output = {};

  // Only write non-default metadata
  if (list.title) output.title = list.title;
  if (list.description) output.description = list.description;
  if (list.group) output.group = list.group;
  if (list.icon) output.icon = list.icon;
  if (list.sorting && list.sorting !== 'manual') output.sorting = list.sorting;
  if (list.days) output.days = list.days;
  if (list.active === false) output.active = false;
  if (list.defaultAction && list.defaultAction !== 'Play') output.defaultAction = list.defaultAction;
  if (list.defaultVolume != null) output.defaultVolume = list.defaultVolume;
  if (list.defaultPlaybackRate != null) output.defaultPlaybackRate = list.defaultPlaybackRate;

  output.items = list.items;

  return output;
}

/**
 * Validate list type parameter
 */
function validateType(type) {
  if (!LIST_TYPES.includes(type)) {
    throw new ValidationError(`Invalid list type: ${type}`, {
      field: 'type',
      hint: `Must be one of: ${LIST_TYPES.join(', ')}`
    });
  }
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
   * Get the lists base directory for a household
   */
  function getListsBaseDir(householdId) {
    const hid = householdId || configService.getDefaultHouseholdId();
    const basePath = userDataService.getHouseholdDir(hid);
    return path.join(basePath, 'config', 'lists');
  }

  /**
   * Get directory for a specific list type
   */
  function getTypeDir(type, householdId) {
    return path.join(getListsBaseDir(householdId), type);
  }

  /**
   * Get full path to a list file
   */
  function getListPath(type, listName, householdId) {
    return path.join(getTypeDir(type, householdId), listName);
  }

  // =============================================================================
  // Overview Endpoint
  // =============================================================================

  /**
   * GET /lists - Overview of all list types with counts
   */
  router.get('/lists', (req, res) => {
    const householdId = req.query.household || configService.getDefaultHouseholdId();

    try {
      const baseDir = getListsBaseDir(householdId);

      const summary = LIST_TYPES.map(type => {
        const typeDir = path.join(baseDir, type);
        const names = listYamlFiles(typeDir);
        return {
          type,
          count: names.length,
          path: `config/lists/${type}`
        };
      });

      const total = summary.reduce((sum, t) => sum + t.count, 0);

      logger.info?.('admin.lists.overview', { household: householdId, total });

      res.json({
        types: summary,
        total,
        household: householdId
      });
    } catch (error) {
      logger.error?.('admin.lists.overview.failed', { error: error.message, household: householdId });
      res.status(500).json({ error: 'Failed to get lists overview' });
    }
  });

  // =============================================================================
  // Type-Level Endpoints
  // =============================================================================

  /**
   * GET /lists/:type - List all lists of a specific type
   */
  router.get('/lists/:type', (req, res) => {
    const { type } = req.params;
    const householdId = req.query.household || configService.getDefaultHouseholdId();

    validateType(type);

    try {
      const typeDir = getTypeDir(type, householdId);
      const listNames = listYamlFiles(typeDir);

      const lists = listNames.map(name => {
        const content = loadYamlSafe(path.join(typeDir, name));
        const list = parseListContent(name, content);
        // parseListContent already normalizes all fields with proper defaults
        return {
          name,
          title: list.title,
          description: list.description,
          group: list.group,
          icon: list.icon,
          sorting: list.sorting,
          days: list.days,
          active: list.active,
          itemCount: list.items.length
        };
      });

      logger.info?.('admin.lists.type.listed', { type, household: householdId, count: lists.length });

      res.json({
        type,
        lists,
        household: householdId
      });
    } catch (error) {
      logger.error?.('admin.lists.type.list.failed', { type, error: error.message, household: householdId });
      res.status(500).json({ error: `Failed to list ${type}` });
    }
  });

  /**
   * POST /lists/:type - Create new list of a specific type
   */
  router.post('/lists/:type', (req, res) => {
    const { type } = req.params;
    const householdId = req.query.household || configService.getDefaultHouseholdId();
    const { name } = req.body || {};

    validateType(type);

    if (!name || typeof name !== 'string' || !name.trim()) {
      throw new ValidationError('List name is required', { field: 'name' });
    }

    const listName = toKebabCase(name);

    if (!LIST_NAME_PATTERN.test(listName)) {
      throw new ValidationError('Invalid list name', {
        field: 'name',
        hint: 'Use alphanumeric characters and hyphens only'
      });
    }

    const typeDir = getTypeDir(type, householdId);
    const listPath = path.join(typeDir, listName);

    // Check if list already exists
    const existing = loadYamlSafe(listPath);
    if (existing !== null) {
      throw new ConflictError('List already exists', { type, list: listName });
    }

    try {
      // Ensure the type directory exists
      ensureDir(typeDir);

      // Create empty list with new object format
      saveYaml(listPath, { items: [] });

      logger.info?.('admin.lists.created', { type, list: listName, household: householdId });

      res.status(201).json({
        ok: true,
        type,
        list: listName,
        path: `config/lists/${type}/${listName}.yml`
      });
    } catch (error) {
      logger.error?.('admin.lists.create.failed', { type, list: listName, error: error.message });
      res.status(500).json({ error: 'Failed to create list' });
    }
  });

  // =============================================================================
  // List-Level Endpoints
  // =============================================================================

  /**
   * GET /lists/:type/:name - Get full list with metadata and items
   */
  router.get('/lists/:type/:name', (req, res) => {
    const { type, name: listName } = req.params;
    const householdId = req.query.household || configService.getDefaultHouseholdId();

    validateType(type);

    const listPath = getListPath(type, listName, householdId);
    const content = loadYamlSafe(listPath);

    if (content === null) {
      throw new NotFoundError('List', `${type}/${listName}`);
    }

    // Parse list content to get metadata and items
    const list = parseListContent(listName, content);

    // Add indices to items
    const indexedItems = list.items.map((item, index) => ({
      index,
      ...item
    }));

    logger.info?.('admin.lists.loaded', { type, list: listName, count: indexedItems.length, household: householdId });

    res.json({
      type,
      name: listName,
      ...list,
      items: indexedItems,
      household: householdId
    });
  });

  /**
   * PUT /lists/:type/:name/settings - Update list metadata
   */
  router.put('/lists/:type/:name/settings', (req, res) => {
    const { type, name: listName } = req.params;
    const householdId = req.query.household || configService.getDefaultHouseholdId();
    const settings = req.body || {};

    validateType(type);

    const listPath = getListPath(type, listName, householdId);

    // Load existing list
    const content = loadYamlSafe(listPath);
    if (content === null) {
      throw new NotFoundError('List not found', { type, list: listName });
    }

    // Parse and merge settings
    const list = parseListContent(listName, content);

    // Only update allowed fields
    const allowedFields = ['title', 'description', 'group', 'icon', 'sorting', 'days', 'active', 'defaultAction', 'defaultVolume', 'defaultPlaybackRate'];
    for (const field of allowedFields) {
      if (settings[field] !== undefined) {
        list[field] = settings[field];
      }
    }

    // Save with new format
    saveYaml(listPath, serializeList(list));

    logger.info?.('admin.lists.settings.updated', { type, list: listName, household: householdId });

    res.json({
      type,
      name: listName,
      ...list,
      household: householdId
    });
  });

  /**
   * PUT /lists/:type/:name - Replace list contents (for reordering)
   */
  router.put('/lists/:type/:name', (req, res) => {
    const { type, name: listName } = req.params;
    const householdId = req.query.household || configService.getDefaultHouseholdId();
    const { items } = req.body || {};

    validateType(type);

    if (!items || !Array.isArray(items)) {
      throw new ValidationError('Items array is required', { field: 'items' });
    }

    const listPath = getListPath(type, listName, householdId);

    // Load existing list to preserve metadata
    const existing = loadYamlSafe(listPath);
    if (existing === null) {
      throw new NotFoundError('List', `${type}/${listName}`);
    }

    try {
      // Parse existing list to get metadata
      const list = parseListContent(listName, existing);

      // Remove index field if present (it's computed, not stored)
      const cleanItems = items.map(({ index, ...item }) => item);

      // Replace items while preserving metadata
      list.items = cleanItems;

      // Save with serializeList to preserve metadata
      saveYaml(listPath, serializeList(list));

      logger.info?.('admin.lists.reordered', { type, list: listName, count: cleanItems.length, household: householdId });

      res.json({
        ok: true,
        type,
        list: listName,
        count: cleanItems.length
      });
    } catch (error) {
      logger.error?.('admin.lists.reorder.failed', { type, list: listName, error: error.message });
      res.status(500).json({ error: 'Failed to update list' });
    }
  });

  /**
   * DELETE /lists/:type/:name - Delete entire list
   */
  router.delete('/lists/:type/:name', (req, res) => {
    const { type, name: listName } = req.params;
    const householdId = req.query.household || configService.getDefaultHouseholdId();

    validateType(type);

    const listPath = getListPath(type, listName, householdId);

    // Check if list exists
    const existing = loadYamlSafe(listPath);
    if (existing === null) {
      throw new NotFoundError('List', `${type}/${listName}`);
    }

    try {
      deleteYaml(listPath);

      logger.info?.('admin.lists.deleted', { type, list: listName, household: householdId });

      res.json({
        ok: true,
        deleted: { type, list: listName }
      });
    } catch (error) {
      logger.error?.('admin.lists.delete.failed', { type, list: listName, error: error.message });
      res.status(500).json({ error: 'Failed to delete list' });
    }
  });

  // =============================================================================
  // Item Endpoints
  // =============================================================================

  /**
   * POST /lists/:type/:name/items - Add item to list
   */
  router.post('/lists/:type/:name/items', (req, res) => {
    const { type, name: listName } = req.params;
    const householdId = req.query.household || configService.getDefaultHouseholdId();
    const itemData = req.body || {};

    validateType(type);

    // Validate required fields based on type
    if (!itemData.label || typeof itemData.label !== 'string' || !itemData.label.trim()) {
      throw new ValidationError('Missing required field', { field: 'label' });
    }
    if (!itemData.input || typeof itemData.input !== 'string' || !itemData.input.trim()) {
      throw new ValidationError('Missing required field', { field: 'input' });
    }

    const listPath = getListPath(type, listName, householdId);
    const items = loadYamlSafe(listPath);

    if (items === null) {
      throw new NotFoundError('List', `${type}/${listName}`);
    }

    try {
      const itemsArray = Array.isArray(items) ? items : [];

      // Build new item - preserve all provided fields
      const newItem = {
        label: itemData.label.trim(),
        input: itemData.input.trim()
      };

      // Copy optional fields if provided
      if (itemData.action !== undefined) newItem.action = itemData.action;
      if (itemData.active !== undefined) newItem.active = itemData.active;
      if (itemData.image !== undefined) newItem.image = itemData.image;
      if (itemData.shuffle !== undefined) newItem.shuffle = itemData.shuffle;
      if (itemData.continuous !== undefined) newItem.continuous = itemData.continuous;
      if (itemData.days !== undefined) newItem.days = itemData.days;
      if (itemData.hold !== undefined) newItem.hold = itemData.hold;
      if (itemData.priority !== undefined) newItem.priority = itemData.priority;
      if (itemData.group !== undefined) newItem.group = itemData.group;

      itemsArray.push(newItem);
      saveYaml(listPath, itemsArray);

      const newIndex = itemsArray.length - 1;

      logger.info?.('admin.lists.item.added', { type, list: listName, index: newIndex, label: newItem.label, household: householdId });

      res.status(201).json({
        ok: true,
        index: newIndex,
        type,
        list: listName
      });
    } catch (error) {
      logger.error?.('admin.lists.item.add.failed', { type, list: listName, label: itemData.label, error: error.message });
      res.status(500).json({ error: 'Failed to add item' });
    }
  });

  /**
   * PUT /lists/:type/:name/items/:index - Update item at index
   */
  router.put('/lists/:type/:name/items/:index', (req, res) => {
    const { type, name: listName, index: indexStr } = req.params;
    const householdId = req.query.household || configService.getDefaultHouseholdId();
    const updates = req.body || {};

    validateType(type);

    const index = parseInt(indexStr, 10);
    if (isNaN(index) || index < 0) {
      throw new ValidationError('Invalid index', { field: 'index' });
    }

    const listPath = getListPath(type, listName, householdId);
    const items = loadYamlSafe(listPath);

    if (items === null) {
      throw new NotFoundError('List', `${type}/${listName}`);
    }

    const itemsArray = Array.isArray(items) ? items : [];

    if (index >= itemsArray.length) {
      throw new NotFoundError('Item', index, { type, list: listName });
    }

    try {
      // Merge updates with existing item
      const existingItem = itemsArray[index];
      const updatedItem = { ...existingItem };

      // Apply updates for any provided field
      const allowedFields = ['label', 'input', 'action', 'active', 'image', 'shuffle', 'continuous', 'days', 'hold', 'priority', 'skipAfter', 'waitUntil', 'group'];
      for (const field of allowedFields) {
        if (updates[field] !== undefined) {
          updatedItem[field] = updates[field];
        }
      }

      itemsArray[index] = updatedItem;
      saveYaml(listPath, itemsArray);

      logger.info?.('admin.lists.item.updated', { type, list: listName, index, household: householdId });

      res.json({
        ok: true,
        index,
        type,
        list: listName
      });
    } catch (error) {
      logger.error?.('admin.lists.item.update.failed', { type, list: listName, index, error: error.message });
      res.status(500).json({ error: 'Failed to update item' });
    }
  });

  /**
   * DELETE /lists/:type/:name/items/:index - Remove item at index
   */
  router.delete('/lists/:type/:name/items/:index', (req, res) => {
    const { type, name: listName, index: indexStr } = req.params;
    const householdId = req.query.household || configService.getDefaultHouseholdId();

    validateType(type);

    const index = parseInt(indexStr, 10);
    if (isNaN(index) || index < 0) {
      throw new ValidationError('Invalid index', { field: 'index' });
    }

    const listPath = getListPath(type, listName, householdId);
    const items = loadYamlSafe(listPath);

    if (items === null) {
      throw new NotFoundError('List', `${type}/${listName}`);
    }

    const itemsArray = Array.isArray(items) ? items : [];

    if (index >= itemsArray.length) {
      throw new NotFoundError('Item', index, { type, list: listName });
    }

    try {
      const deletedItem = itemsArray[index];
      itemsArray.splice(index, 1);
      saveYaml(listPath, itemsArray);

      logger.info?.('admin.lists.item.deleted', { type, list: listName, index, label: deletedItem.label, household: householdId });

      res.json({
        ok: true,
        deleted: {
          index,
          label: deletedItem.label
        }
      });
    } catch (error) {
      logger.error?.('admin.lists.item.delete.failed', { type, list: listName, index, error: error.message });
      res.status(500).json({ error: 'Failed to delete item' });
    }
  });

  return router;
}

export default createAdminContentRouter;
