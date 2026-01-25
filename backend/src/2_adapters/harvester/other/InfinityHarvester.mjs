/**
 * InfinityHarvester
 *
 * Fetches data from Infinity (startinfinity.com) boards.
 * Implements IHarvester interface with circuit breaker resilience.
 *
 * Infinity is a kanban/database tool used for:
 * - Watchlists (media tracking)
 * - Shopping lists
 * - Any other list-based data
 *
 * Features:
 * - Dynamic table key support (reads from config)
 * - Image caching
 * - Folder-based organization
 *
 * @module harvester/other/InfinityHarvester
 */

import { IHarvester, HarvesterCategory } from '../ports/IHarvester.mjs';
import { CircuitBreaker } from '../CircuitBreaker.mjs';

/**
 * Infinity data harvester
 * @implements {IHarvester}
 */
export class InfinityHarvester extends IHarvester {
  #httpClient;
  #configService;
  #tableKey;
  #tableId;
  #workspaceId;
  #circuitBreaker;
  #io;
  #logger;

  /**
   * @param {Object} config
   * @param {Object} config.httpClient - HTTP client for API calls
   * @param {Object} config.configService - ConfigService for credentials
   * @param {string} config.tableKey - Table key name (e.g., 'lists', 'shopping')
   * @param {string} [config.tableId] - Override table ID (else from config)
   * @param {Object} [config.io] - IO service for file operations (saveFile, saveImage)
   * @param {Object} [config.logger] - Logger instance
   */
  constructor({
    httpClient,
    configService,
    tableKey,
    tableId,
    io,
    logger = console,
  }) {
    super();

    if (!httpClient) {
      throw new Error('InfinityHarvester requires httpClient');
    }
    if (!configService) {
      throw new Error('InfinityHarvester requires configService');
    }
    if (!tableKey) {
      throw new Error('InfinityHarvester requires tableKey');
    }

    this.#httpClient = httpClient;
    this.#configService = configService;
    this.#tableKey = tableKey;
    this.#io = io;
    this.#logger = logger;

    // Get workspace ID from config (check infinity.workspace, secrets, then env)
    const infinityConfig = configService.get?.('infinity') || {};
    this.#workspaceId = infinityConfig.workspace ||
                        configService.getSecret?.('INFINITY_WORKSPACE') ||
                        process.env.INFINITY_WORKSPACE;

    // Get table ID from config or override
    this.#tableId = tableId || infinityConfig[tableKey] || process.env[`INFINITY_${tableKey.toUpperCase()}`];

    this.#circuitBreaker = new CircuitBreaker({
      maxFailures: 3,
      baseCooldownMs: 5 * 60 * 1000,
      maxCooldownMs: 30 * 60 * 1000,
      logger: logger,
    });
  }

  get serviceId() {
    return this.#tableKey;
  }

  get category() {
    return HarvesterCategory.OTHER;
  }

  /**
   * Get auth token from config
   * @private
   * @returns {string|null}
   */
  #getAuthToken() {
    // Try secrets first, then env
    return this.#configService.getSecret?.('INFINITY_DEV') ||
           process.env.INFINITY_DEV;
  }

  /**
   * Harvest data from Infinity board
   *
   * @param {string} username - Target user
   * @param {Object} [options] - Harvest options
   * @returns {Promise<{ status: string, count: number, items?: Array }>}
   */
  async harvest(username, options = {}) {
    // Check circuit breaker
    if (this.#circuitBreaker.isOpen()) {
      const cooldown = this.#circuitBreaker.getCooldownStatus();
      this.#logger.debug?.('infinity.harvest.skipped', {
        tableKey: this.#tableKey,
        username,
        reason: 'Circuit breaker active',
        remainingMins: cooldown?.remainingMins,
      });
      return {
        status: 'skipped',
        reason: 'cooldown',
        remainingMins: cooldown?.remainingMins,
      };
    }

    const token = this.#getAuthToken();
    if (!token) {
      this.#logger.warn?.('infinity.harvest.no_auth', { tableKey: this.#tableKey });
      return { status: 'error', reason: 'No auth token configured' };
    }

    if (!this.#tableId) {
      this.#logger.warn?.('infinity.harvest.no_table', { tableKey: this.#tableKey });
      return { status: 'error', reason: `No table ID configured for ${this.#tableKey}` };
    }

    if (!this.#workspaceId) {
      this.#logger.warn?.('infinity.harvest.no_workspace', { tableKey: this.#tableKey });
      return { status: 'error', reason: 'No workspace ID configured' };
    }

    try {
      this.#logger.info?.('infinity.harvest.start', {
        tableKey: this.#tableKey,
        tableId: this.#tableId,
        username,
      });

      // Load table data (with pagination)
      const items = await this.#loadTable(token);

      // Load folders for organization
      const folders = await this.#loadFolders(token);

      // Process items with folder info
      const processedItems = this.#processTable(items, folders);

      // Save images if IO is available
      const finalItems = this.#io
        ? await this.#saveImages(processedItems)
        : processedItems;

      // Save to household state file (Infinity data is household-level, not user-level)
      // This matches legacy behavior: saveFile('state/lists') -> households/default/state/lists
      if (this.#io?.householdSaveFile) {
        await this.#io.householdSaveFile(`state/${this.#tableKey}`, finalItems);
      }

      this.#circuitBreaker.recordSuccess();

      this.#logger.info?.('infinity.harvest.complete', {
        tableKey: this.#tableKey,
        count: finalItems.length,
        username,
      });

      return {
        status: 'success',
        count: finalItems.length,
        items: finalItems,
      };
    } catch (error) {
      this.#circuitBreaker.recordFailure();
      this.#logger.error?.('infinity.harvest.failed', {
        tableKey: this.#tableKey,
        error: error.message,
      });
      return {
        status: 'error',
        reason: error.message,
      };
    }
  }

  /**
   * Load all items from table with pagination
   * @private
   */
  async #loadTable(token, data = [], after = '') {
    const url = new URL(
      `https://app.startinfinity.com/api/v2/workspaces/${this.#workspaceId}/boards/${this.#tableId}/items`
    );
    url.searchParams.set('limit', '100');
    url.searchParams.append('expand[]', 'values.attribute');
    url.searchParams.set('sort_direction', 'asc');
    if (after) {
      url.searchParams.set('after', after);
    }

    const response = await this.#httpClient.get(url.toString(), {
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    });

    const fetchedData = response.data?.data || [];
    const allData = [...data, ...fetchedData];

    // Handle pagination
    if (response.data?.has_more) {
      return this.#loadTable(token, allData, response.data.after);
    }

    // Sort by sort_order
    return allData.sort((a, b) => {
      const sortA = parseFloat(a.sort_order) || 0;
      const sortB = parseFloat(b.sort_order) || 0;
      return sortA - sortB;
    });
  }

  /**
   * Load folders for the table
   * @private
   */
  async #loadFolders(token) {
    const url = `https://app.startinfinity.com/api/v2/workspaces/${this.#workspaceId}/boards/${this.#tableId}/folders`;

    try {
      const response = await this.#httpClient.get(url, {
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      });
      return response.data?.data || [];
    } catch (error) {
      this.#logger.warn?.('infinity.folders.failed', { error: error.message });
      return [];
    }
  }

  /**
   * Process raw table data into structured items
   * @private
   */
  #processTable(tableData, folders) {
    if (!Array.isArray(tableData)) {
      this.#logger.error?.('infinity.processTable.invalidData', { type: typeof tableData });
      return [];
    }

    return tableData.map((item) => {
      const processedItem = item.values.reduce((acc, val) => {
        let key = val.attribute.name.toLowerCase().split(' ').join('_');
        let value;

        if (Array.isArray(val?.data)) {
          value = val.data.map((id) => this.#loadLabel(id, val.attribute)).join(', ');
        } else {
          value = val?.data;
        }

        acc[key] = value;
        return acc;
      }, {});

      processedItem.uid = item.id;

      const folder = folders.find((f) => f.id === item.folder_id) || {};
      processedItem.folder = folder.name || item.folder_id;
      if (folder.color) {
        processedItem.folder_color = folder.color;
      }

      return processedItem;
    });
  }

  /**
   * Resolve label ID to name
   * @private
   */
  #loadLabel(id, attribute) {
    if (typeof id !== 'string') return id?.link || id;

    const index = {};
    attribute.settings?.labels?.forEach((label) => {
      index[label.id] = label.name;
    });

    return index[id] || id;
  }

  /**
   * Save images and return items with local paths
   * @private
   */
  async #saveImages(items) {
    const hasImages = items.filter((item) => item.image);
    if (!hasImages.length) return items;

    const host = this.#configService.get?.('host') || process.env.host || '';

    for (let i = 0; i < items.length; i++) {
      if (items[i].image && this.#io?.saveImage) {
        try {
          await this.#io.saveImage(items[i].image, this.#tableKey, items[i].uid);
          delete items[i].image;
          items[i].image = `${host}/media/img/${this.#tableKey}/${items[i].uid}`;
        } catch (error) {
          this.#logger.warn?.('infinity.saveImage.failed', {
            uid: items[i].uid,
            error: error.message,
          });
        }
      }
    }

    return this.#checkForDupeImages(items);
  }

  /**
   * Share images between items with same input/label
   * @private
   */
  #checkForDupeImages(items) {
    const itemsWithImages = items.filter((item) => item.image);

    items.forEach((item) => {
      if (!item.image) {
        const match = itemsWithImages.find(
          (i) =>
            i.uid !== item.uid &&
            (i.input?.toLowerCase().trim() === item.input?.toLowerCase().trim() ||
              i.label?.toLowerCase().trim() === item.label?.toLowerCase().trim())
        );
        if (match) item.image = match.image;
      }
    });

    return items;
  }

  /**
   * Update a single item in Infinity
   *
   * @param {string} itemId - Item ID to update
   * @param {string} attributeId - Attribute ID to update
   * @param {*} value - New value
   * @returns {Promise<Object>}
   */
  async updateItem(itemId, attributeId, value) {
    const token = this.#getAuthToken();
    if (!token) {
      throw new Error('No auth token configured');
    }

    const url = `https://app.startinfinity.com/api/v2/workspaces/${this.#workspaceId}/boards/${this.#tableId}/items/${itemId}`;

    const response = await this.#httpClient.put(
      url,
      {
        values: [{ attribute_id: attributeId, data: value }],
      },
      {
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      }
    );

    return response.data;
  }

  /**
   * Create a new item in Infinity
   *
   * @param {string} folderId - Folder ID
   * @param {Object} attributes - Key-value pairs of attribute_id to value
   * @returns {Promise<Object>}
   */
  async createItem(folderId, attributes) {
    const token = this.#getAuthToken();
    if (!token) {
      throw new Error('No auth token configured');
    }

    const url = `https://app.startinfinity.com/api/v2/workspaces/${this.#workspaceId}/boards/${this.#tableId}/items`;

    const values = Object.entries(attributes).map(([key, value]) => ({
      attribute_id: key,
      data: value,
    }));

    const response = await this.#httpClient.post(
      url,
      { folder_id: folderId, values },
      {
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      }
    );

    return response.data;
  }

  getStatus() {
    return {
      serviceId: this.serviceId,
      category: this.category,
      configured: !!(this.#getAuthToken() && this.#tableId && this.#workspaceId),
      circuitBreaker: this.#circuitBreaker.getStatus(),
    };
  }

  getParams() {
    return [
      { name: 'tableKey', description: 'Infinity table key', default: this.#tableKey },
    ];
  }
}

/**
 * Factory to create InfinityHarvesters for all configured tables
 *
 * @param {Object} config
 * @param {Object} config.httpClient
 * @param {Object} config.configService
 * @param {Object} [config.io]
 * @param {Object} [config.logger]
 * @returns {InfinityHarvester[]}
 */
export function createInfinityHarvesters({ httpClient, configService, io, logger }) {
  const infinityConfig = configService.get?.('infinity') || {};
  const harvesters = [];

  // Skip known non-table keys
  const skipKeys = ['workspace', 'INFINITY_DEV', 'dev'];

  for (const [key, tableId] of Object.entries(infinityConfig)) {
    if (skipKeys.includes(key)) continue;
    if (!tableId || typeof tableId !== 'string') continue;

    try {
      harvesters.push(
        new InfinityHarvester({
          httpClient,
          configService,
          tableKey: key,
          tableId,
          io,
          logger,
        })
      );
    } catch (error) {
      logger?.warn?.('infinity.factory.skipped', { key, error: error.message });
    }
  }

  return harvesters;
}
