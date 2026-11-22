/**
 * A Plex item's identity in external ids (IMDb/TMDB), for availability lookups,
 * and the facts the household's provenance rules read (studio, length,
 * collections, labels, library). Movies and shows answer for themselves; an
 * episode or season answers as its show, since services carry shows, not single
 * episodes.
 *
 * Reference: __docs/reference/media/provenance.md
 */
import { ITitleIdentityReader } from '../../application/provenance/ports/ITitleIdentityReader.mjs';
import { externalIdsFromGuids } from '../../domain/provenance/provenance.mjs';

export class PlexTitleIdentityReader extends ITitleIdentityReader {
  #plex;

  /** @param {{ plexClient: { request(path:string): Promise<object> } }} deps */
  constructor({ plexClient }) {
    super();
    if (!plexClient) throw new Error('PlexTitleIdentityReader requires plexClient');
    this.#plex = plexClient;
  }

  async #metadata(rk) {
    const data = await this.#plex.request(`/library/metadata/${rk}?includeGuids=1`);
    return data?.MediaContainer?.Metadata?.[0] ?? null;
  }

  async identify(ratingKey) {
    const rk = String(ratingKey ?? '');
    if (!/^\d+$/.test(rk)) return null;
    let md = await this.#metadata(rk);
    if (!md) return null;
    if (md.type === 'episode' || md.type === 'season') {
      const showKey = String((md.type === 'episode' ? md.grandparentRatingKey : md.parentRatingKey) ?? '');
      if (!/^\d+$/.test(showKey)) return null;
      md = await this.#metadata(showKey);
      if (!md) return null;
    }
    if (md.type !== 'movie' && md.type !== 'show') return null;
    const { imdb, tmdb } = externalIdsFromGuids(md.Guid);
    const tags = (list) => (Array.isArray(list) ? list.map((t) => t?.tag).filter(Boolean).map(String) : []);
    return {
      key: String(md.ratingKey ?? rk),
      kind: md.type,
      title: md.title ?? null,
      originalTitle: md.originalTitle ? String(md.originalTitle) : null,
      year: Number.isFinite(md.year) ? md.year : null,
      imdb, tmdb,
      studio: md.studio ? String(md.studio) : null,
      durationMs: Number.isFinite(md.duration) ? md.duration : null,
      collections: tags(md.Collection),
      labels: tags(md.Label),
      genres: tags(md.Genre),
      countries: tags(md.Country),
      summary: md.summary ? String(md.summary) : null,
      library: md.librarySectionTitle ? String(md.librarySectionTitle) : null,
    };
  }
}
