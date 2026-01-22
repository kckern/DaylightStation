import React, { useEffect, useState, useMemo } from "react";
import "./TVApp.scss";
import { DaylightAPI } from "../lib/api.mjs";
import { MenuNavigationProvider, useMenuNavigationContext } from "../context/MenuNavigationContext";
import { MenuStack } from "../modules/Menu/MenuStack";
import Player from "../modules/Player/Player";
import AppContainer from "../modules/AppContainer/AppContainer";
import { PlayerOverlayLoading } from "../modules/Player/Player";
import { getChildLogger } from "../lib/logging/singleton.js";

export function TVAppWrapper({ children }) {
  return (
    <div className="tv-app-container">
      <div className="tv-app">
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
      if (autoplay.queue || autoplay.play) {
        push({ type: 'player', props: autoplay });
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
      const data = await DaylightAPI("api/v1/list/folder/TVApp/recent_on_top");
      setList(data);
      logger.info('tvapp-data-loaded', { count: data?.items?.length ?? 0 });
    };
    fetchData();
  }, [logger]);

  // Parse autoplay from query params
  const autoplay = useMemo(() => {
    const params = new URLSearchParams(window.location.search);
    const queryEntries = Object.fromEntries(params.entries());
    
    const configList = ["volume","shader","playbackRate","shuffle","continuous","repeat","loop","overlay"];
    const config = {};
    for (const configKey of configList) {
      if (queryEntries[configKey]) {
        config[configKey] = queryEntries[configKey];
      }
    }

    const findKey = (value) => ( /^\d+$/.test(value) ? "plex" : "media" );
    const mappings = {
      playlist:  (value) => ({ queue: { [findKey(value)]: value, ...config } }),
      queue:     (value) => ({ queue: { [findKey(value)]: value, ...config } }),
      play:      (value) => ({ play:  { [findKey(value)]: value, ...config } }),
      media:     (value) => ({ play: { media: value, ...config } }),
      plex:      (value) => ({ play: { plex: value, ...config } }),
      hymn:      (value) => ({ play: { hymn: value, ...config } }),
      song:      (value) => ({ play: { song: value, ...config } }),
      primary:   (value) => ({ play: { primary: value, ...config } }),
      talk:      (value) => ({ play: { talk: value, ...config } }),
      poem:      (value) => ({ play: { poem: value, ...config } }),
      scripture: (value) => ({ play: { scripture: value, ...config } }),
    };

    for (const [key, value] of Object.entries(queryEntries)) {
      if (mappings[key]) {
        return mappings[key](value);
      }
      // Check if it's an app open command
      if (!configList.includes(key)) {
        return { open: { app: key, param: value } };
      }
    }

    return null;
  }, []);

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
    return <TVAppWrapper><PlayerOverlayLoading shouldRender isVisible /></TVAppWrapper>;
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

