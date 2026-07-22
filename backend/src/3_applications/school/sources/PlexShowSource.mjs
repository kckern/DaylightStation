/**
 * PlexShowSource - Plex collection -> show -> season -> episode hierarchy as
 * School materials (spec §4, `plex-show` row).
 *
 * `listMaterials` walks one level (collection -> shows) via the injected
 * `plexClient.children` seam. `getMaterial` reuses
 * `FitnessPlayableService.getPlayableEpisodes` (spec §4 "plex-show reuses
 * getPlayableEpisodes — but discards its watch fields") for ordering, episode
 * metadata and resume-relevant fields — but discards every watch-state field
 * it adds. Plex watch state is per Plex *account*, not per child; School's
 * per-child state comes only from the progress store (spec §6), never from
 * here. Mapped units are built from an explicit allow-list of fields
 * ({id, index, title, durationMs, group}) rather than spread, so no
 * watch-state field (`isWatched`, `watchProgress`, `watchSeconds`,
 * `watchedDate`, or the underlying `metadata.viewCount`, `percent`,
 * `playhead`, `completedAt`, `lastPlayed`) can leak through by accident.
 *
 * Real field names (read from FitnessPlayableService.mjs:47-120 and
 * PlexAdapter.mjs's `#_toPlayableItem`, PlexAdapter.mjs:749-863, which builds
 * the items `getPlayableEpisodes` returns):
 *   - `item.id` is already `plex:<ratingKey>` (PlexAdapter.mjs:852).
 *   - `item.title` (PlexAdapter.mjs:855).
 *   - `item.duration` — Plex's raw millisecond value, already floor-divided
 *     to *seconds* by the adapter (`Math.floor(item.duration / 1000)`,
 *     PlexAdapter.mjs:858). School's `Unit.durationMs` wants milliseconds,
 *     so this source multiplies back by 1000.
 *   - `item.metadata.parentTitle` — the season title, set for `type ===
 *     'episode'` items (PlexAdapter.mjs:791). Used as `Unit.group`.
 *
 * `index` is the absolute position in `getPlayableEpisodes`' returned
 * (already-ordered) item array — NOT `item.metadata.itemIndex`, which is the
 * per-season Plex episode number and restarts at 1 every season, so it is
 * useless as a whole-material sequence number across a multi-season show.
 *
 * Category is NOT stamped here — that is the catalog use-case's job (spec §3).
 */

const SOURCE = 'plex-show';
const MEDIUM = 'video';

function stripPrefix(id) {
  const s = String(id ?? '');
  return s.startsWith('plex:') ? s.slice(5) : s;
}

export class PlexShowSource {
  #fitnessPlayableService;
  #plexClient;
  #logger;
  #householdId;

  /**
   * @param {Object} deps
   * @param {{getPlayableEpisodes:function(string, ?string):Promise<Object>}} deps.fitnessPlayableService
   * @param {{children:function(string):Promise<Object[]>}} deps.plexClient - Contract:
   *   `children()` results' `thumb` field must already be app-proxied (the
   *   real wiring in app.mjs's `schoolPlexClient` seam rewrites Plex's raw
   *   `/library/metadata/...` paths before this source ever sees them). This
   *   source passes `poster` straight through unmodified. `getMaterial`'s
   *   poster instead comes from `fitnessPlayableService`'s `info.image`,
   *   which is independently already-proxied by PlexAdapter — do not prefix
   *   it again here.
   * @param {Object} [deps.logger]
   * @param {?string} [deps.householdId]
   */
  constructor({ fitnessPlayableService, plexClient, logger = console, householdId = null }) {
    this.#fitnessPlayableService = fitnessPlayableService;
    this.#plexClient = plexClient;
    this.#logger = logger;
    this.#householdId = householdId;
  }

  /**
   * Collection -> shows. No units.
   *
   * @param {string} rootPlexId - collection rating key (bare or `plex:`-prefixed)
   * @returns {Promise<Array<{id:string, title:string, poster:?string, source:string, medium:string, durationMs:null, unitCount:?number}>>}
   */
  async listMaterials(rootPlexId) {
    const shows = await this.#plexClient.children(stripPrefix(rootPlexId));
    return shows.map((show) => ({
      id: `plex:${show.ratingKey}`,
      title: show.title,
      poster: show.thumb ?? null,
      source: SOURCE,
      medium: MEDIUM,
      durationMs: null, // no per-show duration attribute in Plex, same gotcha shape as plex-album
      unitCount: show.leafCount ?? null,
    }));
  }

  /**
   * Show -> episodes (across all seasons), via `getPlayableEpisodes`.
   *
   * @param {string} materialPlexId - show rating key (bare or `plex:`-prefixed)
   * @returns {Promise<{id:string, title:?string, poster:?string, source:string, medium:string, durationMs:number, unitCount:number, units:Array<{id:string, index:number, title:string, durationMs:?number, group:?string}>}>}
   */
  async getMaterial(materialPlexId) {
    const showId = stripPrefix(materialPlexId);
    const { info, items } = await this.#fitnessPlayableService.getPlayableEpisodes(showId, this.#householdId);

    const units = items.map((item, i) => ({
      id: String(item.id).startsWith('plex:') ? item.id : `plex:${item.id}`,
      index: i + 1, // absolute position — NOT metadata.itemIndex, which restarts per season
      title: item.title,
      durationMs: item.duration != null ? item.duration * 1000 : null, // seconds -> ms (PlexAdapter.mjs:858)
      group: item.metadata?.parentTitle ?? null, // season title, for episode items
    }));

    const durationMs = units.reduce((sum, u) => sum + (u.durationMs ?? 0), 0);

    return {
      id: `plex:${showId}`,
      title: info?.title ?? null,
      poster: info?.image ?? null,
      source: SOURCE,
      medium: MEDIUM,
      durationMs,
      unitCount: units.length,
      units,
    };
  }
}

export default PlexShowSource;
