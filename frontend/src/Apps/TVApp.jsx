import React, { useEffect, useState, useCallback } from "react";
import "./TVApp.scss";
import { DaylightAPI } from "../lib/api.mjs";
import { TVMenu } from "../modules/Menu/Menu";
import Player from "../modules/Player/Player";
import AppContainer from "../modules/AppContainer/AppContainer";
import { LoadingOverlay } from "../modules/Player/Player";

export function TVAppWrapper({ content }) {
  return (
    <div className="tv-app-container">
      <div className="tv-app">
        {content}
      </div>
    </div>
  );
}

const backFunction = () => {
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

export default function TVApp() {
  const [list, setList] = useState([]);
  const [autoplayed, setAutoplayed] = useState(false);

  // Stack to track current menu/content components
  // (Each element is a React element representing a menu level)
  const [contentStack, setContentStack] = useState([]);

  // Derived current content from the stack
  const currentContent = contentStack[contentStack.length - 1] || null;

  useEffect(setupNavigationHandlers, []);

  useEffect(() => {
    const fetchData = async () => {
      const data = await DaylightAPI("data/list/TVApp/recent_on_top");
      setList(data);
    };
    fetchData();
  }, []);

  const params = new URLSearchParams(window.location.search);
  const queryEntries = Object.fromEntries(params.entries());
  const isQueueOrPlay = ["queue", "play"].some(key => Object.keys(queryEntries).includes(key));

  const autoplay = (() => {
    const configList = ["volume","shader","playbackRate","shuffle","continuous"];
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
    const clear = () => setCurrentContent(null);
    const props = { ...selection, clear, onSelect: handleSelection, onEscape: handleEscape };
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
          return oldStack.slice(0, -1);
        }
        return [];
      });
    } else {
      setContentStack((oldStack) => [...oldStack, newContent]);
    }
  }, []);

  function handleSelection(selection) {
    const newContent = mapSelectionToContent(selection);
    if (newContent) {
      setCurrentContent(newContent);
    } else {
      alert(
        "No valid action found for selection: " + JSON.stringify(Object.keys(selection))
      );
    }
  }

  function handleEscape() {
    setCurrentContent(null);
  }

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
    }
  }, [autoplay, autoplayed, setCurrentContent]);

  if (list.length === 0 && (isQueueOrPlay && !autoplayed)) {
    return <TVAppWrapper content={<LoadingOverlay />} />;
  }

  if (currentContent) {
    return <TVAppWrapper content={currentContent} />;
  }

  return (
    <TVAppWrapper
      content={
        <TVMenu
          list={list}
          onSelect={handleSelection}
          onEscape={handleEscape}
        />
      }
    />
  );
}

