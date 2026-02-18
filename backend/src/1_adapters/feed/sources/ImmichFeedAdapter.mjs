// backend/src/1_adapters/feed/sources/ImmichFeedAdapter.mjs
/**
 * ImmichFeedAdapter
 *
 * Fetches random photos from Immich via IContentQueryPort and normalizes to FeedItem shape.
 *
 * @module adapters/feed/sources/ImmichFeedAdapter
 */

import { IFeedSourceAdapter, CONTENT_TYPES } from '#apps/feed/ports/IFeedSourceAdapter.mjs';

export class ImmichFeedAdapter extends IFeedSourceAdapter {
  #contentQueryPort;
  #contentRegistry;
  #webUrl;
  #logger;

  constructor({ contentQueryPort, contentRegistry = null, webUrl = null, logger = console }) {
    super();
    if (!contentQueryPort) throw new Error('ImmichFeedAdapter requires contentQueryPort');
    this.#contentQueryPort = contentQueryPort;
    this.#contentRegistry = contentRegistry;
    this.#webUrl = webUrl;
    this.#logger = logger;
  }

  get sourceType() { return 'immich'; }
  get provides() { return [CONTENT_TYPES.PHOTOS]; }

  async fetchItems(query, _username) {
    try {
      const result = await this.#contentQueryPort.search({
        text: '',
        source: 'immich',
        take: query.limit || 3,
        sort: 'random',
      });
      const items = result.items || [];

      // Enrich with EXIF data (capturedAt, location) via individual asset lookups
      const enriched = await this.#enrichWithExif(items);

