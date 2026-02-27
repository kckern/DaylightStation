import React, { useEffect, useState, useMemo, useRef } from "react";
import "./TVApp.scss";
import { DaylightAPI } from "../lib/api.mjs";
import { MenuNavigationProvider, useMenuNavigationContext } from "../context/MenuNavigationContext";
import { MenuStack } from "../modules/Menu/MenuStack";
import { PlayerOverlayLoading } from "../modules/Player/Player";
import { MenuSkeleton } from "../modules/Menu/MenuSkeleton";
import { getChildLogger } from "../lib/logging/singleton.js";
import { useViewportProbe } from "../hooks/useViewportProbe.js";
import { parseAutoplayParams } from "../lib/parseAutoplayParams.js";

const TV_ACTIONS = ['play', 'queue', 'playlist', 'random', 'display', 'read', 'open', 'app', 'launch', 'list'];

export function TVAppWrapper({ children }) {
  const tvAppRef = useRef(null);
  useViewportProbe(tvAppRef);

  return (
    <div className="tv-app-container">
      <div className="tv-app" ref={tvAppRef}>
        <div className="tv-app__content">
          {children}
        </div>
      </div>
    </div>
  );
}

/**
 * Inner component that uses the navigation context for autoplay handling
 */
function TVAppContent({ rootMenu, autoplay, appParam, logger }) {
  const { push, pop, currentContent, reset } = useMenuNavigationContext();
  const [autoplayed, setAutoplayed] = useState(false);

  // Handle autoplay on mount
  useEffect(() => {
    if (!autoplayed && autoplay) {
      if (autoplay.compose) {
        // Composed presentation - push to composite player
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
        // Content list with compound ID — backend resolves source/type
        push({ type: 'plex-menu', props: autoplay });
      } else if (autoplay.list) {
        // Folder-based list
        push({ type: 'menu', props: autoplay });
      } else if (autoplay.open) {
        push({ type: 'app', props: autoplay });
      }
      setAutoplayed(true);
      logger.info('tvapp-autoplay', { keys: Object.keys(autoplay || {}) });
    }
  }, [autoplay, autoplayed, push, logger]);

  // Handle appParam on mount
  useEffect(() => {
    if (appParam) {
      push({ type: 'app', props: { open: { app: appParam } } });
      logger.info('tvapp-app-param', { app: appParam });
    }
  }, [appParam, push, logger]);

  // Show loading if autoplay is pending
  if (autoplay && !autoplayed) {
    return <PlayerOverlayLoading shouldRender isVisible />;
  }

  // Show loading if appParam but content not yet pushed
  if (appParam && !currentContent) {
    return <PlayerOverlayLoading shouldRender isVisible />;
  }

  return <MenuStack rootMenu={rootMenu} />;
}

export default function TVApp({ appParam }) {
  const [list, setList] = useState(null);
  const logger = useMemo(() => getChildLogger({ app: 'tv' }), []);

  useEffect(() => {
    const fetchData = async () => {
      const data = await DaylightAPI("api/v1/list/watchlist/TVApp/recent_on_top");
      setList(data);
      logger.info('tvapp-data-loaded', { count: data?.items?.length ?? 0 });
    };
    fetchData();
  }, [logger]);

  // Parse autoplay from query params (shared utility — see parseAutoplayParams.js)
  const autoplay = useMemo(() => parseAutoplayParams(window.location.search, TV_ACTIONS), []);

  const isQueueOrPlay = useMemo(() => {
    const params = new URLSearchParams(window.location.search);
    const queryEntries = Object.fromEntries(params.entries());
    return ["queue", "play"].some(key => Object.keys(queryEntries).includes(key));
  }, []);

  // Show loading while fetching root menu
  if (!list && (isQueueOrPlay || appParam)) {
    return <TVAppWrapper><PlayerOverlayLoading shouldRender isVisible /></TVAppWrapper>;
  }

  if (!list) {
    return <TVAppWrapper><MenuSkeleton /></TVAppWrapper>;
  }

  return (
    <MenuNavigationProvider>
      <TVAppWrapper>
        <TVAppContent 
          rootMenu={list} 
          autoplay={autoplay} 
          appParam={appParam}
          logger={logger}
        />
      </TVAppWrapper>
    </MenuNavigationProvider>
  );
}

