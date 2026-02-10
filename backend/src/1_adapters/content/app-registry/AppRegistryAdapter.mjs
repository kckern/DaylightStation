// backend/src/1_adapters/content/app-registry/AppRegistryAdapter.mjs

/**
 * Content adapter for native apps (webcam, gratitude, family-selector, etc.).
 *
 * Returns items with `metadata.contentFormat = 'app'` so the frontend dispatches
 * to PlayableAppShell via format-based routing.
 *
 * Apps are not playable media — resolvePlayables() returns [].
 */
export class AppRegistryAdapter {
  #apps;

  /**
   * @param {Object} config
   * @param {Object<string, {label: string, param?: {name: string, options?: string}}>} config.apps
   */
  constructor({ apps = {} }) {
    this.#apps = apps;
  }

  get source() { return 'app'; }
  get contentFormat() { return 'app'; }
  get prefixes() { return [{ prefix: 'app' }]; }

  canResolve(id) {
    return id.startsWith('app:');
  }

  /**
   * @param {string} id - e.g. "webcam", "family-selector/alan", or "app:webcam"
   * @returns {Promise<Object|null>}
   */
  async getItem(id) {
    const localId = id.replace(/^app:/, '');
    const slashIdx = localId.indexOf('/');
    const appId = slashIdx >= 0 ? localId.slice(0, slashIdx) : localId;
    const appParam = slashIdx >= 0 ? localId.slice(slashIdx + 1) : null;

    const app = this.#apps[appId];
    if (!app) return null;

    return {
      id: `app:${localId}`,
      title: app.label || appId,
      source: 'app',
      itemType: 'item',
      metadata: {
        contentFormat: 'app',
        appId,
        appParam,
        paramName: app.param?.name || null,
      },
    };
  }

  /**
   * List all registered apps.
   * @returns {Promise<Array>}
   */
  async getList() {
    return Object.entries(this.#apps).map(([appId, app]) => ({
      id: `app:${appId}`,
      title: app.label || appId,
      source: 'app',
      itemType: 'item',
      metadata: {
        contentFormat: 'app',
        appId,
        appParam: null,
      },
    }));
  }

  /**
   * Apps are not playable media.
   * @returns {Promise<Array>}
   */
  async resolvePlayables() {
    return [];
  }

  /**
   * All apps are siblings of each other.
   * @returns {Promise<{parent: null, items: Array}>}
   */
  async resolveSiblings() {
    const items = await this.getList();
    return { parent: null, items };
  }

  /**
   * Capabilities for app items.
   * @param {Object} _item
   * @returns {string[]}
   */
  getCapabilities(_item) {
    return ['openable'];
  }

  /**
   * Search apps by label or ID.
   * @param {string} query
   * @returns {Promise<Array>}
   */
  async search(query) {
    if (!query) return [];
    const q = query.toLowerCase();
    return Object.entries(this.#apps)
      .filter(([appId, app]) =>
        appId.toLowerCase().includes(q) ||
        (app.label || '').toLowerCase().includes(q)
      )
      .map(([appId, app]) => ({
        id: `app:${appId}`,
        title: app.label || appId,
        source: 'app',
        itemType: 'item',
        metadata: { contentFormat: 'app', appId, appParam: null },
      }));
  }
}