      return enriched.map(({ item, exif }) => {
        const localId = item.localId || item.id?.replace?.('immich:', '') || item.id;
        const created = exif?.capturedAt || item.metadata?.capturedAt || null;
        const location = exif?.location || item.metadata?.location || null;
        const people = exif?.people || [];
        const title = this.#buildPhotoTitle(people, location, created);
        const subtitle = created ? this.#formatDate(created) : null;
        return {
          id: `immich:${localId}`,
          tier: query.tier || 'scrapbook',
          source: 'photo',
          title,
          subtitle,
          body: location,
          image: item.imageUrl || `/api/v1/proxy/immich/assets/${localId}/original`,
          link: this.#webUrl ? `${this.#webUrl}/photos/${localId}` : null,
          timestamp: created || new Date().toISOString(),
          priority: query.priority || 5,
          meta: {
            location,
            originalDate: created,
            sourceName: 'Photos',
            sourceIcon: 'https://immich.app',
            ...(exif?.imageWidth && exif?.imageHeight
              ? { imageWidth: exif.imageWidth, imageHeight: exif.imageHeight }
              : {}),
            ...(people.length > 0 ? { people } : {}),
          },
        };
      });
    } catch (err) {
      this.#logger.warn?.('immich.adapter.error', { error: err.message });
      return [];
    }
  }

  async getDetail(localId, meta, _username) {
    const sections = [];

    let capturedAt = null;
    let isVideo = false;
    const exifItems = [];
    const immichAdapter = this.#contentRegistry?.get('immich');
    if (immichAdapter && typeof immichAdapter.getViewable === 'function') {
      try {
        const viewable = await immichAdapter.getViewable(localId);
        isVideo = viewable?.metadata?.type === 'VIDEO';
        capturedAt = viewable?.metadata?.capturedAt || null;
        const exif = viewable?.metadata?.exif;
        if (exif) {
          if (exif.make) exifItems.push({ label: 'Camera', value: `${exif.make} ${exif.model || ''}`.trim() });
        }
      } catch { /* proceed without EXIF */ }
    }

    if (isVideo) {
      sections.push({ type: 'player', data: { contentId: `immich:${localId}` } });
    }

    if (exifItems.length > 0) {
      sections.push({ type: 'metadata', data: { items: exifItems } });
    }

    // Fetch sibling photos from the same time period
    if (capturedAt && immichAdapter && typeof immichAdapter.search === 'function') {
      try {
        const gallery = await this.#fetchSiblingPhotos(immichAdapter, localId, capturedAt);
        if (gallery.length > 0) {
          sections.push({ type: 'gallery', data: { items: gallery } });
        }
      } catch { /* proceed without gallery */ }
    }

    return { sections };
  }

  async #fetchSiblingPhotos(adapter, excludeId, capturedAt) {
    const d = new Date(capturedAt);
    const MAX = 16;

    const ranges = [
      [new Date(d.getFullYear(), d.getMonth(), d.getDate()),
       new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999)],
      [new Date(d.getFullYear(), d.getMonth(), d.getDate() - d.getDay()),
       new Date(d.getFullYear(), d.getMonth(), d.getDate() + (6 - d.getDay()), 23, 59, 59, 999)],
      [new Date(d.getFullYear(), d.getMonth(), 1),
       new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59, 999)],
    ];

    for (const [start, end] of ranges) {
      const result = await adapter.search({
        dateFrom: start.toISOString(),
        dateTo: end.toISOString(),
        take: MAX + 1,
        mediaType: 'IMAGE',
      });

      const items = (result.items || [])
        .filter(item => {
          const id = item.localId || item.id?.replace?.('immich:', '') || item.id;
          return id !== excludeId;
        })
        .slice(0, MAX)
        .map(item => {
          const id = item.localId || item.id?.replace?.('immich:', '') || item.id;
          return {
            id: `immich:${id}`,
            source: 'photo',
            image: `/api/v1/proxy/immich/assets/${id}/thumbnail`,
            timestamp: item.metadata?.capturedAt || null,
            meta: { sourceName: 'Photos', sourceIcon: 'https://immich.app' },
          };
        });

      if (items.length >= 2) return items;
    }

    return [];
  }

  async #enrichWithExif(items) {
    const immichAdapter = this.#contentRegistry?.get('immich');
    if (!immichAdapter || typeof immichAdapter.getViewable !== 'function') {
      return items.map(item => ({ item, exif: null }));
    }

    return Promise.all(items.map(async (item) => {
      try {
        const localId = item.localId || item.id?.replace?.('immich:', '') || item.id;
        const viewable = await immichAdapter.getViewable(localId);
        return {
          item,
          exif: viewable?.metadata ? {
            capturedAt: viewable.metadata.capturedAt,
            location: viewable.metadata.exif?.city || null,
            imageWidth: viewable.width || null,
            imageHeight: viewable.height || null,
            people: viewable.metadata.people || [],
          } : null,
        };
      } catch {
        return { item, exif: null };
      }
    }));
  }

  #buildPhotoTitle(people, location, created) {
    const names = people.filter(n => n && n.trim());
    if (names.length > 0) {
      const parts = [this.#formatPeopleList(names)];
      if (location) parts.push(location);
      return parts.join(' \u2022 ');
    }
    if (location && created) {
      const period = this.#getTimeOfDayLabel(created);
      return period ? `${period} in ${location}` : location;
    }
    if (location) return location;
    return created ? this.#formatDayPeriod(created) : 'Memory';
  }

  #formatPeopleList(names) {
    if (names.length === 1) return names[0];
    if (names.length === 2) return `${names[0]} and ${names[1]}`;
    return `${names.slice(0, -1).join(', ')}, and ${names[names.length - 1]}`;
  }

  #getTimeOfDayLabel(iso) {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return null;
    const h = d.getHours();
    if (h < 6) return 'Late Night';
    if (h < 9) return 'Morning';
    if (h < 11) return 'Mid-Morning';
    if (h < 13) return 'Lunchtime';
    if (h < 17) return 'Afternoon';
    if (h < 21) return 'Evening';
    return 'Night';
  }

  #formatDayPeriod(iso) {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return 'Memory';
    const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const label = this.#getTimeOfDayLabel(iso);
    return `${days[d.getDay()]} ${label}`;
  }

  #formatDate(iso) {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return 'Memory';
    const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const day = days[d.getDay()];
    const date = d.getDate();
    const month = months[d.getMonth()];
    const year = d.getFullYear();
    let hours = d.getHours();
    const mins = String(d.getMinutes()).padStart(2, '0');
    const ampm = hours >= 12 ? 'pm' : 'am';
    hours = hours % 12 || 12;
    return `${day} ${date} ${month}, ${year} ${hours}:${mins}${ampm}`;
  }
}
