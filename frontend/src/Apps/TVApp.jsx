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
      if (autoplay.compose) {
        // Composed presentation - push to composite player
        push({ type: 'composite', props: autoplay.compose });
      } else if (autoplay.queue || autoplay.play) {
        push({ type: 'player', props: autoplay });
      } else if (autoplay.display) {
        push({ type: 'display', props: autoplay });
      } else if (autoplay.read) {
        push({ type: 'reader', props: autoplay });
      } else if (autoplay.list?.plex) {
        // Plex list → use plex-menu router
        push({ type: 'plex-menu', props: autoplay });
      } else if (autoplay.list) {
        // Non-plex list (folder, etc.)
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
      const data = await DaylightAPI("api/v1/item/folder/TVApp/recent_on_top");
      setList(data);
      logger.info('tvapp-data-loaded', { count: data?.items?.length ?? 0 });
    };
    fetchData();
  }, [logger]);

  // Parse autoplay from query params
  const autoplay = useMemo(() => {
    const params = new URLSearchParams(window.location.search);
    const queryEntries = Object.fromEntries(params.entries());

    // Config modifiers that can be combined with any source
    const configList = ["volume","shader","playbackRate","shuffle","continuous","repeat","loop","overlay","advance","interval"];
    const config = {};
    for (const configKey of configList) {
      if (queryEntries[configKey]) {
        // Parse overlay as Plex playlist with shuffle
        if (configKey === 'overlay' && /^\d+$/.test(queryEntries[configKey])) {
          config.overlay = {
            queue: { plex: queryEntries[configKey] },
            shuffle: true
          };
        } else {
          config[configKey] = queryEntries[configKey];
        }
      }
    }

    // Parse advance config for composed presentations
    if (queryEntries.advance) {
      config.advance = {
        mode: queryEntries.advance,
        interval: parseInt(queryEntries.interval) || 5000
      };
    }

    // Parse per-track modifiers (e.g., loop.audio=0, shuffle.visual=1)
    const trackModifiers = { visual: {}, audio: {} };
    for (const [key, value] of Object.entries(queryEntries)) {
      const match = key.match(/^(\w+)\.(visual|audio)$/);
      if (match) {
        const [, modifier, track] = match;
        trackModifiers[track][modifier] = value;
      }
    }
    if (Object.keys(trackModifiers.visual).length || Object.keys(trackModifiers.audio).length) {
      config.trackModifiers = trackModifiers;
    }

    // Auto-detect source: digits → plex, otherwise → media
    const findKey = (value) => ( /^\d+$/.test(value) ? "plex" : "media" );

    // Source mappings - first match wins
    const mappings = {
      // Queue actions - comma-separated or app: prefix = composed presentation
      playlist:  (value) => ({ queue: { [findKey(value)]: value, ...config } }),
      queue:     (value) => {
        if (value.includes(',')) {
          // Comma-separated sources = composed presentation (backend infers tracks)
          const sources = value.split(',').map(s => s.trim());
          return { compose: { sources, ...config } };
        }
        if (value.startsWith('app:')) {
          // App sources always use composite player (clock, blackout, screensaver)
          return { compose: { sources: [value], ...config } };
        }
        return { queue: { [findKey(value)]: value, ...config } };
      },

      // Play actions - comma-separated or app: prefix = composed presentation
      play:      (value) => {
        if (value.includes(',')) {
          // Comma-separated sources = composed presentation (backend infers tracks)
          const sources = value.split(',').map(s => s.trim());
          return { compose: { sources, ...config } };
        }
        if (value.startsWith('app:')) {
          // App sources always use composite player (clock, blackout, screensaver)
          return { compose: { sources: [value], ...config } };
        }
        return { play: { [findKey(value)]: value, ...config } };
      },
      random:    (value) => ({ play:  { [findKey(value)]: value, random: true, ...config } }),

      // Display actions (static images)
      display:   (value) => ({ display: { id: value, ...config } }),

      // Read actions (ebooks, articles)
      read:      (value) => ({ read: { id: value, ...config } }),

      // Source-specific play
      plex:      (value) => ({ play: { plex: value, ...config } }),
      media:     (value) => ({ play: { media: value, ...config } }),
      folder:    (value) => ({ play: { folder: value, ...config } }),
      hymn:      (value) => ({ play: { hymn: value, ...config } }),
      song:      (value) => ({ play: { song: value, ...config } }),
      primary:   (value) => ({ play: { primary: value, ...config } }),
      talk:      (value) => ({ play: { talk: value, ...config } }),
      poem:      (value) => ({ play: { poem: value, ...config } }),
      scripture: (value) => ({ play: { scripture: value, ...config } }),

      // List action (browse as menu)
      list:      (value) => ({ list: { [findKey(value)]: value } }),
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

