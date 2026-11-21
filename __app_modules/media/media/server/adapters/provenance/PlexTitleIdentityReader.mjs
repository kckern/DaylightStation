/**
 * A Plex item's identity in external ids (IMDb/TMDB), for availability lookups.
 * Movies and shows answer for themselves; an episode or season answers as its
 * show, since services carry shows, not single episodes.
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
    return {
      key: String(md.ratingKey ?? rk),
      kind: md.type,
      title: md.title ?? null,
      year: Number.isFinite(md.year) ? md.year : null,
      imdb, tmdb,
    };
  }
}
