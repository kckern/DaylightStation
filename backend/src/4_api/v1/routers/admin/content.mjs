/**
 * Admin Content Router
 *
 * Thin HTTP layer for managing household config lists.
 * All business logic is delegated to ListManagementService.
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
import { YamlListDatastore } from '#adapters/persistence/yaml/YamlListDatastore.mjs';
import { ListManagementService } from '#apps/content/services/ListManagementService.mjs';

/**
 * Create Admin Content Router
 *
 * @param {Object} config
 * @param {Object} config.userDataService - UserDataService for household paths
 * @param {Object} config.configService - ConfigService for default household
 * @param {Object} [config.listManagementService] - Pre-built ListManagementService (for DI)
 * @param {Object} [config.logger] - Logger instance
 * @returns {express.Router}
 */
export function createAdminContentRouter(config) {
  const {
    userDataService,
    configService,
    logger = console
  } = config;

  // Build service layer: allow pre-built injection or construct from dependencies
  const listManagementService = config.listManagementService || new ListManagementService({
    listStore: new YamlListDatastore({ userDataService, configService }),
    logger
  });

  const router = express.Router();

  // =============================================================================
  // Overview Endpoint
  // =============================================================================

  /**
   * GET /lists - Overview of all list types with counts
   */
  router.get('/lists', (req, res) => {
    const householdId = req.query.household || configService.getDefaultHouseholdId();

    try {
      const result = listManagementService.getOverview(householdId);
      res.json(result);
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

    try {
      const result = listManagementService.listByType(type, householdId);
      res.json(result);
    } catch (error) {
      if (error.httpStatus) throw error;
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

    const result = listManagementService.createList(type, name, householdId);
    res.status(201).json(result);
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

    const result = listManagementService.getList(type, listName, householdId);
    res.json(result);
  });

  /**
   * PUT /lists/:type/:name/settings - Update list metadata
   */
  router.put('/lists/:type/:name/settings', (req, res) => {
    const { type, name: listName } = req.params;
    const householdId = req.query.household || configService.getDefaultHouseholdId();
    const settings = req.body || {};

    const result = listManagementService.updateSettings(type, listName, householdId, settings);
    res.json(result);
  });

  /**
   * PUT /lists/:type/:name - Replace list contents (for reordering)
   */
  router.put('/lists/:type/:name', (req, res) => {
    const { type, name: listName } = req.params;
    const householdId = req.query.household || configService.getDefaultHouseholdId();
    const sectionIndex = parseInt(req.query.section, 10) || 0;
    const { items } = req.body || {};

    try {
      const result = listManagementService.replaceContents(type, listName, householdId, items, sectionIndex);
      res.json(result);
    } catch (error) {
      if (error.httpStatus) throw error;
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

    try {
      const result = listManagementService.deleteList(type, listName, householdId);
      res.json(result);
    } catch (error) {
      if (error.httpStatus) throw error;
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
    const sectionIndex = parseInt(req.query.section, 10) || 0;
    const itemData = req.body || {};

    try {
      const result = listManagementService.addItem(type, listName, householdId, itemData, sectionIndex);
      res.status(201).json(result);
    } catch (error) {
      if (error.httpStatus) throw error;
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

    const result = listManagementService.moveItem(type, listName, householdId, from, to);
    res.json(result);
  });

  /**
   * PUT /lists/:type/:name/items/:index - Update item at index
   */
  router.put('/lists/:type/:name/items/:index', (req, res) => {
    const { type, name: listName, index: indexStr } = req.params;
    const householdId = req.query.household || configService.getDefaultHouseholdId();
    const sectionIndex = parseInt(req.query.section, 10) || 0;
    const updates = req.body || {};

    const index = parseInt(indexStr, 10);

    try {
      const result = listManagementService.updateItem(type, listName, householdId, index, updates, sectionIndex);
      res.json(result);
    } catch (error) {
      if (error.httpStatus) throw error;
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
    const sectionIndex = parseInt(req.query.section, 10) || 0;

    const index = parseInt(indexStr, 10);

    try {
      const result = listManagementService.deleteItem(type, listName, householdId, index, sectionIndex);
      res.json(result);
    } catch (error) {
      if (error.httpStatus) throw error;
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

    const result = listManagementService.addSection(type, listName, householdId, sectionData);
    res.status(201).json(result);
  });

  /**
   * POST /lists/:type/:name/sections/split - Split a section at an item index
   * NOTE: Must be registered BEFORE sections/:sectionIndex
   */
  router.post('/lists/:type/:name/sections/split', (req, res) => {
    const { type, name: listName } = req.params;
    const householdId = req.query.household || configService.getDefaultHouseholdId();
    const { sectionIndex = 0, afterItemIndex, title } = req.body || {};

    const result = listManagementService.splitSection(type, listName, householdId, sectionIndex, afterItemIndex, title);
    res.status(201).json(result);
  });

  /**
   * PUT /lists/:type/:name/sections/reorder - Reorder sections
   * NOTE: Must be registered BEFORE sections/:sectionIndex
   */
  router.put('/lists/:type/:name/sections/reorder', (req, res) => {
    const { type, name: listName } = req.params;
    const householdId = req.query.household || configService.getDefaultHouseholdId();
    const { order } = req.body || {};

    const result = listManagementService.reorderSections(type, listName, householdId, order);
    res.json(result);
  });

  /**
   * PUT /lists/:type/:name/sections/:sectionIndex - Update section settings
   */
  router.put('/lists/:type/:name/sections/:sectionIndex', (req, res) => {
    const { type, name: listName, sectionIndex: siStr } = req.params;
    const householdId = req.query.household || configService.getDefaultHouseholdId();
    const updates = req.body || {};

    const si = parseInt(siStr, 10);
    const result = listManagementService.updateSection(type, listName, householdId, si, updates);
    res.json(result);
  });

  /**
   * DELETE /lists/:type/:name/sections/:sectionIndex - Delete section
   */
  router.delete('/lists/:type/:name/sections/:sectionIndex', (req, res) => {
    const { type, name: listName, sectionIndex: siStr } = req.params;
    const householdId = req.query.household || configService.getDefaultHouseholdId();

    const si = parseInt(siStr, 10);
    const result = listManagementService.deleteSection(type, listName, householdId, si);
    res.json(result);
  });

  return router;
}

export default createAdminContentRouter;
