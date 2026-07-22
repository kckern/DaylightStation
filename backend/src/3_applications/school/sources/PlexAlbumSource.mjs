/**
 * PlexAlbumSource - Plex artist -> album -> track hierarchy as School
 * materials (spec §4, `plex-album` row).
 *
 * `plexClient.children(ratingKey)` is the only collaborator call — the
 * constructor-injected seam onto Plex's `/library/metadata/{id}/children`
 * endpoint (Task 5 wires the real adapter). `listMaterials` walks one level
 * (artist -> albums); `getMaterial` walks the next (album -> tracks) and
 * derives the album's own title/poster from a track's `parentTitle` /
 * `parentThumb` — Plex track metadata always carries its parent (album)
 * fields, so no second fetch is needed.
 *
 * Gotcha (spec §4, verified 2026-07-22 against Plex artist `619778`): album
 * entries carry NO `duration` attribute at all — only their tracks do.
 * `getMaterial` therefore sums the mapped units' `durationMs` instead of
 * reading the album's own field; `listMaterials` (which only sees the album,
 * never its tracks) always reports `durationMs: null`.
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
   * Artist -> albums. No units (spec §4: `listMaterials` is for the catalog
   * grid only).
   *
   * @param {string} rootPlexId - artist rating key (bare or `plex:`-prefixed)
   * @returns {Promise<Array<{id:string, title:string, poster:?string, source:string, medium:string, durationMs:null, unitCount:?number}>>}
   */
  async listMaterials(rootPlexId) {
    const albums = await this.#plexClient.children(stripPrefix(rootPlexId));
    return albums.map((album) => ({
      id: `plex:${album.ratingKey}`,
      title: album.title,
      poster: album.thumb ?? null,
      source: SOURCE,
      medium: MEDIUM,
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
