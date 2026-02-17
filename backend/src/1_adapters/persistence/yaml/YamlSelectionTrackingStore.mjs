/**
 * YamlSelectionTrackingStore
 *
 * YAML-backed persistence for feed item selection tracking.
 * Stores per-item count and last-selected timestamp.
 *
 * Path: current/feed/_selection_tracking (DataService appends .yml)
 *
 * @module adapters/persistence/yaml
 */
import { ISelectionTrackingStore } from '#apps/feed/ports/ISelectionTrackingStore.mjs';

const TRACKING_PATH = 'current/feed/_selection_tracking';

export class YamlSelectionTrackingStore extends ISelectionTrackingStore {
  #dataService;
  #logger;

  constructor({ dataService, logger = console }) {
    super();
    this.#dataService = dataService;
    this.#logger = logger;
  }

  async getAll(username) {
    const raw = this.#dataService.user.read(TRACKING_PATH, username) || {};
    const map = new Map();
    for (const [id, record] of Object.entries(raw)) {
      map.set(id, { count: record.count || 0, last: record.last || null });
    }
    return map;
  }

  async incrementBatch(itemIds, username) {
    if (!itemIds.length) return;
    const raw = this.#dataService.user.read(TRACKING_PATH, username) || {};
    const now = new Date().toISOString();

    for (const id of itemIds) {
      if (!raw[id]) raw[id] = { count: 0, last: null };
      raw[id].count += 1;
      raw[id].last = now;
    }

    this.#dataService.user.write(TRACKING_PATH, raw, username);
    this.#logger.debug?.('selection.tracking.incremented', { count: itemIds.length, username });
  }
}

export default YamlSelectionTrackingStore;
