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

export default function TVApp({ subPath }) {
  const [list, setList] = useState([]);
  const [autoplayed, setAutoplayed] = useState(false);
  const [isEscaping, setIsEscaping] = useState(false);

  // Stack to track current menu/content components with metadata
  // Each element contains: { content: ReactElement, slug?: string, type: 'menu'|'player'|'app' }
  const [contentStack, setContentStack] = useState([]);

  // Derived current content from the stack
  const currentContent = contentStack[contentStack.length - 1]?.content || null;

  useEffect(setupNavigationHandlers, []);

  // Parse subPath for routing
  const parseSubPath = useCallback((subPath) => {
    if (!subPath) return null;
    
    const parts = subPath.split('/').filter(Boolean);
    if (parts.length === 0) return null;
    
    const [firstPart, ...remainingParts] = parts;
    
    // Handle predefined routes first (they have precedence)
    switch (firstPart) {
      case 'app':
        // /tv/app/someapp -> open app
        if (remainingParts.length > 0) {
          return { type: 'app', app: remainingParts[0], params: remainingParts.slice(1) };
        }
        break;
      case 'play':
        // /tv/play/media/123 -> play media
        if (remainingParts.length >= 2) {
          const [mediaType, mediaId] = remainingParts;
          return { type: 'play', mediaType, mediaId };
        }
        break;
      case 'queue':
        // /tv/queue/plex/456 -> queue media
        if (remainingParts.length >= 2) {
          const [mediaType, mediaId] = remainingParts;
          return { type: 'queue', mediaType, mediaId };
        }
        break;
      default:
        // Check if it's a menu path that needs to be reconstructed
        return { type: 'menu', menuPath: parts };
    }
    
    return null;
  }, []);

  // Helper function to create URL-safe slugs
  const slugify = useCallback((text) => {
    const baseSlug = text
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
    
    // Avoid collisions with predefined routes
    const reservedSlugs = ['app', 'play', 'queue'];
    if (reservedSlugs.includes(baseSlug)) {
      return `${baseSlug}-menu`;
    }
    return baseSlug;
  }, []);

  // Helper function to update URL based on current stack
  const updateURL = useCallback((stack) => {
    console.log('updateURL called with stack:', stack);
    
    const pathParts = ['tv'];
    
    // Add menu slugs from the stack
    stack.forEach((item, index) => {
      console.log(`Stack item ${index}:`, item);
      // Include menu, list, and play types for URL navigation
      if (item.slug && (item.type === 'menu' || item.type === 'list' || item.type === 'play')) {
        pathParts.push(item.slug);
        console.log(`Added slug "${item.slug}" to path`);
      }
    });
    
    const newPath = `/${pathParts.join('/')}`;
    console.log('Updating URL to:', newPath);
    window.history.replaceState(null, '', newPath);
    console.log('URL updated. Current location:', window.location.pathname);
  }, []);

  const parsedRoute = parseSubPath(subPath);

  useEffect(setupNavigationHandlers, []);

  useEffect(() => {
    const fetchData = async () => {
      const data = await DaylightAPI("data/list/TVApp/recent_on_top");
      setList(data);
    };
    fetchData();
  }, []);

  useEffect(() => {
    if (parsedRoute) {
      let content = null;
      let meta = {};
      
      switch (parsedRoute.type) {
        case 'app':
          content = <AppContainer 
            open={{ app: parsedRoute.app }} 
            clear={() => setContentStack([])} 
          />;
          meta = { type: 'app' };
          break;
        case 'play':
          const playConfig = { [parsedRoute.mediaType]: parsedRoute.mediaId };
          content = <Player 
            play={playConfig} 
            clear={() => setContentStack([])} 
          />;
          meta = { type: 'play' };
          break;
        case 'queue':
          const queueConfig = { [parsedRoute.mediaType]: parsedRoute.mediaId };
          content = <Player 
            queue={queueConfig} 
            clear={() => setContentStack([])} 
          />;
          meta = { type: 'queue' };
          break;
        case 'menu':
          // Reconstruct menu path - this is a simplified version
          // In a real implementation, you'd need to traverse the menu data
          // to rebuild the exact menu stack based on the slugs
          if (parsedRoute.menuPath && parsedRoute.menuPath.length > 0) {
            // For now, treat the first slug as a menu selection
            // This should be enhanced to actually traverse menu data
            const menuSelection = { 
              menu: { slug: parsedRoute.menuPath[0] },
              title: parsedRoute.menuPath[0].replace(/-/g, ' '), // Rough reverse of slugify
              clear: () => setContentStack([])
            };
            content = <TVMenu {...menuSelection} onSelect={handleSelection} onEscape={handleEscape} />;
            meta = { type: 'menu', slug: parsedRoute.menuPath[0] };
          }
          break;
      }
      
      if (content) {
        setContentStack([{ content, ...meta }]);
      }
    }
  }, [parsedRoute, handleSelection, handleEscape]);

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
    const clear = () => setCurrentContent(null);
    
    // Debug: Log the selection to understand its structure
    console.log('Selection received:', selection);
    
    // Create enhanced props with slug generation for menus
    const createMenuProps = (selection) => {
      const props = { ...selection, clear, onSelect: handleSelection, onEscape: handleEscape };
      return props;
    };

    const props = createMenuProps(selection);
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
    
    // Try to extract title/label for slug generation
    let titleForSlug = selection.label || selection.title || selection.name;
    
    // If it's a list/menu selection, try to get the title from the nested object
    if ((match === 'list' || match === 'menu') && selection[match]) {
      titleForSlug = titleForSlug || selection[match].title || selection[match].label || selection[match].name;
    }
    
    console.log('Title for slug:', titleForSlug, 'Match type:', match);
    console.log('Generated slug:', titleForSlug ? slugify(titleForSlug) : 'NO SLUG');
    
    const meta = { 
      type: match, 
      slug: titleForSlug ? slugify(titleForSlug) : undefined 
    };
    
    console.log('Meta object:', meta);
    
    return match ? { 
      content: options[match], 
      meta 
    } : null;
  }

  // Override setCurrentContent to push or pop from contentStack and update URL
  const setCurrentContent = useCallback((newContent, contentMeta = {}) => {
    console.log('setCurrentContent called with:', { newContent: !!newContent, contentMeta });
    
    if (!newContent) {
      // Pop one item from stack (go back one level)
      setContentStack((oldStack) => {
        console.log('Popping from stack. Old stack length:', oldStack.length);
        const newStack = oldStack.length > 0 ? oldStack.slice(0, -1) : [];
        console.log('New stack after pop:', newStack);
        // Update URL to reflect new stack
        setTimeout(() => updateURL(newStack), 0);
        return newStack;
      });
    } else {
      // Push new content to stack with metadata
      setContentStack((oldStack) => {
        console.log('Pushing to stack. Old stack length:', oldStack.length);
        const stackItem = {
          content: newContent,
          type: contentMeta.type || 'unknown',
          slug: contentMeta.slug
        };
        console.log('New stack item:', stackItem);
        const newStack = [...oldStack, stackItem];
        console.log('New stack after push:', newStack);
        // Update URL to reflect new stack
        setTimeout(() => updateURL(newStack), 0);
        return newStack;
      });
    }
  }, [updateURL]);

  function handleSelection(selection) {
    console.log('handleSelection called with:', selection);
    const result = mapSelectionToContent(selection);
    console.log('mapSelectionToContent returned:', result);
    
    if (result) {
      setCurrentContent(result.content, result.meta);
    } else {
      alert(
        "No valid action found for selection: " + JSON.stringify(Object.keys(selection))
      );
    }
  }

  function handleEscape() {
    console.log('handleEscape called - going back one level, isEscaping:', isEscaping);
    
    // Prevent multiple simultaneous escape calls
    if (isEscaping) {
      console.log('Escape already in progress, ignoring');
      return;
    }
    
    setIsEscaping(true);
    setCurrentContent(null);
    
    // Reset the escape flag after a short delay
    setTimeout(() => {
      setIsEscaping(false);
    }, 100);
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
    }
  }, [autoplay, autoplayed, setCurrentContent]);

  useEffect(() => {
    if (parsedRoute) {
      let content = null;
      let meta = {};
      
      switch (parsedRoute.type) {
        case 'app':
          content = <AppContainer 
            open={{ app: parsedRoute.app }} 
            clear={() => setContentStack([])} 
          />;
          meta = { type: 'app' };
          break;
        case 'play':
          const playConfig = { [parsedRoute.mediaType]: parsedRoute.mediaId };
          content = <Player 
            play={playConfig} 
            clear={() => setContentStack([])} 
          />;
          meta = { type: 'play' };
          break;
        case 'queue':
          const queueConfig = { [parsedRoute.mediaType]: parsedRoute.mediaId };
          content = <Player 
            queue={queueConfig} 
            clear={() => setContentStack([])} 
          />;
          meta = { type: 'queue' };
          break;
        case 'menu':
          // Reconstruct menu path - this is a simplified version
          // In a real implementation, you'd need to traverse the menu data
          // to rebuild the exact menu stack based on the slugs
          if (parsedRoute.menuPath && parsedRoute.menuPath.length > 0) {
            // For now, treat the first slug as a menu selection
            // This should be enhanced to actually traverse menu data
            const menuSelection = { 
              menu: { slug: parsedRoute.menuPath[0] },
              title: parsedRoute.menuPath[0].replace(/-/g, ' '), // Rough reverse of slugify
              clear: () => setContentStack([])
            };
            content = <TVMenu {...menuSelection} onSelect={handleSelection} onEscape={handleEscape} />;
            meta = { type: 'menu', slug: parsedRoute.menuPath[0] };
          }
          break;
      }
      
      if (content) {
        setContentStack([{ content, ...meta }]);
      }
    }
  }, [parsedRoute]);

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

