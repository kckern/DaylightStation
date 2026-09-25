// backend/src/3_applications/fitness/suggestions/episodeLaunchFields.mjs

/**
 * The episode context the Fitness player needs to launch a suggestion the same
 * way the show screen does.
 *
 * A card played straight from the home grid never passes through the show
 * screen, so anything the card leaves out the player never sees. Without
 * `thumbId` the footer seek strip cannot ask Plex for timeline frames and
 * repeats the poster in every slot (2026-09-25, Sonic & Sega All Stars Racing).
 *
 * @param {object} ep - a playable item from FitnessPlayableService.getPlayableEpisodes
 * @param {{ parents?: Record<string, { title?: string, thumbnail?: string }>|null }} [episodeData]
 * @returns {{ thumbId: number|null, parentId: number|string|null, parentTitle: string|null,
 *   grandparentTitle: string|null, seasonImage: string|null }}
 */
export function episodeLaunchFields(ep, episodeData) {
  const parentId = ep?.parentId ?? ep?.metadata?.parentId ?? null;
  const season = parentId != null ? episodeData?.parents?.[parentId] ?? null : null;
  return {
    thumbId: ep?.thumbId ?? ep?.metadata?.thumbId ?? null,
    parentId,
    parentTitle: ep?.parentTitle ?? ep?.metadata?.parentTitle ?? season?.title ?? null,
    grandparentTitle: ep?.grandparentTitle ?? ep?.metadata?.grandparentTitle ?? null,
    seasonImage: season?.thumbnail ?? null,
  };
}
