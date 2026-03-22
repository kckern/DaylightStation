// frontend/src/screen-framework/widgets/MenuWidget.jsx
import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useMenuNavigationContext } from '../../context/MenuNavigationContext.jsx';
import { DaylightAPI } from '../../lib/api.mjs';
import { MenuStack } from '../../modules/Menu/MenuStack.jsx';
import { MenuSkeleton } from '../../modules/Menu/MenuSkeleton.jsx';
import { usePlaybackBroadcast } from '../../hooks/media/usePlaybackBroadcast.js';
import { getChildLogger } from '../../lib/logging/singleton.js';

/**
 * MenuWidget — screen-framework widget that wraps MenuStack.
 *
 * Pure menu renderer. Autoplay is handled by ScreenAutoplay.
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

  useEffect(() => {
    const fetchData = async () => {
      const data = await DaylightAPI(`api/v1/list/watchlist/${source}/recent_on_top`);
      setList(data);
      logger.info('menu-widget.data-loaded', { source, count: data?.items?.length ?? 0 });
    };
    fetchData();
  }, [source, logger]);

  if (!list) {
    return <MenuSkeleton />;
  }

  return <MenuWidgetContent rootMenu={list} logger={logger} />;
}

/**
 * Inner component that uses the navigation context for playback broadcast.
 * Must be rendered inside MenuNavigationProvider (provided by ScreenRenderer).
 */
function MenuWidgetContent({ rootMenu, logger }) {
  const { currentContent } = useMenuNavigationContext();
  const playerRef = useRef(null);

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

  return <MenuStack rootMenu={rootMenu} playerRef={playerRef} />;
}

export default MenuWidget;
