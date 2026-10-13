// __backend/src/1_adapters/weekly-review/WeeklyReviewImmichAdapter.mjs
import { buildPhotoReviewDay } from "../domain/photoReviewPolicy.mjs";

export class WeeklyReviewImmichAdapter {
  #client;
  #priorityPeople;
  #proxyPath;
  #sessionGapMs;
  #hiddenTags;
  #logger;

  constructor(config = {}, deps = {}) {
    if (!deps.client) {
      throw new Error('WeeklyReviewImmichAdapter requires client dependency');
    }
    this.#client = deps.client;
    this.#priorityPeople = (config.priorityPeople || []).map(n => n.toLowerCase());
    this.#proxyPath = config.proxyPath || '/proxy/immich';
    this.#sessionGapMs = (config.sessionGapMinutes || 120) * 60 * 1000;
    // Assets carrying any of these Immich tags never reach the review. Set from
    // household `weekly-review/config.yml` → hiddenTags; NoShow when absent.
    this.#hiddenTags = (config.hiddenTags || ['NoShow']).map(n => n.toLowerCase());
    this.#logger = deps.logger || console;
  }

  /**
   * Earliest date carrying reviewable media in `[startDate, endDate]`, or null.
   *
   * Backs the review's jump-to-oldest, so it must stay cheap: one search asking
   * for a single oldest-first row. Whether this Immich build honors `order` on
   * /api/search/metadata is unverified, so the result is reduced rather than
   * read off items[0] — correct either way, and free when `order` does work.
   *
   * @returns {Promise<string|null>} YYYY-MM-DD
   */
  async searchOldest({ startDate, endDate }) {
    const takenAfter = new Date(`${startDate}T00:00:00.000Z`).toISOString();
    const endPlusOne = new Date(`${endDate}T00:00:00.000Z`);
    endPlusOne.setDate(endPlusOne.getDate() + 1);
    const takenBefore = endPlusOne.toISOString();

    const hidden = await this.#hiddenAssetIds({ takenAfter, takenBefore });

    // Ask for one row past every hidden asset, so a hidden oldest asset cannot
    // land the jump on a day that shows nothing.
    const result = await this.#client.searchMetadata({
      takenAfter,
      takenBefore,
      size: hidden.size + 1,
      order: 'asc',
    });

    const assets = result?.items || result || [];
    let oldest = null;
    for (const asset of assets) {
      if (asset.type !== 'IMAGE' && asset.type !== 'VIDEO') continue;
      if (hidden.has(asset.id)) continue;
      const date = asset.localDateTime?.slice(0, 10);
      if (date && (oldest === null || date < oldest)) oldest = date;
    }

    this.#logger.debug?.('weekly-review.immich.oldest', { startDate, endDate, oldest, scanned: assets.length });
    return oldest;
  }

  async getPhotosForDateRange(startDate, endDate) {
    const takenAfter = new Date(`${startDate}T00:00:00.000Z`).toISOString();
    const endPlusOne = new Date(`${endDate}T00:00:00.000Z`);
    endPlusOne.setDate(endPlusOne.getDate() + 1);
    const takenBefore = endPlusOne.toISOString();

    this.#logger.debug?.('weekly-review.immich.search', { startDate, endDate, takenAfter, takenBefore });

    const [result, hidden] = await Promise.all([
      this.#client.searchMetadata({ takenAfter, takenBefore, size: 500 }),
      this.#hiddenAssetIds({ takenAfter, takenBefore }),
    ]);

    const assets = (result.items || result || []).filter(a => !hidden.has(a.id));
    if (hidden.size > 0) {
      this.#logger.debug?.('weekly-review.immich.hidden', { startDate, endDate, hidden: hidden.size });
    }

    if (assets.length === 0) {
      this.#logger.warn?.('weekly-review.immich.no-assets', { startDate, endDate });
    }

    const byDate = new Map();
    for (const asset of assets) {
      if (asset.type !== 'IMAGE' && asset.type !== 'VIDEO') continue;
      const date = asset.localDateTime.slice(0, 10);
      if (!byDate.has(date)) byDate.set(date, []);
      byDate.get(date).push(asset);
    }

    const days = [];
    const cursor = new Date(`${startDate}T00:00:00.000Z`);
    const end = new Date(`${endDate}T00:00:00.000Z`);

    while (cursor <= end) {
      const dateStr = cursor.toISOString().slice(0, 10);
      const dayAssets = byDate.get(dateStr) || [];
      const processed = this.#processDay(dateStr, dayAssets);
      this.#logger.debug?.('weekly-review.immich.day-summary', {
        date: dateStr,
        photoCount: processed.photoCount,
        sessionCount: processed.sessions.length,
        heroSelected: processed.photos.some(p => p.isHero),
      });
      days.push(processed);
      cursor.setDate(cursor.getDate() + 1);
    }

    this.#logger.info?.('weekly-review.immich.done', {
      totalPhotos: assets.filter(a => a.type === 'IMAGE').length,
      totalVideos: assets.filter(a => a.type === 'VIDEO').length,
      days: days.length,
    });

    return days;
  }

  /**
   * Ids of assets in the window carrying a hidden tag (e.g. `NoShow`).
   * Search results do not include tags, so the hidden set is fetched with its
   * own tag-filtered search and subtracted. A failure here propagates: showing
   * a hidden photo is worse than a review that fails to load.
   */
  async #hiddenAssetIds({ takenAfter, takenBefore }) {
    const ids = new Set();
    if (this.#hiddenTags.length === 0 || typeof this.#client.getTags !== 'function') return ids;

    const tags = await this.#client.getTags();
    const tagIds = (tags || [])
      // `name` is the leaf, `value` the full path — match either so a nested tag counts.
      .filter(t => [t.name, t.value].some(n => n && this.#hiddenTags.includes(n.toLowerCase())))
      .map(t => t.id);

    // tagIds on /search/metadata is AND across ids, so search each tag alone.
    for (const tagId of tagIds) {
      let page = 1;
      while (page) {
        const result = await this.#client.searchMetadata({ takenAfter, takenBefore, tagIds: [tagId], size: 1000, page });
        for (const asset of result?.items || result || []) ids.add(asset.id);
        page = result?.nextPage ? Number(result.nextPage) : null;
      }
    }
    return ids;
  }

  #processDay(date, assets) {
    return buildPhotoReviewDay({
      date,
      assets,
      priorityPeople: this.#priorityPeople,
      sessionGapMs: this.#sessionGapMs,
      projectAsset: (asset, policy) => {
        const isVideo = asset.type === 'VIDEO';
        return {
          id: asset.id,
          type: isVideo ? 'video' : 'image',
          thumbnail: `${this.#proxyPath}/assets/${asset.id}/thumbnail`,
          original: isVideo
            ? `${this.#proxyPath}/assets/${asset.id}/original`
            : `${this.#proxyPath}/assets/${asset.id}/thumbnail?size=preview`,
          people: policy.people,
          isHero: policy.isHero,
          sessionIndex: policy.sessionIndex,
          takenAt: asset.localDateTime,
        };
      },
    });
  }
}
