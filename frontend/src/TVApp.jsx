import React, { useEffect, useState } from "react";
import "./TVApp.scss";
import { DaylightAPI } from "./lib/api.mjs";
import {TVMenu} from "./modules/Menu";
import Player from "./modules/Player";
import AppContainer from "./modules/AppContainer";
import { LoadingOverlay } from "./modules/Player";

export function TVAppWrapper({ content }) {
  return (
    <div className="tv-app-container">
      <div className="tv-app">
        {content}
      </div>
    </div>
  );
}

// This function creates an "Escape" key event
const backFunction = () => {
  const event = new KeyboardEvent("keydown", { key: "Escape" });
  window.dispatchEvent(event);
};

function setupNavigationHandlers() {
  const handlePopState = event => {
    event.preventDefault();
    if (backFunction) {
      backFunction();
      window.history.pushState(null, "", window.location.href);
      return false;
    }
    return false;
  };

  const handleBeforeUnload = event => {
    event.preventDefault();
    event.returnValue = "";
    if (backFunction) {
      backFunction();
      window.history.pushState(null, "", window.location.href);
      return false;
    }
    return false;
  };

  // Prevent browser back navigation
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
  const [currentContent, setCurrentContent] = useState(null);
  const [autoplayed, setAutoplayed] = useState(false);
  const [autoShader, setAutoShader] = useState(false);

  useEffect(setupNavigationHandlers, []);

  useEffect(() => {
    const fetchData = async () => {
      const data = await DaylightAPI("data/list/TVApp");
      setList(data);
    };
    fetchData();
  }, []);

  // Parse query params for autoplay
  const params = new URLSearchParams(window.location.search);
  const queryEntries = Object.fromEntries(params.entries());

  const autoplay = (() => {

    const configList = ["volume","shader","playbackRate","shuffle","continuous"];
    const config = {};
    for (const configKey of configList) {
      if (queryEntries[configKey]) {
        config[configKey] = queryEntries[configKey];
      }
    }

    const findKey = (value) => ( /^\d+$/.test(value) ? "plex" : "playlist" );
    const mappings = {
      playlist:  (value) => ({ queue: { [findKey(value)]: value, ...config } }),
      queue:     (value) => ({ queue: { [findKey(value)]: value, ...config } }),
      play:      (value) => ({ play:  { [findKey(value)]: value, ...config } }),
      media:     (value) => ({ play: { media: value, ...config } }),
      plex:      (value) => ({ play: { plex: value, ...config } }),
      hymn:      (value) => ({ play: { hymn: value, ...config } }),
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

  // Handles a selection from the TVMenu
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

  // Maps user selection to a component (Player, new TVMenu, AppContainer, etc.)
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
    return match ? options[match] : null;
  }

  // In all cases, pressing escape should revert to the top-level menu
  function handleEscape() {
    setCurrentContent(null);
  }

  // Autoplay logic
  useEffect(() => {
    if (!autoplayed && autoplay) {
      const newContent = handleAutoplay(autoplay);
      if (newContent) setCurrentContent(newContent);
      setAutoplayed(true);
    }
  }, [autoplay, autoplayed]);

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

  // If there's content, show it
  if (currentContent) {
    return <TVAppWrapper content={currentContent} />;
  }

  // Otherwise, if list is still loading, show loading
  if (list.length === 0) {
    return <TVAppWrapper content={<LoadingOverlay />} />;
  }

  // Default: Show the main TVMenu
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