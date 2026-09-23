// backend/src/3_applications/fitness/suggestions/suggestibleEpisode.mjs

/**
 * Whether an episode may ever appear as a suggestion card, from any strategy.
 *
 * Season 0 is where a show keeps its extras (Morning Meltdown 100's "Specials"
 * led the grid as Next Up on 2026-09-22), and anything shorter than the policy
 * minimum is an intro or filler rather than a workout. An unknown duration is
 * given the benefit of the doubt.
 *
 * @param {{ seasonIndex?: number|null, duration?: number|null }} episode - duration in seconds
 * @param {{ minimumDurationSeconds?: number }} suggestionPolicy
 * @returns {boolean}
 */
export function isSuggestibleEpisode({ seasonIndex, duration } = {}, suggestionPolicy = {}) {
  if (seasonIndex === 0) return false;
  const minimum = suggestionPolicy.minimumDurationSeconds ?? 600;
  if (duration > 0 && duration < minimum) return false;
  return true;
}

/** Adapter for playable items, which carry the season as metadata.parentIndex. */
export function isSuggestiblePlayable(ep, suggestionPolicy) {
  return isSuggestibleEpisode(
    { seasonIndex: ep?.metadata?.parentIndex ?? ep?.parentIndex, duration: ep?.duration },
    suggestionPolicy,
  );
}
