/**
 * Build the play-queue item for an episode launched from a FitnessShow grid.
 *
 * Two things travel on a queue item and they are kept apart:
 *
 *  - ITEM IDENTITY — what the episode is. `parentId` / `season` / `seasonImage`
 *    are its own season, `grandparentId` / `grandparentTitle` / `show` /
 *    `showImage` its own show. These come from the episode's own metadata and
 *    the API's real `parents` map, never from the screen it was launched from.
 *
 *  - LAUNCH CONTEXT — where it was launched from: `launchContext` names the
 *    container the grid was showing (a show, a season, a playlist) and, for a
 *    paged playlist, the page (`groupId`). It is for "go back to where I was"
 *    and for telemetry. It is not a source of art, titles or history grouping.
 *
 * A playlist page's poster is one show's art picked to decorate the tab; using
 * it as an item's season art put another programme's poster on the seek
 * timeline. See __docs/reference/fitness/item-identity-vs-launch-context.md.
 */

/** Containers whose items belong to other shows. */
const AGGREGATE_TYPES = new Set(['playlist', 'collection']);

/** The grid group an item is listed under: a playlist page, else its season. */
export const gridGroupIdOf = (item) => item?.groupId ?? item?.parentId ?? null;

const stripSource = (id) => (id == null ? null : String(id).replace(/^[a-z]+:/i, ''));

/**
 * @param {Object} args
 * @param {Object} args.episode       playable item as the grid holds it
 * @param {Object} args.container     `{ id, info }` of the screen it was launched from
 * @param {Object} [args.parents]     API `parents` map: real seasons keyed by id
 * @param {Object} [args.groups]      virtual page map (playlists), keyed by groupId
 * @param {string} [args.plexId]
 * @param {string} [args.mediaUrl]
 * @param {number} [args.resumeSeconds]
 * @param {number} [args.watchProgress]
 * @param {string[]} [args.labels]
 * @param {boolean} [args.nogovern]
 * @param {(id: string|number) => string} args.displayUrl   content id → image URL
 * @param {(url: string) => string} [args.normalizeUrl]     API image path → URL
 */
export function buildEpisodeQueueItem({
  episode,
  container = {},
  parents = null,
  groups = null,
  plexId = null,
  mediaUrl,
  resumeSeconds,
  watchProgress,
  labels = [],
  nogovern = false,
  displayUrl,
  normalizeUrl = (url) => url,
}) {
  const info = container.info || {};
  const containerId = stripSource(container.id);
  const containerType = info.type || 'show';
  const isAggregate = AGGREGATE_TYPES.has(containerType) || episode.groupId != null;

  // --- item identity ---
  const seasonId = episode.parentId ?? null;
  const season = (parents && seasonId != null && parents[seasonId]) || null;
  const seasonTitle = season?.title || episode.parentTitle || undefined;
  const seasonImage = season?.thumbnail
    ? normalizeUrl(season.thumbnail)
    : (seasonId != null ? displayUrl(seasonId) : undefined);

  // Outside an aggregate the container IS the item's show, so it may stand in
  // for a missing grandparent. A playlist is never anybody's show.
  const showId = episode.grandparentId ?? (isAggregate ? null : containerId);
  const showTitle = episode.grandparentTitle || (isAggregate ? '' : (info.title || ''));
  const showImage = showId != null ? displayUrl(showId) : undefined;

  // --- launch context ---
  const groupId = episode.groupId ?? null;
  const launchContext = containerId == null ? null : {
    type: containerType,
    id: containerId,
    title: info.title || null,
    image: info.image ? normalizeUrl(info.image) : null,
    ...(groupId != null ? { groupId, groupTitle: groups?.[groupId]?.title || null } : {}),
  };

  const candidateId = plexId || episode.id || `episode-${Date.now()}`;
  return {
    id: candidateId,
    contentId: plexId
      ? `plex:${plexId}`
      : (typeof candidateId === 'string' && /^[a-z]+:/i.test(candidateId) ? candidateId : null),
    plex: plexId,
    source: plexId ? 'plex' : (episode.source || null),
    // `label` on a playlist page is the grid caption ("Show—Episode").
    title: episode.itemLabel || episode.label,
    show: showTitle || undefined,
    season: seasonTitle,
    grandparentTitle: String(showTitle || ''),
    grandparentId: showId ?? undefined,
    showId: showId ?? undefined,
    showImage,
    parentId: seasonId ?? undefined,
    parentTitle: seasonTitle,
    parentImage: seasonImage,
    seasonImage,
    launchContext,
    summary: episode.summary || null,
    mediaUrl,
    duration: episode.duration,
    thumbId: episode.thumbId,
    image: episode.thumbId ? displayUrl(episode.thumbId) : episode.image,
    labels,
    type: episode.type || 'episode',
    seconds: resumeSeconds,
    watchSeconds: resumeSeconds || undefined,
    watchProgress: Number.isFinite(watchProgress) ? watchProgress : undefined,
    nogovern: nogovern || undefined,
  };
}

/**
 * Art for the first (0:00) tile of the seek timeline: the item's own season,
 * else its own show, else its own frame. Never the launch context.
 */
export const originTileImage = (item) =>
  item?.seasonImage || item?.showImage || item?.image || null;

/** Where "back" goes after an episode: the screen it was launched from. */
export const browseContainerIdOf = (item) =>
  item?.launchContext?.id || item?.showId || item?.grandparentId || null;
