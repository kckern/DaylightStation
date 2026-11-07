import React, { useMemo, useEffect, useRef } from 'react';
import { useFilterData } from './useFilterData.js';
import { useContentFilter } from './useContentFilter.js';
import { FilterOverlay } from './FilterOverlay.jsx';
import { filterMode } from './filterMode.js';
import { getChildLogger } from "../../../../../frontend/src/lib/logging/singleton.js";
import { filterSummary, isProvisional, bumperStartWindowSec } from './filterSummary.js';
import { useBumper } from './useBumper.js';

/** Plex part id from a direct-play URL (/library/parts/<id>/...), or null (e.g. a transcode). */
export function partFromSrc(src) {
  const m = String(src || '').match(/\/library\/parts\/(\d+)\//);
  return m ? m[1] : null;
}

let _logger;
const logger = () => (_logger ||= getChildLogger({ component: 'content-filter' }));

export function useMediaVideoPresentation({ media, isPlex, getMediaEl }) {
  // --- Content filter: on by default for certified titles; ?filter=0 off, ?filter=1 forced on ---
  const search = typeof window !== 'undefined' ? window.location.search : '';
  const forcedOff = filterMode({ search, certification: null, status: 'idle' }).reason === 'forced-off';
  const filterContentId = (isPlex && !forcedOff)
    ? (media?.assetId || media?.key || media?.plex || null)
    : null;
  const { data: filterData, status: filterStatus } = useFilterData(filterContentId, { enabled: !!filterContentId });
  const mode = filterMode({ search, certification: filterData?.certification ?? null, status: filterStatus });
  const forcedOn = mode.reason === 'forced-on';
  const filterEnabled = mode.enabled;
  const loggedRef = useRef(null);
  useEffect(() => {
    if (!filterContentId || mode.reason === 'loading') return;
    const key = `${filterContentId}:${mode.enabled}`;
    if (loggedRef.current === key) return;
    loggedRef.current = key;
    logger().info(mode.enabled ? 'content-filter.default.on' : 'content-filter.default.off', { contentId: filterContentId, reason: mode.reason });
  }, [filterContentId, mode.enabled, mode.reason]);
  const filterTransport = useMemo(() => ({
    seek: (s) => { const el = getMediaEl(); if (el && Number.isFinite(s)) { try { el.currentTime = s; } catch (_) { /* ignore */ } } },
  }), [getMediaEl]);
  const { activeOverlays: filterOverlays, activeCard: filterCard, effectiveCues: filterCues, filterActive } = useContentFilter({
    getMediaEl,
    transport: filterTransport,
    edl: filterData?.edl,
    profile: filterData?.profile,
    override: filterData?.override,
    part: partFromSrc(media?.mediaUrl || media?.url || getMediaEl?.()?.currentSrc),
    enabled: filterEnabled && !!filterData?.edl,
  });

  // Viewer chrome (spec §2): the opening bumper and the filter-active badge. The
  // badge also shows (regardless of URL flags, except ?filter=0) when the filter data failed to load, crossed out, so an
  // absent filter never passes for an active one.
  const hasEdl = !!filterData?.edl;
  const filterSummaryLine = useMemo(() => filterSummary(filterCues), [filterCues]);
  const provisional = useMemo(
    () => isProvisional(filterCues, filterData?.certification ?? filterData?.edl?.certification),
    [filterCues, filterData],
  );
  const bumperWindowSec = useMemo(() => bumperStartWindowSec(filterCues), [filterCues]);
  const bumperShown = useBumper({ getMediaEl, enabled: filterEnabled && hasEdl, startWindowSec: bumperWindowSec });
  const badgeState = filterStatus === 'failed' ? 'failed' : (provisional ? 'provisional' : 'certified');
  const showChrome = !!filterContentId && ((filterEnabled && hasEdl) || filterStatus === 'failed');

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
    overlay: showChrome && (
        <FilterOverlay
          activeOverlays={filterOverlays}
          activeCard={filterCard}
          theme={filterData?.profile?.theme || undefined}
          art={filterCardArt}
          bumper={bumperShown ? { summary: filterSummaryLine } : null}
          badge={{ state: badgeState, active: filterActive }}
        />
      ),
  };
}
