import React, { useMemo, useEffect, useRef, useCallback } from 'react';
import { useFilterData } from './useFilterData.js';
import { useContentFilter, baseId } from './useContentFilter.js';
import { FilterOverlay } from './FilterOverlay.jsx';
import { filterMode } from './filterMode.js';
import { getChildLogger } from "../../../../../frontend/src/lib/logging/singleton.js";
import { filterSummary, isProvisional, bumperStartWindowSec } from './filterSummary.js';
import { useBumper } from './useBumper.js';
import { previewStore } from './preview/previewStore.js';
import { useSurroundOverride } from "../../../../../__capabilities/playback/browser/surround-override.mjs";

/** What the shield opens: the filter rail on the right, the filter timeline below. */
export const FILTER_SURROUND = Object.freeze({
  id: 'content-filter',
  definition: {
    // Its own look (preview/contentFilterTheme.scss), not the concert-hall programme.
    theme: 'content-filter',
    regions: {
      right: { module: 'content-filter-rail', width: '28%' },
      bottom: { module: 'content-filter-timeline' },
    },
  },
});

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
  const { data: filterData, status: filterStatus, reload: reloadFilterData } = useFilterData(filterContentId, { enabled: !!filterContentId });
  const mode = filterMode({ search, certification: filterData?.certification ?? null, status: filterStatus });
  const filterEnabled = mode.enabled;
  // Unfiltered peek: ids the preview asked to play once unfiltered. useContentFilter
  // reads it each tick and removes an id once playback passes that item's out.
  const bypassRef = useRef(new Set());
  // A peek belongs to the title it was asked on: a new title starts with none.
  useEffect(() => { bypassRef.current.clear(); }, [filterContentId]);
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
  const { activeOverlays: filterOverlays, activeCard: filterCard, effectiveCues: filterCues, filterActive, lastFired } = useContentFilter({
    getMediaEl,
    transport: filterTransport,
    edl: filterData?.edl,
    profile: filterData?.profile,
    override: filterData?.override,
    part: partFromSrc(media?.mediaUrl || media?.url || getMediaEl?.()?.currentSrc),
    enabled: filterEnabled && !!filterData?.edl,
    bypass: bypassRef.current,
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

  // --- Preview surround: publish live state; bind the transport and actions ---
  const ratingKey = filterContentId ? String(filterContentId).replace(/^plex:/, '') : null;
  const certification = filterData?.certification ?? filterData?.edl?.certification ?? null;
  const surround = useSurroundOverride();
  const surroundOpen = surround.open;
  const surroundClose = surround.close;
  const cuesRef = useRef(filterCues);
  cuesRef.current = filterCues;
  const ratingKeyRef = useRef(ratingKey);
  ratingKeyRef.current = ratingKey;
  const closeRef = useRef(surroundClose);
  closeRef.current = surroundClose;

  useEffect(() => {
    previewStore.publish({
      ratingKey,
      title: media?.title ?? null,
      cues: filterCues,
      scenes: filterData?.edl?.scenes || [],
      certification,
      summary: filterSummaryLine,
      override: filterData?.override ?? null,
      profile: filterData?.profile ?? null,
      lastFired,
      filterActive,
    });
  }, [ratingKey, media?.title, filterCues, filterData, certification, filterSummaryLine, lastFired, filterActive]);

  const closeSurround = useCallback(() => {
    if (!previewStore.getSnapshot().open) return;
    closeRef.current?.();
    previewStore.publish({ open: false });
    logger().info('content-filter.surround.closed', { ratingKey: ratingKeyRef.current });
  }, []);

  const openSurround = useCallback(() => {
    if (previewStore.getSnapshot().open) { closeSurround(); return; }
    if (surroundOpen(FILTER_SURROUND) === false) {
      logger().info('content-filter.surround.open-refused', { ratingKey: ratingKeyRef.current });
      return;
    }
    previewStore.publish({ open: true });
    logger().info('content-filter.surround.opened', { ratingKey: ratingKeyRef.current });
  }, [surroundOpen, closeSurround]);

  const unbindRef = useRef(null);
  useEffect(() => {
    const seek = (s) => {
      logger().debug('content-filter.seek', { to: +s.toFixed(2) });
      filterTransport.seek(s);
    };
    const play = () => {
      const el = getMediaEl?.();
      const refused = (e) => logger().debug('content-filter.seek.play-refused', { error: e?.message });
      try { el?.play?.()?.catch?.(refused); } catch (e) { refused(e); }
    };
    const unbind = previewStore.bind({
      seek,
      play,
      peek: (id) => {
        const items = cuesRef.current.filter((c) => c.id === id || c.scene === id || baseId(c.id) === id);
        if (!items.length) { logger().warn('content-filter.peek.unknown', { id }); return; }
        bypassRef.current.add(id);
        const start = Math.min(...items.map((c) => c.in));
        logger().info('content-filter.peek', { id, in: +start.toFixed(2) });
        previewStore.jumpToCue({ in: start });
      },
      refresh: () => reloadFilterData(),
      close: closeSurround,
    });
    unbindRef.current = unbind;
    return unbind;
  }, [filterTransport, getMediaEl, reloadFilterData, closeSurround]);

  // The host closed the surround on its own (e.g. it was replaced): follow it.
  const hostOpenRef = useRef(surround.isOpen);
  useEffect(() => {
    const was = hostOpenRef.current;
    hostOpenRef.current = surround.isOpen;
    if (was && !surround.isOpen && previewStore.getSnapshot().open) {
      previewStore.publish({ open: false });
      logger().info('content-filter.surround.closed', { ratingKey: ratingKeyRef.current, by: 'host' });
    }
  }, [surround.isOpen]);

  // Player gone: close an open surround and empty the store.
  useEffect(() => () => {
    if (previewStore.getSnapshot().open) closeRef.current?.();
    unbindRef.current?.reset?.(); // only if this player still owns the store
  }, []);

  return {
    overlay: showChrome && (
        <FilterOverlay
          activeOverlays={filterOverlays}
          activeCard={filterCard}
          theme={filterData?.profile?.theme || undefined}
          art={filterCardArt}
          bumper={bumperShown ? { summary: filterSummaryLine } : null}
          badge={{ state: badgeState, active: filterActive, onOpen: surround.available === false || badgeState === 'failed' ? undefined : openSurround }}
        />
      ),
  };
}
