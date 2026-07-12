// backend/src/1_adapters/feed/sources/StravaFeedAdapter.mjs
/**
 * StravaFeedAdapter
 *
 * Reads Strava activity data from UserDataService and normalizes to FeedItem shape.
 *
 * @module adapters/feed/sources/StravaFeedAdapter
 */

import { IFeedSourceAdapter, CONTENT_TYPES } from '#apps/feed/ports/IFeedSourceAdapter.mjs';

/**
 * Deterministic FNV-1a 32-bit hash of a string, base36-encoded.
 * Used to derive stable IDs from an item's own content when no source id
 * exists — same content yields the same id across fetches (F-22).
 */
function fnv1a(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

export class StravaFeedAdapter extends IFeedSourceAdapter {
  #userDataService;
  #logger;

  constructor({ userDataService, logger = console }) {
    super();
    if (!userDataService) throw new Error('StravaFeedAdapter requires userDataService');
    this.#userDataService = userDataService;
    this.#logger = logger;
  }

  get sourceType() { return 'strava'; }
  get provides() { return [CONTENT_TYPES.FITNESS]; }

  async fetchItems(query, username) {
    try {
      const data = this.#userDataService.getLifelogData(username, 'strava');
      if (!data) return [];

      const daysBack = query.params?.daysBack || 3;
      const cutoff = new Date(Date.now() - daysBack * 24 * 60 * 60 * 1000);

      let activities = [];
      if (Array.isArray(data)) {
        activities = data;
      } else if (typeof data === 'object') {
        for (const [date, dayData] of Object.entries(data)) {
          if (new Date(date) >= cutoff) {
            const items = Array.isArray(dayData) ? dayData : [dayData];
            activities.push(...items.map(a => ({ ...a, _date: date })));
          }
        }
      }

      return activities.slice(0, 5).map(activity => ({
        // Stable id: prefer the real Strava activity id, then the date, else a
        // deterministic hash of the activity's own identity fields (F-22).
        id: `strava:${activity.id || activity._date || fnv1a([
          activity.start_date, activity.name, activity.title, activity.type, activity.minutes,
        ].map(v => v ?? '').join('|'))}`,
        tier: query.tier || 'compass',
        source: 'fitness',
        title: activity.title || activity.type || 'Activity',
        body: this.#formatSummary(activity),
        image: null,
        link: null,
        timestamp: activity._date || new Date().toISOString(),
        priority: query.priority || 10,
        meta: {
          type: activity.type,
          minutes: activity.minutes,
          avgHeartrate: activity.avgHeartrate,
          maxHeartrate: activity.maxHeartrate,
          sufferScore: activity.suffer_score,
          sourceName: 'Strava',
          sourceIcon: null,
        },
      }));
    } catch (err) {
      this.#logger.warn?.('strava.adapter.error', { error: err.message });
      return [];
    }
  }

  async getDetail(localId, meta, _username) {
    const items = [];
    if (meta.type) items.push({ label: 'Type', value: meta.type });
    if (meta.minutes) items.push({ label: 'Duration', value: `${Math.round(meta.minutes)} min` });
    if (meta.avgHeartrate) items.push({ label: 'Avg HR', value: `${Math.round(meta.avgHeartrate)} bpm` });
    if (meta.maxHeartrate) items.push({ label: 'Max HR', value: `${Math.round(meta.maxHeartrate)} bpm` });
    if (meta.sufferScore) items.push({ label: 'Suffer Score', value: String(meta.sufferScore) });
    if (items.length === 0) return null;
    return { sections: [{ type: 'stats', data: { items } }] };
  }

  #formatSummary(activity) {
    const parts = [];
    if (activity.distance) {
      const miles = (activity.distance / 1609.34).toFixed(1);
      parts.push(`${miles} mi`);
    }
    if (activity.minutes) {
      parts.push(`${Math.round(activity.minutes)} min`);
    }
    if (activity.avgHeartrate) {
      parts.push(`${Math.round(activity.avgHeartrate)} bpm avg`);
    }
    return parts.join(' \u00b7 ') || activity.type || '';
  }
}
