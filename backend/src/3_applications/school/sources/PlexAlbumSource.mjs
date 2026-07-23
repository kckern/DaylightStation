/**
 * PlexAlbumSource - Plex collection -> album(work) -> track(chapter) hierarchy
 * as School materials (spec §4, `plex-album` row).
 *
 * An audio anthology (Shakespeare Tales, I Survived) is one **collection** with
 * many **works** (plays/books), each a run of ordered **chapters**. The
 * taxonomy is three levels, so the source exposes three walks over the single
 * `plexClient.children(ratingKey)` seam:
 *
 *   listMaterials(root)  -> ONE collection material (kind:'collection'); the
 *                           shelf shows the anthology as a single tile, not
 *                           one tile per work.
 *   listWorks(root)      -> the works (albums), for the collection browser.
 *   getMaterial(workId)  -> a work's chapters (tracks) as ordered units, the
 *                           audio equivalent of a show's episodes.
 *
 * `getMaterial` derives the work's own title/poster from a track's
 * `parentTitle`/`parentThumb` (Plex track metadata always carries its parent
 * (album) fields, so no second fetch is needed).
 *
 * Gotcha (spec §4, verified 2026-07-22 against Plex `619778`): album entries
 * carry NO `duration` attribute — only their tracks do. `getMaterial` sums the
 * mapped units' `durationMs`; the list walks report `durationMs: null`.
 *
 * Category is NOT stamped here — that is the catalog use-case's job (spec §3).
 */

const SOURCE = 'plex-album';
const MEDIUM = 'audio';

function stripPrefix(id) {
  const s = String(id ?? '');
  return s.startsWith('plex:') ? s.slice(5) : s;
}

export class PlexAlbumSource {
  #plexClient;
  #logger;

  /**
   * @param {Object} deps
   * @param {{children:function(string):Promise<Object[]>}} deps.plexClient - Contract:
   *   `children()` results' `thumb`/`parentThumb` fields must already be
   *   app-proxied (the real wiring in app.mjs's `schoolPlexClient` seam
   *   rewrites Plex's raw `/library/metadata/...` paths before this source
   *   ever sees them). This source passes `poster` straight through unmodified.
   * @param {Object} [deps.logger]
   */
  constructor({ plexClient, logger = console }) {
    this.#plexClient = plexClient;
    this.#logger = logger;
  }

  /**
   * Collection -> ONE collection material. The shelf shows the anthology as a
   * single tile; its works are fetched on drill-in via `listWorks`. Title/
   * poster come from a child album's `parentTitle`/`parentThumb` (the
   * collection's own fields), with a fallback to the first album's fields; the
   * catalog additionally prefers the configured source `label` for the title.
   *
   * @param {string} rootPlexId - collection rating key (bare or `plex:`-prefixed)
   * @returns {Promise<Array<{id:string, title:?string, poster:?string, source:string, medium:string, kind:string, durationMs:null, unitCount:number}>>}
   */
  async listMaterials(rootPlexId) {
    const root = stripPrefix(rootPlexId);
    const albums = await this.#plexClient.children(root);
    const first = albums[0] || {};
    return [{
      id: `plex:${root}`,
      title: first.parentTitle ?? null,
      poster: first.parentThumb ?? first.thumb ?? null,
      source: SOURCE,
      medium: MEDIUM,
      kind: 'collection',
      durationMs: null,
      unitCount: albums.length,
    }];
  }

  /**
   * Collection -> works (albums). The collection browser's grid.
   *
   * @param {string} rootPlexId - collection rating key (bare or `plex:`-prefixed)
   * @returns {Promise<Array<{id:string, title:string, poster:?string, source:string, medium:string, kind:string, durationMs:null, unitCount:?number}>>}
   */
  async listWorks(rootPlexId) {
    const albums = await this.#plexClient.children(stripPrefix(rootPlexId));
    return albums.map((album) => ({
      id: `plex:${album.ratingKey}`,
      title: album.title,
      poster: album.thumb ?? null,
      summary: album.summary ?? null, // Plex description, shown under the detail poster
      source: SOURCE,
      medium: MEDIUM,
      kind: 'work',
      durationMs: null, // spec §4 gotcha: Plex albums carry no duration attribute
      unitCount: album.leafCount ?? null,
    }));
  }

  /**
   * Album -> tracks. `material.durationMs` is the sum of the tracks'
   * durations (spec §4 gotcha).
   *
   * @param {string} materialPlexId - album rating key (bare or `plex:`-prefixed)
   * @returns {Promise<{id:string, title:?string, poster:?string, source:string, medium:string, durationMs:number, unitCount:number, units:Array<{id:string, index:number, title:string, durationMs:?number, group:null}>}>}
   */
  async getMaterial(materialPlexId) {
    const albumId = stripPrefix(materialPlexId);
    const tracks = await this.#plexClient.children(albumId);

    const units = tracks.map((track, i) => ({
      id: `plex:${track.ratingKey}`,
      index: track.index ?? i + 1,
      title: track.title,
      durationMs: track.duration ?? null,
      group: null, // audio is flat — no season-equivalent grouping (spec §2)
    }));

    const durationMs = units.reduce((sum, u) => sum + (u.durationMs ?? 0), 0);
    const first = tracks[0] || {};

    return {
      id: `plex:${albumId}`,
      title: first.parentTitle ?? null,
      poster: first.parentThumb ?? null,
      source: SOURCE,
      medium: MEDIUM,
      durationMs,
      unitCount: units.length,
      units,
    };
  }
}

export default PlexAlbumSource;
