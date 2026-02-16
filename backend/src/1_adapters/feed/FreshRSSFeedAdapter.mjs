/**
 * FreshRSSFeedAdapter
 *
 * Wraps FreshRSS Google Reader API for structured feed access.
 * Authenticates per-user via API key from auth/freshrss.yml.
 *
 * GReader API base: /api/greader.php/reader/api/0/
 *
 * @module adapters/feed
 */

const GREADER_BASE = '/api/greader.php/reader/api/0';

export class FreshRSSFeedAdapter {
  #freshrssHost;
  #dataService;
  #fetchFn;
  #logger;

  /**
   * @param {Object} config
   * @param {string} config.freshrssHost - FreshRSS server URL
   * @param {Object} config.dataService - DataService for reading user auth
   * @param {Function} [config.fetchFn] - fetch implementation (for testing)
   * @param {Object} [config.logger]
   */
  constructor({ freshrssHost, dataService, fetchFn, logger = console }) {
    this.#freshrssHost = freshrssHost;
    this.#dataService = dataService;
    this.#fetchFn = fetchFn || globalThis.fetch;
    this.#logger = logger;
  }

  /**
   * Get API key for user
   * @private
   */
  #getApiKey(username) {
    const auth = this.#dataService.user.read('auth/freshrss', username);
    if (!auth?.key) throw new Error('FreshRSS API key not configured');
    return auth.key;
  }

  /**
   * Make authenticated GReader API request
   * @private
   */
  async #greaderRequest(path, username, options = {}) {
    const apiKey = this.#getApiKey(username);
    const url = `${this.#freshrssHost}${GREADER_BASE}${path}`;
    const response = await this.#fetchFn(url, {
      ...options,
      headers: {
        'Authorization': `GoogleLogin auth=${apiKey}`,
        ...options.headers,
      },
    });
    if (!response.ok) {
      throw new Error(`FreshRSS API error: ${response.status}`);
    }
    return response.json();
  }

  /**
   * Get categories/folders
   * @param {string} username
   * @returns {Promise<Array<{ id, type }>>}
   */
  async getCategories(username) {
    const data = await this.#greaderRequest('/tag/list?output=json', username);
    return data.tags || [];
  }

  /**
   * Get subscribed feeds
   * @param {string} username
   * @returns {Promise<Array<{ id, title, categories, url }>>}
   */
  async getFeeds(username) {
    const data = await this.#greaderRequest('/subscription/list?output=json', username);
    return data.subscriptions || [];
  }

  /**
   * Get items for a feed/category stream
   * @param {string} streamId - e.g., 'feed/1' or 'user/-/label/Tech'
   * @param {string} username
   * @param {Object} [options] - { count, continuation, excludeRead }
   * @returns {Promise<Array>}
   */
  async getItems(streamId, username, options = {}) {
    const count = options.count || 50;
    const exclude = options.excludeRead ? '&xt=user/-/state/com.google/read' : '';
    const cont = options.continuation ? `&c=${options.continuation}` : '';
    const path = `/stream/contents/${encodeURIComponent(streamId)}?output=json&n=${count}${exclude}${cont}`;

    const data = await this.#greaderRequest(path, username);

    return (data.items || []).map(item => ({
      id: item.id,
      title: item.title,
      content: item.summary?.content || '',
      link: item.canonical?.[0]?.href || item.alternate?.[0]?.href || '',
      published: item.published ? new Date(item.published * 1000) : null,
      author: item.author || null,
      feedTitle: item.origin?.title || null,
      feedId: item.origin?.streamId || null,
      categories: item.categories || [],
    }));
  }

  /**
   * Mark items as read
   * @param {string[]} itemIds - GReader item IDs
   * @param {string} username
   */
  async markRead(itemIds, username) {
    const body = new URLSearchParams();
    body.append('a', 'user/-/state/com.google/read');
    for (const id of itemIds) {
      body.append('i', id);
    }

    await this.#greaderRequest('/edit-tag', username, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });
  }

  /**
   * Mark items as unread
   * @param {string[]} itemIds
   * @param {string} username
   */
  async markUnread(itemIds, username) {
    const body = new URLSearchParams();
    body.append('r', 'user/-/state/com.google/read');
    for (const id of itemIds) {
      body.append('i', id);
    }

    await this.#greaderRequest('/edit-tag', username, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });
  }
}

export default FreshRSSFeedAdapter;
