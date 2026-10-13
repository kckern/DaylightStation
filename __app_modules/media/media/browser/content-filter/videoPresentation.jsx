import React, { useMemo } from 'react';
import { useFilterData } from './useFilterData.js';
import { useContentFilter } from './useContentFilter.js';
import { FilterOverlay } from './FilterOverlay.jsx';
import { FilterDebugHud } from './FilterDebugHud.jsx';

// Content filtering is opt-in via ?filter=1 so normal playback is unaffected.
// The debug HUD (?filter-debug=1) implies filtering is on — it exists to QA cues.
const CONTENT_FILTER_DEBUG = typeof window !== 'undefined'
  && new URLSearchParams(window.location.search).get('filter-debug') === '1';
const CONTENT_FILTER_ENABLED = (typeof window !== 'undefined'
  && new URLSearchParams(window.location.search).get('filter') === '1')
  || CONTENT_FILTER_DEBUG;

export function useMediaVideoPresentation({ media, isPlex, getMediaEl }) {
  // --- Content filter (opt-in via ?filter=1) ---
  const filterContentId = (isPlex && CONTENT_FILTER_ENABLED)
    ? (media?.assetId || media?.key || media?.plex || null)
    : null;
  const filterData = useFilterData(filterContentId, { enabled: CONTENT_FILTER_ENABLED });
  const filterTransport = useMemo(() => ({
    seek: (s) => { const el = getMediaEl(); if (el && Number.isFinite(s)) { try { el.currentTime = s; } catch (_) { /* ignore */ } } },
  }), [getMediaEl]);
  const { activeOverlays: filterOverlays, activeCard: filterCard, effectiveCues: filterCues } = useContentFilter({
    getMediaEl,
    transport: filterTransport,
    edl: filterData?.edl,
    profile: filterData?.profile,
    override: filterData?.override,
    enabled: CONTENT_FILTER_ENABLED && !!filterData?.edl,
  });

  // Art for title/skip cards, via the Plex image proxy. The proxy keys on the
  // bare ratingKey — filterContentId carries a `plex:` prefix (it's the mediaKey),
  // which 404s the proxy and would blank every card's poster/background/logo. Strip
  // it (mirrors FilterPoc). Cards degrade per-image when a title lacks an art asset.
  const filterCardArt = useMemo(() => {
    if (!filterContentId) return null;
    const rk = String(filterContentId).replace(/^plex:/, '');
    const base = `/api/v1/proxy/plex/library/metadata/${rk}`;
    return { poster: `${base}/thumb`, background: `${base}/art`, logo: `${base}/clearLogo` };
  }, [filterContentId]);

  return {
    overlay: CONTENT_FILTER_ENABLED && filterData?.edl && (
        <FilterOverlay
          activeOverlays={filterOverlays}
          activeCard={filterCard}
          theme={filterData?.profile?.theme}
          art={filterCardArt}
        />
      ),
    debug: CONTENT_FILTER_DEBUG && filterData?.edl && (
        <FilterDebugHud
          getMediaEl={getMediaEl}
          transport={filterTransport}
          effectiveCues={filterCues}
          theme={filterData?.profile?.theme}
        />
      ),
  };
}
