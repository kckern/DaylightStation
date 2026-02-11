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
import { normalizeListConfig, serializeListConfig, extractContentId, extractActionName } from '#adapters/content/list/listConfigNormalizer.mjs';

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
 * Convert a normalized item back to admin-friendly format.
 * Adds label, input, and action fields that the admin UI expects,
 * while preserving all original fields.
 */
function denormalizeForAdmin(item) {
  const result = { ...item };
  if (!result.label) result.label = result.title || '';
  if (!result.input) result.input = extractContentId(result);
  if (!result.action) result.action = extractActionName(result);
  return result;
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
        const list = normalizeListConfig(content, name);
        const itemCount = list.sections.reduce((sum, s) => sum + s.items.length, 0);
        return {
          name,
          title: list.title,
          description: list.description,
          metadata: list.metadata,
          itemCount
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

    // Parse list content to get metadata and sections
    const list = normalizeListConfig(content, listName);

    const totalItems = list.sections.reduce((sum, s) => sum + s.items.length, 0);

    logger.info?.('admin.lists.loaded', { type, list: listName, count: totalItems, household: householdId });

    res.json({
      type,
      name: listName,
      title: list.title,
      description: list.description,
      image: list.image,
      metadata: list.metadata,
      sections: list.sections.map((section, si) => ({
        ...section,
        index: si,
        items: section.items.map((item, ii) => ({ ...denormalizeForAdmin(item), sectionIndex: si, itemIndex: ii }))
      })),
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
    const list = normalizeListConfig(content, listName);

    // Top-level fields
    const topLevelFields = ['title', 'description', 'image'];
    for (const field of topLevelFields) {
      if (settings[field] !== undefined) {
        list[field] = settings[field];
      }
    }

    // Metadata fields
    const metadataFields = ['group', 'icon', 'sorting', 'days', 'active', 'fixed_order', 'defaultAction', 'defaultVolume', 'defaultPlaybackRate'];
    for (const field of metadataFields) {
      if (settings[field] !== undefined) {
        list.metadata[field] = settings[field];
      }
    }

    // Save with new format
    saveYaml(listPath, serializeListConfig(list));

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
      const list = normalizeListConfig(existing, listName);

      // Remove index/section fields if present (they're computed, not stored)
      const cleanItems = items.map(({ index, sectionIndex, itemIndex, ...item }) => item);

      // Replace items in first section (backward compat)
      if (list.sections.length > 0) {
        list.sections[0].items = cleanItems;
      } else {
        list.sections = [{ items: cleanItems }];
      }

      // Save with serializeListConfig to preserve metadata
      saveYaml(listPath, serializeListConfig(list));

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
    const content = loadYamlSafe(listPath);

    if (content === null) {
      throw new NotFoundError('List', `${type}/${listName}`);
    }

    try {
      // Parse list to get metadata and sections
      const list = normalizeListConfig(content, listName);

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

      const section = list.sections[0] || (list.sections[0] = { items: [] });
      section.items.push(newItem);
      saveYaml(listPath, serializeListConfig(list));

      const newIndex = section.items.length - 1;

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
   * PUT /lists/:type/:name/items/move - Move item between sections
   * NOTE: Must be registered BEFORE items/:index to avoid Express treating "move" as an index param
   */
  router.put('/lists/:type/:name/items/move', (req, res) => {
    const { type, name: listName } = req.params;
    const householdId = req.query.household || configService.getDefaultHouseholdId();
    const { from, to } = req.body || {};

    validateType(type);

    if (!from || !to) throw new ValidationError('from and to required');

    const listPath = getListPath(type, listName, householdId);
    const content = loadYamlSafe(listPath);
    if (content === null) throw new NotFoundError('List', `${type}/${listName}`);

    const list = normalizeListConfig(content, listName);
    const fromSection = list.sections[from.section];
    const toSection = list.sections[to.section];
    if (!fromSection || !toSection) throw new NotFoundError('Section');

    const [item] = fromSection.items.splice(from.index, 1);
    if (!item) throw new NotFoundError('Item', from.index);
    toSection.items.splice(to.index, 0, item);
    saveYaml(listPath, serializeListConfig(list));

    logger.info?.('admin.lists.item.moved', { type, list: listName, from, to, household: householdId });

    res.json({ ok: true });
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
    const content = loadYamlSafe(listPath);

    if (content === null) {
      throw new NotFoundError('List', `${type}/${listName}`);
    }

    // Parse list to get metadata and sections
    const list = normalizeListConfig(content, listName);
    const section = list.sections[0];

    if (!section || index >= section.items.length) {
      throw new NotFoundError('Item', index, { type, list: listName });
    }

    try {
      // Merge updates with existing item
      const existingItem = section.items[index];
      const updatedItem = { ...existingItem };

      // Apply updates for any provided field
      const allowedFields = ['label', 'input', 'action', 'active', 'image', 'shuffle', 'continuous', 'days', 'hold', 'priority', 'skipAfter', 'waitUntil', 'group'];
      for (const field of allowedFields) {
        if (updates[field] !== undefined) {
          updatedItem[field] = updates[field];
        }
      }

      section.items[index] = updatedItem;
      saveYaml(listPath, serializeListConfig(list));

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
    const content = loadYamlSafe(listPath);

    if (content === null) {
      throw new NotFoundError('List', `${type}/${listName}`);
    }

    // Parse list to get metadata and sections
    const list = normalizeListConfig(content, listName);
    const section = list.sections[0];

    if (!section || index >= section.items.length) {
      throw new NotFoundError('Item', index, { type, list: listName });
    }

    try {
      const deletedItem = section.items[index];
      section.items.splice(index, 1);
      saveYaml(listPath, serializeListConfig(list));

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

  // =============================================================================
  // Section Endpoints
  // =============================================================================

  /**
   * POST /lists/:type/:name/sections - Add new section
   */
  router.post('/lists/:type/:name/sections', (req, res) => {
    const { type, name: listName } = req.params;
    const householdId = req.query.household || configService.getDefaultHouseholdId();
    const sectionData = req.body || {};

    validateType(type);

    const listPath = getListPath(type, listName, householdId);
    const content = loadYamlSafe(listPath);
    if (content === null) throw new NotFoundError('List', `${type}/${listName}`);

    const list = normalizeListConfig(content, listName);
    const { items: _, ...rest } = sectionData;
    const newSection = { ...rest, items: [] };
    list.sections.push(newSection);
    saveYaml(listPath, serializeListConfig(list));

    logger.info?.('admin.lists.section.added', { type, list: listName, household: householdId });

    res.status(201).json({ ok: true, sectionIndex: list.sections.length - 1 });
  });

  /**
   * POST /lists/:type/:name/sections/split - Split a section at an item index
   * Items after the split point move to a new section inserted right after.
   * NOTE: Must be registered BEFORE sections/:sectionIndex
   */
  router.post('/lists/:type/:name/sections/split', (req, res) => {
    const { type, name: listName } = req.params;
    const householdId = req.query.household || configService.getDefaultHouseholdId();
    const { sectionIndex = 0, afterItemIndex, title } = req.body || {};

    validateType(type);

    if (afterItemIndex == null || afterItemIndex < 0) {
      throw new ValidationError('afterItemIndex is required', { field: 'afterItemIndex' });
    }

    const listPath = getListPath(type, listName, householdId);
    const content = loadYamlSafe(listPath);
    if (content === null) throw new NotFoundError('List', `${type}/${listName}`);

    const list = normalizeListConfig(content, listName);
    const section = list.sections[sectionIndex];
    if (!section) throw new NotFoundError('Section', sectionIndex);
    if (afterItemIndex >= section.items.length - 1) {
      throw new ValidationError('Nothing to split — afterItemIndex is at or beyond last item');
    }

    // Split: items 0..afterItemIndex stay, afterItemIndex+1..end go to new section
    const keepItems = section.items.slice(0, afterItemIndex + 1);
    const moveItems = section.items.slice(afterItemIndex + 1);

    section.items = keepItems;
    const newSection = { items: moveItems };
    if (title) newSection.title = title;
    list.sections.splice(sectionIndex + 1, 0, newSection);

    saveYaml(listPath, serializeListConfig(list));

    logger.info?.('admin.lists.section.split', {
      type, list: listName, sectionIndex, afterItemIndex,
      kept: keepItems.length, moved: moveItems.length, household: householdId
    });

    res.status(201).json({ ok: true, newSectionIndex: sectionIndex + 1, movedCount: moveItems.length });
  });

  /**
   * PUT /lists/:type/:name/sections/reorder - Reorder sections
   * NOTE: Must be registered BEFORE sections/:sectionIndex to avoid Express treating "reorder" as a sectionIndex param
   */
  router.put('/lists/:type/:name/sections/reorder', (req, res) => {
    const { type, name: listName } = req.params;
    const householdId = req.query.household || configService.getDefaultHouseholdId();
    const { order } = req.body || {};

    validateType(type);

    if (!Array.isArray(order)) throw new ValidationError('order array required', { field: 'order' });

    const listPath = getListPath(type, listName, householdId);
    const content = loadYamlSafe(listPath);
    if (content === null) throw new NotFoundError('List', `${type}/${listName}`);

    const list = normalizeListConfig(content, listName);
    const reordered = order.map(i => list.sections[i]).filter(Boolean);
    list.sections = reordered;
    saveYaml(listPath, serializeListConfig(list));

    logger.info?.('admin.lists.sections.reordered', { type, list: listName, household: householdId });

    res.json({ ok: true });
  });

  /**
   * PUT /lists/:type/:name/sections/:sectionIndex - Update section settings
   */
  router.put('/lists/:type/:name/sections/:sectionIndex', (req, res) => {
    const { type, name: listName, sectionIndex: siStr } = req.params;
    const householdId = req.query.household || configService.getDefaultHouseholdId();
    const updates = req.body || {};

    validateType(type);

    const si = parseInt(siStr, 10);
    const listPath = getListPath(type, listName, householdId);
    const content = loadYamlSafe(listPath);
    if (content === null) throw new NotFoundError('List', `${type}/${listName}`);

    const list = normalizeListConfig(content, listName);
    if (si < 0 || si >= list.sections.length) throw new NotFoundError('Section', si);

    const section = list.sections[si];
    const allowed = ['title', 'description', 'image', 'fixed_order', 'shuffle', 'limit',
      'priority', 'playbackrate', 'continuous', 'days', 'applySchedule',
      'hold', 'skip_after', 'wait_until', 'active'];
    for (const field of allowed) {
      if (updates[field] !== undefined) section[field] = updates[field];
    }
    saveYaml(listPath, serializeListConfig(list));

    logger.info?.('admin.lists.section.updated', { type, list: listName, sectionIndex: si, household: householdId });

    res.json({ ok: true, sectionIndex: si });
  });

  /**
   * DELETE /lists/:type/:name/sections/:sectionIndex - Delete section
   */
  router.delete('/lists/:type/:name/sections/:sectionIndex', (req, res) => {
    const { type, name: listName, sectionIndex: siStr } = req.params;
    const householdId = req.query.household || configService.getDefaultHouseholdId();

    validateType(type);

    const si = parseInt(siStr, 10);
    const listPath = getListPath(type, listName, householdId);
    const content = loadYamlSafe(listPath);
    if (content === null) throw new NotFoundError('List', `${type}/${listName}`);

    const list = normalizeListConfig(content, listName);
    if (si < 0 || si >= list.sections.length) throw new NotFoundError('Section', si);

    list.sections.splice(si, 1);
    if (list.sections.length === 0) list.sections.push({ items: [] });
    saveYaml(listPath, serializeListConfig(list));

    logger.info?.('admin.lists.section.deleted', { type, list: listName, sectionIndex: si, household: householdId });

    res.json({ ok: true });
  });

  return router;
}

export default createAdminContentRouter;
