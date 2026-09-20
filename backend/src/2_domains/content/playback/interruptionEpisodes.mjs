const STALL_OPEN_MS = 1_000;
const HEALTHY_CLOSE_MS = 5_000;
const EXPECTED_CAUSES = new Set(['user-pause', 'app-pause', 'seek-warmup', 'suspension']);

function copy(state) {
  return (state || []).map(episode => ({ ...episode }));
}

/**
 * Reduces client observations into immutable, de-duplicated interruption
 * episodes. Expected pauses and seek/suspension warmups are not incidents.
 */
export function updateEpisodes({ state = [], observation = {}, now }) {
  const episodes = copy(state);
  const openIndex = episodes.findLastIndex(episode => episode.endedAt == null);

  if (observation.kind === 'progress' && Number(observation.healthyDurationMs) >= HEALTHY_CLOSE_MS && openIndex >= 0) {
    episodes[openIndex] = { ...episodes[openIndex], endedAt: now };
    return episodes;
  }

  const expected = observation.unexpected === false || EXPECTED_CAUSES.has(observation.cause)
    || observation.kind === 'seek-warmup' || observation.kind === 'suspension';
  if (observation.kind === 'no-progress' && !expected && Number(observation.durationMs) >= STALL_OPEN_MS && openIndex < 0) {
    return [...episodes, { startedAt: now, endedAt: null }];
  }
  return episodes;
}

export default updateEpisodes;
