// backend/src/1_adapters/content/freshvideo/FreshVideoAdapter.mjs

const WATCHED_THRESHOLD = 90;

/**
 * Content adapter for fresh video sources (news, teded, etc.).
 *
 * Fixed strategy: always returns the latest unwatched video from a folder.
 * Falls back to the newest video if all are watched (never empty).
 *
 * Folder convention: media/video/news/{localId}/YYYYMMDD.mp4
 */
export class FreshVideoAdapter {
  #fileAdapter;
  #mediaProgressMemory;

  constructor({ fileAdapter, mediaProgressMemory }) {
    this.#fileAdapter = fileAdapter;
    this.#mediaProgressMemory = mediaProgressMemory || null;
  }

  get source() { return 'freshvideo'; }
  get prefixes() { return [{ prefix: 'freshvideo' }]; }
  getCapabilities() { return ['playable']; }

  /**
   * Resolve a freshvideo source to the latest unwatched video.
   * @param {string} id - e.g. "freshvideo:teded" or "teded"
   * @returns {Promise<Array>} Single-item array or empty if no videos exist
   */
  async resolvePlayables(id) {
    const localId = id.replace(/^freshvideo:/, '');
    const videoPath = `video/news/${localId}`;

    const listing = await this.#fileAdapter.getList(videoPath);
    // FileAdapter.getList returns PlayableItem (no itemType) for files
    // and ListableItem (itemType: 'container') for directories — skip containers
    const files = (listing || []).filter(item => item.itemType !== 'container');
    if (files.length === 0) return [];

    // Build items with date extracted from filename
    // FileAdapter.getList already returns full items via getItem(), so use directly
    const items = [];
    for (const file of files) {
      const localId = file.localId || file.id?.replace(/^(files|media):/, '');
      const filename = localId?.split('/').pop() || '';
      const dateMatch = filename.match(/^(\d{8})/);
      const date = dateMatch ? dateMatch[1] : '00000000';

      items.push({ ...file, date });
    }

    if (items.length === 0) return [];

    // Sort by date descending (newest first)
    items.sort((a, b) => b.date.localeCompare(a.date));

    // Enrich with watch state and pick latest unwatched
    if (this.#mediaProgressMemory) {
      for (const item of items) {
        const mediaKey = item.localId || item.id?.replace(/^(files|media):/, '');
        const state = await this.#mediaProgressMemory.get(mediaKey, 'files');
        item.percent = state?.percent || 0;
        item.watched = item.percent >= WATCHED_THRESHOLD;
      }

      const unwatched = items.find(item => !item.watched);
      if (unwatched) return [unwatched];
    }

    // Fallback: newest video (never empty)
    return [items[0]];
  }

  async getItem(id) {
    const results = await this.resolvePlayables(id);
    return results[0] || null;
  }

  async getList(id) {
    return this.getItem(id);
  }

  async resolveSiblings() {
    return { parent: null, items: [] };
  }

  async search() { return []; }
}
