import { ISchoolMediaCatalog } from '#apps/school/ports/ISchoolMediaCatalog.mjs';

const KIND = Object.freeze({
  album: 'album',
  track: 'track',
  show: 'series',
  season: 'season',
  episode: 'episode',
  collection: 'collection',
});

/** Plex translation for the provider-neutral School media-catalog port. */
export class PlexSchoolMediaCatalog extends ISchoolMediaCatalog {
  #adapter;

  constructor({ plexAdapter } = {}) {
    super();
    this.#adapter = plexAdapter ?? null;
  }

  canonicalId(reference) {
    const value = String(reference ?? '');
    return value.startsWith('plex:') ? value : `plex:${value}`;
  }

  async listChildren(reference) {
    if (!this.#adapter?.client) return [];
    const data = await this.#adapter.client.getContainer(`/library/metadata/${rawId(reference)}/children`);
    return (data?.MediaContainer?.Metadata ?? []).map((item) => this.#map(item));
  }

  async listLeaves(reference) {
    if (!this.#adapter?.client) return [];
    // ONE call for every leaf under the container (all tracks of an artist's
    // albums, all episodes of a show) — each row carries parentRatingKey, so
    // chapter→work mapping never needs per-album children fetches.
    const data = await this.#adapter.client.getContainer(`/library/metadata/${rawId(reference)}/allLeaves`);
    return (data?.MediaContainer?.Metadata ?? []).map((item) => this.#map(item));
  }

  async listTagged(libraryReference, label) {
    if (!this.#adapter?.client) return [];
    const sectionId = rawId(libraryReference);
    const directory = await this.#adapter.client.getContainer(`/library/sections/${sectionId}/label`);
    const tag = (directory?.MediaContainer?.Directory ?? [])
      .find((entry) => String(entry.title).toLowerCase() === label.toLowerCase());
    if (!tag) return [];

    const ids = [];
    for (const type of [2, 3, 9]) {
      // eslint-disable-next-line no-await-in-loop
      const listed = await this.#adapter.client.getContainer(`/library/sections/${sectionId}/all?type=${type}&label=${tag.key}`);
      for (const item of listed?.MediaContainer?.Metadata ?? []) ids.push(item.ratingKey);
    }
    if (!ids.length) return [];
    const metadata = await this.#adapter.client.getContainer(`/library/metadata/${ids.join(',')}`);
    return (metadata?.MediaContainer?.Metadata ?? []).map((item) => this.#map(item));
  }

  async getItem(reference) {
    if (!this.#adapter?.client) return null;
    const data = await this.#adapter.client.getContainer(`/library/metadata/${rawId(reference)}`);
    const item = data?.MediaContainer?.Metadata?.[0];
    return item ? this.#map(item) : null;
  }

  #map(item) {
    const kind = KIND[item.type] ?? String(item.type ?? 'unknown');
    return {
      id: this.canonicalId(item.ratingKey),
      kind,
      medium: kind === 'album' || kind === 'track' ? 'audio' : 'video',
      title: item.title ?? null,
      summary: item.summary ?? null,
      poster: this.#poster(item.thumb),
      durationMs: item.duration == null ? null : Number(item.duration),
      index: item.index ?? null,
      childCount: item.leafCount ?? null,
      parentId: item.parentRatingKey != null ? this.canonicalId(item.parentRatingKey) : null,
      labels: (item.Label ?? []).map((entry) => String(entry.tag)),
      parent: (item.parentTitle || item.parentThumb) ? {
        title: item.parentTitle ?? null,
        poster: this.#poster(item.parentThumb),
      } : null,
      seriesTitle: item.grandparentTitle ?? null,
    };
  }

  #poster(value) {
    if (typeof value !== 'string' || !value) return null;
    return value.startsWith('/') ? `${this.#adapter.proxyPath}${value}` : value;
  }
}

function rawId(reference) {
  return String(reference ?? '').replace(/^plex:/, '');
}

export default PlexSchoolMediaCatalog;
