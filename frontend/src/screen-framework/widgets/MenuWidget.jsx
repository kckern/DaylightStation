// frontend/src/screen-framework/widgets/MenuWidget.jsx
import React, { useState, useEffect, useMemo, useRef } from 'react';
import { DaylightAPI } from '../../lib/api.mjs';
import { MenuStack } from '../../modules/Menu/MenuStack.jsx';
import { MenuSkeleton } from '../../modules/Menu/MenuSkeleton.jsx';
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
  const playerRef = useRef(null);

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

  return <MenuStack rootMenu={list} playerRef={playerRef} />;
}

export default MenuWidget;
