import React, { useEffect, useState, useMemo } from "react";
import "./TVApp.scss";
import { DaylightAPI } from "../lib/api.mjs";
import { MenuNavigationProvider, useMenuNavigationContext } from "../context/MenuNavigationContext";
import { MenuStack } from "../modules/Menu/MenuStack";
import { PlayerOverlayLoading } from "../modules/Player/Player";
import { MenuSkeleton } from "../modules/Menu/MenuSkeleton";
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

  // Parse autoplay from query params
  const autoplay = useMemo(() => {
    const params = new URLSearchParams(window.location.search);
    const queryEntries = Object.fromEntries(params.entries());

    // Ensure value is a compound content ID.
    // Values already in source:id format pass through unchanged.
    // Bare digits default to plex: prefix; bare paths stay as-is (media files).
    const toContentId = (value) => {
      if (/^[a-z]+:.+$/i.test(value)) return value;
      if (/^\d+$/.test(value)) return `plex:${value}`;
      return value;
    };

    // Config modifiers that can be combined with any source
    const configList = ["volume","shader","playbackRate","shuffle","continuous","repeat","loop","overlay","advance","interval","mode","frame"];
    const config = {};
    for (const configKey of configList) {
      if (queryEntries[configKey]) {
        // Parse overlay as playlist with shuffle
        if (configKey === 'overlay') {
          config.overlay = {
            queue: { contentId: toContentId(queryEntries[configKey]) },
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

    // Action mappings — source-agnostic.
    // Only action verbs are mapped; source resolution is handled by the backend.
    const mappings = {
      playlist:  (value) => ({ queue: { contentId: toContentId(value), ...config } }),
      queue:     (value) => {
        if (value.includes(',')) {
          return { compose: { sources: value.split(',').map(s => s.trim()), ...config } };
        }
        if (value.startsWith('app:')) {
          return { compose: { sources: [value], ...config } };
        }
        return { queue: { contentId: toContentId(value), ...config } };
      },
      play:      (value) => {
        if (value.includes(',')) {
          return { compose: { sources: value.split(',').map(s => s.trim()), ...config } };
        }
        if (value.startsWith('app:')) {
          return { compose: { sources: [value], ...config } };
        }
        return { play: { contentId: toContentId(value), ...config } };
      },
      random:    (value) => ({ play: { contentId: toContentId(value), random: true, ...config } }),
      display:   (value) => ({ display: { id: value, ...config } }),
      read:      (value) => ({ read: { id: value, ...config } }),
      open:      (value) => ({ open: { app: value } }),
      list:      (value) => ({ list: { contentId: toContentId(value), ...config } }),
    };

    for (const [key, value] of Object.entries(queryEntries)) {
      if (mappings[key]) {
        return mappings[key](value);
      }
      // Skip config modifiers and track modifiers (handled above)
      if (configList.includes(key) || key.match(/^\w+\.(visual|audio)$/)) {
        continue;
      }
      // Unknown key: treat as shorthand for ?play=key:value
      // e.g., ?hymn=166 → play hymn:166, ?plex=12345 → play plex:12345
      return { play: { contentId: `${key}:${value}`, ...config } };
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

