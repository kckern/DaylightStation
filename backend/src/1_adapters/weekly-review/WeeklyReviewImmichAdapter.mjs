// backend/src/1_adapters/weekly-review/WeeklyReviewImmichAdapter.mjs
import { buildPhotoReviewDay } from '#domains/weekly-review/photoReviewPolicy.mjs';

export class WeeklyReviewImmichAdapter {
  #client;
  #priorityPeople;
  #proxyPath;
  #sessionGapMs;
  #logger;

  constructor(config = {}, deps = {}) {
    if (!deps.client) {
      throw new Error('WeeklyReviewImmichAdapter requires client dependency');
    }
    this.#client = deps.client;
    this.#priorityPeople = (config.priorityPeople || []).map(n => n.toLowerCase());
    this.#proxyPath = config.proxyPath || '/proxy/immich';
    this.#sessionGapMs = (config.sessionGapMinutes || 120) * 60 * 1000;
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

    const result = await this.#client.searchMetadata({
      takenAfter,
      takenBefore: endPlusOne.toISOString(),
      size: 1,
      order: 'asc',
    });

    const assets = result?.items || result || [];
    let oldest = null;
    for (const asset of assets) {
      if (asset.type !== 'IMAGE' && asset.type !== 'VIDEO') continue;
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

    const result = await this.#client.searchMetadata({
      takenAfter,
      takenBefore,
      size: 500,
    });

    const assets = result.items || result || [];

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
