// frontend/src/screen-framework/widgets/MenuWidget.jsx
import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useMenuNavigationContext } from '../../context/MenuNavigationContext.jsx';
import { DaylightAPI } from '../../lib/api.mjs';
import { MenuStack } from '../../modules/Menu/MenuStack.jsx';
import { MenuSkeleton } from '../../modules/Menu/MenuSkeleton.jsx';
import { PlayerOverlayLoading } from '../../modules/Player/Player.jsx';
import { parseAutoplayParams } from '../../lib/parseAutoplayParams.js';
import { usePlaybackBroadcast } from '../../hooks/media/usePlaybackBroadcast.js';
import { getChildLogger } from '../../lib/logging/singleton.js';

const TV_ACTIONS = ['play', 'queue', 'playlist', 'random', 'display', 'read', 'open', 'app', 'launch', 'list'];

/**
 * MenuWidget — screen-framework widget that wraps MenuStack.
 *
 * Provides the same functionality as TVApp.jsx:
 * - Fetches root menu data from the configured source
 * - Parses autoplay URL params on mount
 * - Sets up playback broadcast
 * - Renders MenuStack for navigation
 *
 * Does NOT create its own MenuNavigationProvider —
 * uses the one already provided by ScreenRenderer.
 *
 * Props come from the screen YAML config:
 *   widget: menu
 *   props:
 *     source: TVApp        # menu list name
 *     style: tv-menu       # (reserved for future style variants)
 *     showImages: true      # (reserved for future use)
 */
function MenuWidget({ source }) {
  const [list, setList] = useState(null);
  const logger = useMemo(() => getChildLogger({ widget: 'menu' }), []);

  const autoplay = useMemo(
    () => parseAutoplayParams(window.location.search, TV_ACTIONS),
    []
  );

  const isQueueOrPlay = useMemo(() => {
    const params = new URLSearchParams(window.location.search);
    const queryEntries = Object.fromEntries(params.entries());
    return ['queue', 'play'].some(key => Object.keys(queryEntries).includes(key));
  }, []);

  useEffect(() => {
    const fetchData = async () => {
      const data = await DaylightAPI(`api/v1/list/watchlist/${source}/recent_on_top`);
      setList(data);
      logger.info('menu-widget.data-loaded', { source, count: data?.items?.length ?? 0 });
    };
    fetchData();
  }, [source, logger]);

  // Show loading overlay if autoplay is pending and data not ready
  if (!list && isQueueOrPlay) {
    return <PlayerOverlayLoading shouldRender isVisible />;
  }

  if (!list) {
    return <MenuSkeleton />;
  }

  return (
    <MenuWidgetContent
      rootMenu={list}
      autoplay={autoplay}
      logger={logger}
    />
  );
}

/**
 * Inner component that uses the navigation context for autoplay handling.
 * Must be rendered inside MenuNavigationProvider (provided by ScreenRenderer).
 */
function MenuWidgetContent({ rootMenu, autoplay, logger }) {
  const { push, currentContent } = useMenuNavigationContext();
  const [autoplayed, setAutoplayed] = useState(false);
  const playerRef = useRef(null);

  // Derive broadcastItem from currentContent (same logic as TVAppContent)
  const broadcastItem = useMemo(() => {
    if (!currentContent) return null;
    if (currentContent.type !== 'player' && currentContent.type !== 'composite') return null;
    const contentProps = currentContent.props || {};
    const item = contentProps.play || (contentProps.queue && contentProps.queue[0]) || null;
    if (!item) return null;
    return {
      contentId: item.contentId ?? item.plex ?? item.assetId ?? null,
      title: item.title ?? item.label ?? item.name ?? null,
      format: item.format ?? item.mediaType ?? item.type ?? null,
      thumbnail: item.thumbnail ?? item.image ?? null,
    };
  }, [currentContent]);

  usePlaybackBroadcast(playerRef, broadcastItem);

  // Handle autoplay on mount (same logic as TVAppContent in TVApp.jsx)
  useEffect(() => {
    if (!autoplayed && autoplay) {
      if (autoplay.compose) {
        push({ type: 'composite', props: autoplay.compose });
      } else if (autoplay.queue || autoplay.play) {
        push({ type: 'player', props: autoplay });
      } else if (autoplay.display) {
        push({ type: 'display', props: autoplay });
      } else if (autoplay.read) {
        push({ type: 'reader', props: autoplay });
      } else if (autoplay.launch) {
        push({ type: 'launch', props: autoplay });
      } else if (autoplay.list?.contentId) {
        push({ type: 'plex-menu', props: autoplay });
      } else if (autoplay.list) {
        push({ type: 'menu', props: autoplay });
      } else if (autoplay.open) {
        push({ type: 'app', props: autoplay });
      }
      setAutoplayed(true);
      logger.info('menu-widget.autoplay', { keys: Object.keys(autoplay || {}) });
    }
  }, [autoplay, autoplayed, push, logger]);

  // Show loading if autoplay is pending
  if (autoplay && !autoplayed) {
    return <PlayerOverlayLoading shouldRender isVisible />;
  }

  return <MenuStack rootMenu={rootMenu} playerRef={playerRef} />;
}

export default MenuWidget;
