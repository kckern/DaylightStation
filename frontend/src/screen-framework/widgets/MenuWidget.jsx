// frontend/src/screen-framework/widgets/MenuWidget.jsx
import React, { useState, useEffect, useMemo, useRef } from 'react';
import { DaylightAPI } from '../../lib/api.mjs';
import { MenuStack } from '../../modules/Menu/MenuStack.jsx';
import { MenuSkeleton } from '../../modules/Menu/MenuSkeleton.jsx';
import { getChildLogger } from '../../lib/logging/singleton.js';
import { usePlayerSessionBinding } from '../publishers/usePlayerSessionBinding.js';
import { useScreenOverlay } from '../overlays/ScreenOverlayProvider.jsx';

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
  const { overlayOwnsNavStack } = useScreenOverlay();

  // A menu selection mounts the legacy Player on the nav stack with this ref;
  // bind it into the playerSessionRegistry for fleet device-state publishing.
  usePlayerSessionBinding(() => playerRef.current);

  useEffect(() => {
    const fetchData = async () => {
      const data = await DaylightAPI(`api/v1/list/watchlist/${source}/recent_on_top`);
      setList(data);
      logger.info('menu-widget.data-loaded', { source, count: data?.items?.length ?? 0 });
    };
    fetchData();
  }, [source, logger]);

  // ONE SELECTION, ONE PLAYER.
  //
  // This widget's MenuStack and a MenuStack mounted as a fullscreen overlay
  // read the SAME MenuNavigationContext (provided once, screen-wide, by
  // ScreenRenderer). A push made in the overlay is therefore also seen down
  // here — and a `{ type: 'player' }` push rendered a second, unmuted Player
  // behind the overlay. Measured on the living-room screen: two <video>s, both
  // playing, both unmuted, identical currentTime. Doubled audio, doubled decode
  // and two Plex transcode sessions for one selection, on a backend that
  // serialises Plex requests.
  //
  // The stack has exactly one legitimate renderer at a time. While an overlay
  // owns it, the widget yields. This is a RENDER gate, not a state change: the
  // nav stack, its selections and its depth are untouched, and nothing in the
  // overlay's subtree re-renders because of it, so the overlay's player never
  // remounts mid-playback. When the overlay dismisses, this MenuStack remounts
  // and resets to its root — the same "exit means home" the overlay's own
  // player exit already promises (MenuStack.exitToHome).
  if (overlayOwnsNavStack) {
    return null;
  }

  if (!list) {
    return <MenuSkeleton />;
  }

  return <MenuStack rootMenu={list} playerRef={playerRef} />;
}

export default MenuWidget;
