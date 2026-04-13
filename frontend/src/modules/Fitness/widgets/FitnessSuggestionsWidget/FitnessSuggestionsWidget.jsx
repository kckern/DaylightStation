import React, { useCallback, useState, useEffect, useRef } from 'react';
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
  const { onPlay, onNavigate, lastPlayedContentId, setLastPlayedContentId } = useFitnessScreen();

  // Local mutable state for visible cards and overflow
  const [visibleCards, setVisibleCards] = useState([]);
  const [overflow, setOverflow] = useState([]);
  const [spentContentId, setSpentContentId] = useState(null);
  const [fadingOut, setFadingOut] = useState(null);
  const [fadingIn, setFadingIn] = useState(null);
  const swapTimerRef = useRef(null);

  // Sync from server data when it arrives or refreshes
  useEffect(() => {
    if (!rawData) return;
    setVisibleCards(rawData.suggestions || []);
    setOverflow(rawData.overflow || []);
    // Clear any in-progress swap state on full refresh
    setSpentContentId(null);
    setFadingOut(null);
    setFadingIn(null);
  }, [rawData]);

  // Detect when we return from playing (lastPlayedContentId was set, player closed)
  useEffect(() => {
    if (!lastPlayedContentId) return;
    const isVisible = visibleCards.some(c => c.contentId === lastPlayedContentId);
    if (!isVisible) {
      setLastPlayedContentId(null);
      return;
    }

    // Capture the contentId in a local variable for use in closures
    const playedId = lastPlayedContentId;

    // Mark the card as spent (renders at 50% opacity immediately)
    setSpentContentId(playedId);
    setLastPlayedContentId(null);

    // After 1s beat, start fade-out
    swapTimerRef.current = setTimeout(() => {
      setFadingOut(playedId);

      // After 500ms fade-out, swap the card
      swapTimerRef.current = setTimeout(() => {
        setVisibleCards(prev => {
          const idx = prev.findIndex(c => c.contentId === playedId);
          if (idx === -1) return prev;

          // Pick replacement from overflow
          const visibleShowIds = new Set(prev.map(c => c.showId));
          const replacement = overflow.find(c => !visibleShowIds.has(c.showId));

          if (replacement) {
            setOverflow(ov => ov.filter(c => c.contentId !== replacement.contentId));
            setFadingIn(replacement.contentId);
            const next = [...prev];
            next[idx] = replacement;
            return next;
          }
          // No replacement — remove the card
          return prev.filter((_, i) => i !== idx);
        });

        setSpentContentId(null);
        setFadingOut(null);

        // After 500ms fade-in, clear fading-in state
        swapTimerRef.current = setTimeout(() => {
          setFadingIn(null);
        }, 500);
      }, 500);
    }, 1000);

    return () => clearTimeout(swapTimerRef.current);
  }, [lastPlayedContentId]);

  const handlePlay = useCallback((suggestion) => {
    if (!onPlay) return;
    // Track which card was played for swap-on-return
    setLastPlayedContentId?.(suggestion.contentId);

    const { source, localId } = parseContentId(suggestion.contentId);
    onPlay({
      id: localId,
      contentSource: source,
      type: 'episode',
      title: suggestion.title,
      videoUrl: DaylightMediaPath(`api/v1/play/${source}/${localId}`),
      image: DaylightMediaPath(suggestion.thumbnail?.replace(/^\//, '') || `api/v1/display/${source}/${localId}`),
      duration: suggestion.durationMinutes,
      labels: suggestion.labels || [],
      ...(suggestion.progress ? { resumePosition: suggestion.progress.playhead } : {}),
    });
  }, [onPlay, setLastPlayedContentId]);

  const handleBrowse = useCallback((suggestion) => {
    if (!onNavigate) return;
    const { localId } = parseContentId(suggestion.showId);
    onNavigate('show', { id: localId, episodeId: suggestion.contentId });
  }, [onNavigate]);

  if (rawData === null) return <SuggestionsGridSkeleton />;
  if (visibleCards.length === 0) return null;

  return (
    <div className="suggestions-grid">
      {visibleCards.map((s, i) => {
        let cardClass = '';
        if (s.contentId === spentContentId && s.contentId !== fadingOut) {
          cardClass = 'suggestion-card--spent';
        } else if (s.contentId === fadingOut) {
          cardClass = 'suggestion-card--fading-out';
        } else if (s.contentId === fadingIn) {
          cardClass = 'suggestion-card--fading-in';
        }

        return (
          <SuggestionCard
            key={s.contentId || i}
            suggestion={s}
            onPlay={handlePlay}
            onBrowse={handleBrowse}
            transitionClass={cardClass}
          />
        );
      })}
    </div>
  );
}
