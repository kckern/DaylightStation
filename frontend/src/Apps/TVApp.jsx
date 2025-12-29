import React, { useEffect, useState, useCallback, useMemo } from "react";
import "./TVApp.scss";
import { DaylightAPI } from "../lib/api.mjs";
import { TVMenu } from "../modules/Menu/Menu";
import Player from "../modules/Player/Player";
import AppContainer from "../modules/AppContainer/AppContainer";
import { PlayerOverlayLoading } from "../modules/Player/Player";
import { getChildLogger } from "../lib/logging/singleton.js";

export function TVAppWrapper({ content }) {
  return (
    <div className="tv-app-container">
      <div className="tv-app">
        <div className="tv-app__content">
          {content}
        </div>
      </div>
    </div>
  );
}

let backFunction = () => {
  const event = new KeyboardEvent("keydown", { key: "Escape" });
  window.dispatchEvent(event);
};

function setupNavigationHandlers() {
  const handlePopState = (event) => {
    event.preventDefault();
    if (backFunction) {
      backFunction();
      window.history.pushState(null, "", window.location.href);
      return false;
    }
    return false;
  };

  const handleBeforeUnload = (event) => {
    event.preventDefault();
    event.returnValue = "";
    if (backFunction) {
      backFunction();
      window.history.pushState(null, "", window.location.href);
      return false;
    }
    return false;
  };

  window.history.pushState(null, "", window.location.href);
  window.addEventListener("popstate", handlePopState);
  window.addEventListener("beforeunload", handleBeforeUnload);

  return () => {
    window.removeEventListener("popstate", handlePopState);
    window.removeEventListener("beforeunload", handleBeforeUnload);
  };
}

