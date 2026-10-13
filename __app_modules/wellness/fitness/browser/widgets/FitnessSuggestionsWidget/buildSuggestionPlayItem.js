import { DaylightMediaPath } from '@/lib/api.mjs';

function parseContentId(contentId) {
  if (!contentId) return { source: 'plex', localId: '' };
  const colonIdx = contentId.indexOf(':');
  if (colonIdx === -1) return { source: 'plex', localId: contentId };
  return { source: contentId.slice(0, colonIdx), localId: contentId.slice(colonIdx + 1) };
}

function withMediaPath(path) {
  return path ? DaylightMediaPath(String(path).replace(/^\//, '')) : undefined;
}

/**
 * Turn a suggestion card into a play-queue item shaped like the one the show
 * screen builds (FitnessShow's queueItem), so a launch from the home grid gets
 * the same player context: footer seek frames (thumbId), season art, resume.
 */
export function buildSuggestionPlayItem(suggestion) {
  const { source, localId } = parseContentId(suggestion.contentId);
  const { localId: showLocalId } = parseContentId(suggestion.showId);
  const isPlex = source === 'plex';
  const seasonImage = withMediaPath(suggestion.seasonImage);
  const playhead = suggestion.progress?.playhead;

  return {
    id: localId,
    contentId: suggestion.contentId,
    contentSource: source,
    ...(isPlex ? { plex: localId } : {}),
    type: 'episode',
    title: suggestion.title,
    show: suggestion.showTitle,
    season: suggestion.parentTitle || undefined,
    grandparentTitle: suggestion.grandparentTitle || suggestion.showTitle || '',
    grandparentId: showLocalId || undefined,
    showId: showLocalId || undefined,
    summary: suggestion.description || null,
    videoUrl: DaylightMediaPath(`api/v1/play/${source}/${localId}`),
    image: withMediaPath(suggestion.thumbnail) || DaylightMediaPath(`api/v1/display/${source}/${localId}`),
    thumbId: suggestion.thumbId ?? undefined,
    parentId: suggestion.parentId ?? undefined,
    parentImage: seasonImage,
    seasonImage,
    // The player reads duration in seconds; cards carry whole minutes.
    duration: Number.isFinite(suggestion.durationMinutes) ? suggestion.durationMinutes * 60 : undefined,
    labels: suggestion.labels || [],
    ...(Number.isFinite(playhead) && playhead > 0
      ? { seconds: playhead, watchSeconds: playhead, watchProgress: suggestion.progress?.percent }
      : {}),
  };
}

export { parseContentId };
