import React, { useCallback } from 'react';
import { useScreenData } from '@/screen-framework/data/ScreenDataProvider.jsx';
import { useFitnessScreen } from '@/modules/Fitness/FitnessScreenProvider.jsx';
import { DaylightMediaPath } from '@/lib/api.mjs';
import SuggestionCard from './SuggestionCard.jsx';
import './FitnessSuggestionsWidget.scss';

function parseContentId(contentId) {
  if (!contentId) return { source: 'plex', localId: '' };
  const colonIdx = contentId.indexOf(':');
  if (colonIdx === -1) return { source: 'plex', localId: contentId };
  return { source: contentId.slice(0, colonIdx), localId: contentId.slice(colonIdx + 1) };
}

function SuggestionsGridSkeleton() {
  return (
    <div className="suggestions-grid">
      {Array.from({ length: 8 }, (_, i) => (
        <div key={i} className="suggestion-card suggestion-card--skeleton">
          <div className="suggestion-card__image skeleton shimmer" />
          <div className="suggestion-card__body">
            <div className="skeleton shimmer" style={{ height: 10, width: '50%', borderRadius: 3 }} />
            <div className="skeleton shimmer" style={{ height: 12, width: '80%', borderRadius: 3 }} />
            <div className="skeleton shimmer" style={{ height: 10, width: '40%', borderRadius: 3 }} />
          </div>
        </div>
      ))}
    </div>
  );
}

export default function FitnessSuggestionsWidget() {
  const rawData = useScreenData('suggestions');
  const { onPlay, onNavigate } = useFitnessScreen();

  const handlePlay = useCallback((suggestion) => {
    if (!onPlay) return;
    const { source, localId } = parseContentId(suggestion.contentId);
    onPlay({
      id: localId,
      contentSource: source,
      type: 'episode',
      title: suggestion.title,
      videoUrl: DaylightMediaPath(`api/v1/play/${source}/${localId}`),
      image: DaylightMediaPath(suggestion.thumbnail?.replace(/^\//, '') || `api/v1/display/${source}/${localId}`),
      duration: suggestion.durationMinutes,
      ...(suggestion.progress ? { resumePosition: suggestion.progress.playhead } : {}),
    });
  }, [onPlay]);

  const handleBrowse = useCallback((suggestion) => {
    if (!onNavigate) return;
    const { localId } = parseContentId(suggestion.showId);
    onNavigate('show', { id: localId, episodeId: suggestion.contentId });
  }, [onNavigate]);

  if (rawData === null) return <SuggestionsGridSkeleton />;

  const suggestions = rawData?.suggestions || [];
  if (suggestions.length === 0) return null;

  return (
    <div className="suggestions-grid">
      {suggestions.map((s, i) => (
        <SuggestionCard key={s.contentId || i} suggestion={s} onPlay={handlePlay} onBrowse={handleBrowse} />
      ))}
    </div>
  );
}