export default function TVApp({ appParam }) {
  const [list, setList] = useState([]);
  const [autoplayed, setAutoplayed] = useState(false);
  const logger = useMemo(() => getChildLogger({ app: 'tv' }), []);

  // Stack to track current menu/content components
  // (Each element is a React element representing a menu level)
  const [contentStack, setContentStack] = useState([]);
  
  // State to persist menu selection across navigation
  // Array per depth: { index, key }
  const [menuSelections, setMenuSelections] = useState([{ index: 0, key: null }]);
  // Tokens to force menu data refresh per depth
  const [menuRefreshTokens, setMenuRefreshTokens] = useState([0]);

  // Derived current content from the stack
  const currentContent = contentStack[contentStack.length - 1] || null;

  useEffect(setupNavigationHandlers, []);

  useEffect(() => {
    const fetchData = async () => {
      const data = await DaylightAPI("data/list/TVApp/recent_on_top");
      setList(data);
      logger.info('tvapp-data-loaded', { count: Array.isArray(data) ? data.length : null });
    };
    fetchData();
  }, [logger]);

  const params = new URLSearchParams(window.location.search);
  const queryEntries = Object.fromEntries(params.entries());
  const isQueueOrPlay = ["queue", "play"].some(key => Object.keys(queryEntries).includes(key));

  const autoplay = (() => {
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
      return { open: { app: key, param: value } };
    }

    return null;
  })();

  function mapSelectionToContent(selection) {
    const safeSelection = { ...(selection || {}) };
    delete safeSelection.ref;
    delete safeSelection.key;
    const clear = () => setCurrentContent(null);

    // Calculate depth for nested menus (root depth = 0, first submenu = 1, etc.)
    const depth = contentStack.length + 1;
    
    // Create a callback to update the index at this specific depth
    const updateSelectionAtDepth = (newIndex, key) => {
      setMenuSelections((oldSelections) => {
        const next = [...oldSelections];
        next[depth] = { index: newIndex, key: key ?? null };
        return next;
      });
    };
    
    const props = {
      ...safeSelection,
      clear,
      onSelect: handleSelection,
      onEscape: handleEscape,
      // Pass depth-specific props for menus
      menuDepth: depth,
      selectedIndex: menuSelections[depth]?.index ?? 0,
      selectedKey: menuSelections[depth]?.key ?? null,
      onSelectedIndexChange: updateSelectionAtDepth,
      refreshToken: menuRefreshTokens[depth] ?? 0,
    };
    logger.debug('tvapp-selection', { selectionKeys: Object.keys(selection || {}), props: Object.keys(props || {}), depth });
    const options = {
      play:      <Player {...props} />,
      queue:     <Player {...props} />,
      playlist:  <Player {...props} />,
      list:      <TVMenu {...props} />,
      menu:      <TVMenu {...props} />,
      open:      <AppContainer {...props} />
    };

    const selectionKeys = Object.keys(selection);
    const match = selectionKeys.find(k => Object.keys(options).includes(k));
    return match ? options[match] : <pre>
      No valid action found for selection: {JSON.stringify(selection, null, 2)}
    </pre>
  }

  // Override setCurrentContent to push or pop from contentStack
  const setCurrentContent = useCallback((newContent) => {
    if (!newContent) {
      setContentStack((oldStack) => {
        if (oldStack.length > 0) {
          const newStack = oldStack.slice(0, -1);
          // Pop indices/refresh tokens and bump the token for the newly exposed menu
          setMenuSelections((oldSelections) => oldSelections.slice(0, -1));
          setMenuRefreshTokens((oldTokens) => {
            const trimmed = oldTokens.slice(0, -1);
            const target = Math.max(0, trimmed.length - 1);
            trimmed[target] = (trimmed[target] || 0) + 1;
            return trimmed;
          });
          return newStack;
        }
        return [];
      });
    } else {
      setContentStack((oldStack) => {
        // When pushing new content, ensure arrays have enough entries
        const newDepth = oldStack.length + 1;
        setMenuSelections((oldSelections) => {
          if (newDepth >= oldSelections.length) {
            return [...oldSelections, { index: 0, key: null }];
          }
          return oldSelections;
        });
        setMenuRefreshTokens((oldTokens) => {
          if (newDepth >= oldTokens.length) {
            return [...oldTokens, 0];
          }
          return oldTokens;
        });
        return [...oldStack, newContent];
      });
    }
  }, []);

  function handleSelection(selection) {
    const newContent = mapSelectionToContent(selection);
    if (newContent) {
      setCurrentContent(newContent);
    } else {
      logger.warn('tvapp-selection-miss', { selection });
      alert(
        "No valid action found for selection: " + JSON.stringify(Object.keys(selection))
      );
    }
  }

  function handleEscape() {
    setCurrentContent(null);
  }

  // Update backFunction to use the same logic as handleEscape
  backFunction = handleEscape;

  function handleAutoplay(entry) {
    const clear = () => setCurrentContent(null);
    if (entry.queue) {
      return <Player queue={entry.queue} clear={clear} />;
    }
    if (entry.play) {
      return <Player play={entry.play} clear={clear} />;
    }
    if (entry.open) {
      return <AppContainer open={entry.open} clear={clear} />;
    }
    return null;
  }

  useEffect(() => {
    if (!autoplayed && autoplay) {
      const newContent = handleAutoplay(autoplay);
      if (newContent) setCurrentContent(newContent);
      setAutoplayed(true);
      logger.info('tvapp-autoplay', { keys: Object.keys(autoplay || {}) });
    }
  }, [autoplay, autoplayed, setCurrentContent, logger]);

  // Keep TVMenu instances in the stack synced with the latest selected indices
  useEffect(() => {
    setContentStack((prev) => {
      const updated = prev.map((element, idx) => {
        if (!element?.type || element.type !== TVMenu) return element;
        const depth = idx + 1; // stack index 0 corresponds to depth 1 (first submenu)
        const selectedIndex = menuSelections[depth]?.index ?? 0;
        const selectedKey = menuSelections[depth]?.key ?? null;
        const refreshToken = menuRefreshTokens[depth] ?? 0;
        const onSelectedIndexChange = (newIndex, key) => {
          setMenuSelections((old) => {
            const next = [...old];
            next[depth] = { index: newIndex, key: key ?? null };
            return next;
          });
        };
        const props = element.props || {};
        const shouldUpdate =
          props.selectedIndex !== selectedIndex ||
          props.selectedKey !== selectedKey ||
          props.refreshToken !== refreshToken;

        if (!shouldUpdate) {
          return element; // preserve reference to avoid unnecessary renders/loops
        }

        return React.cloneElement(element, {
          menuDepth: depth,
          selectedIndex,
          selectedKey,
          onSelectedIndexChange,
          refreshToken,
        });
      });

      const hasChanges = updated.some((el, i) => el !== prev[i]);
      return hasChanges ? updated : prev;
    });
  }, [menuSelections, menuRefreshTokens]);

  useEffect(() => {
    if (appParam) {
      setContentStack([<AppContainer open={{ app: appParam }} clear={() => setContentStack([])} />]);
      logger.info('tvapp-app-param', { app: appParam });
    }
  }, [appParam, logger]);

  if (list.length === 0 && (isQueueOrPlay && !autoplayed)) {
    return <TVAppWrapper content={<PlayerOverlayLoading shouldRender isVisible />} />;
  }

  // If autoplay is pending, show loading instead of menu
  if (autoplay && !autoplayed) {
    return <TVAppWrapper content={<PlayerOverlayLoading shouldRender isVisible />} />;
  }

  // If appParam is set but content hasn't loaded yet, show loading instead of menu
  if (appParam && contentStack.length === 0) {
    return <TVAppWrapper content={<PlayerOverlayLoading shouldRender isVisible />} />;
  }

  if (currentContent) {
    return <TVAppWrapper content={currentContent} />;
  }

  return (
    <TVAppWrapper
      content={
        <TVMenu
          list={list}
          menuDepth={0}
          selectedIndex={menuSelections[0]?.index ?? 0}
          selectedKey={menuSelections[0]?.key ?? null}
          refreshToken={menuRefreshTokens[0] ?? 0}
          onSelectedIndexChange={(newIndex, key) => {
            setMenuSelections((oldSelections) => {
              const next = [...oldSelections];
              next[0] = { index: newIndex, key: key ?? null };
              return next;
            });
          }}
          onSelect={handleSelection}
          onEscape={handleEscape}
        />
      }
    />
  );
}

