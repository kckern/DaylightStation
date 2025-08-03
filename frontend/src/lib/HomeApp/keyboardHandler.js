import { useEffect } from 'react';
import { DaylightAPI } from '../api.mjs';

/**
 * Keyboard event handler for HomeApp
 * Manages keydown events and maps them to application actions
 */

export const createKeyboardHandler = (dependencies) => {
  const {
    keyMap,
    menu,
    menuOpen,
    currentContent,
    closeMenu,
    openMenu,
    resetQueue,
    setCurrentContent,
    handleMenuSelection,
    setShaderOpacity
  } = dependencies;

  // Store the previous shader opacity for sleep toggle (like mute/unmute)
  let previousShaderOpacity = null;

  const parseParams = (p) => 
    p?.includes?.(":") ? p.split(":").map(s => s.trim()) : ["plex", p ?? ""];

  const openPlayer = (type, params) => {
    const [key, val] = parseParams(params);
    handleMenuSelection({
      label: "keypad",
      [type]: { [key]: val },
    });
  };

  const buttonFunctions = {
    menu: (params) => {
      openMenu(params);
    },
    play: (params) => openPlayer("play", params),
    queue: (params) => openPlayer("queue", params),
    escape: () => {
      if (currentContent) {
        setCurrentContent(null);
        return;
      }
      if (!currentContent && !menuOpen) {
        window.location.reload();
        return;
      }
      closeMenu();
    },
    volume: async (params) => {
      try {
        let endpoint;
        switch (params) {
          case '+1':
            endpoint = 'exe/vol/+';
            break;
          case '-1':
            endpoint = 'exe/vol/-';
            break;
          case 'mute_toggle':
            endpoint = 'exe/vol/togglemute';
            break;
          default:
            // If no specific param, default to cycling through volume levels
            endpoint = 'exe/vol/cycle';
        }
        
        const response = await DaylightAPI(endpoint);
        console.log('Volume control response:', response);
      } catch (error) {
        console.error('Volume control error:', error);
      }
    },
    shader: (params) => {
      // cycle through shaderOpacity values: 0.25, 0.5, 0.75, 1.0, then back to 0.75, 0.5, 0.25, etc.
      // Never cycle to 0 (100% opacity) - that's only for sleep toggle
      setShaderOpacity((currentOpacity) => {
      const opacityLevels = [0.25, 0.5, 0.75, 1.0];
      const currentIndex = opacityLevels.findIndex(level => Math.abs(level - currentOpacity) < 0.01);

      // If current opacity is not in our cycle (like 0), start at first level
      if (currentIndex === -1) {
        console.log(`Shader opacity changed from ${Math.round(currentOpacity * 100)}% to 25%`);
        return 0.25;
      }

      // Determine direction: if at 1.0, start going down; if at 0.25, start going up
      let nextIndex;
      if (typeof setShaderOpacity._direction === 'undefined') {
        setShaderOpacity._direction = 1; // start going up
      }
      if (currentIndex === opacityLevels.length - 1) {
        setShaderOpacity._direction = -1; // reached top, go down
      } else if (currentIndex === 0) {
        setShaderOpacity._direction = 1; // reached bottom, go up
      }
      nextIndex = currentIndex + setShaderOpacity._direction;
      // Clamp nextIndex to valid range
      nextIndex = Math.max(0, Math.min(opacityLevels.length - 1, nextIndex));

      const nextOpacity = opacityLevels[nextIndex];
      console.log(`Shader opacity changed from ${Math.round(currentOpacity * 100)}% to ${Math.round(nextOpacity * 100)}%`);
      return nextOpacity;
      });
    },
    rate: () => {
      // Find the currently playing media element, excluding overlay/background music and ambient audio
      // Select the main media element (audio, video, or dash-video) inside .player, excluding overlays and ambient elements
      const player = document.querySelector('.player:not(.overlay)');
      let mediaElement = null;
      if (player) {
        mediaElement = player.querySelector('audio:not(.ambient), video:not(.ambient), dash-video:not(.ambient)');
      }
      
      if (!mediaElement) {
        console.log('No media element found');
        return;
      }

      // Get current playback rate
      const currentRate = mediaElement.playbackRate;
      
      // Cycle through rates: 1.0 -> 1.5 -> 2.0 -> 1.0
      let nextRate;
      if (currentRate === 1.0) {
        nextRate = 1.5;
      } else if (currentRate === 1.5) {
        nextRate = 2.0;
      } else {
        nextRate = 1.0; // Default back to 1.0 for any other rate (including 2.0)
      }
      
      // Set the new playback rate
      mediaElement.playbackRate = nextRate;
      console.log(`Playback rate changed from ${currentRate}x to ${nextRate}x`);
    },
    sleep: () => {
      // Toggle shader like sleep/wake - always between previous level and 100% (off/invisible)
      setShaderOpacity((currentOpacity) => {
        if (currentOpacity === 1.0) {
          // Currently "off" (100%), restore previous opacity
          // If no previous state or previous was also 100%, default to 0% (fully visible)
          const restoreOpacity = (previousShaderOpacity === null || previousShaderOpacity === 1.0) ? 0 : previousShaderOpacity;
          console.log(`Sleep wake: Restoring shader opacity to ${Math.round(restoreOpacity * 100)}%`);
          return restoreOpacity;
        } else {
          // Currently has some visibility, turn "off" (set to 100%) and remember the current value
          previousShaderOpacity = currentOpacity;
          console.log(`Sleep off: Storing opacity ${Math.round(currentOpacity * 100)}% and turning off (100%)`);
          return 1.0;
        }
      });
    }
  };

  return (event) => {
    // Check for escape key
    if (event.key === 'Escape') {
      return buttonFunctions.escape();
    }

    if (!keyMap[event.key]?.function) {
      // Uncomment for debugging: console.log('No action found for key:', event.key)
      return;
    }

    const action = keyMap[event.key];
    const subMenu = currentContent?.props?.list?.menu || currentContent?.props?.list?.plex;

    // If the menu is already open, or if there's a subMenu, skip processing
    if (
      subMenu ||
      (menu && menuOpen && action?.function === 'menu' && action?.params === menu)
    ) {
      return;
    }

    // If something is playing and "menu" is pressed
    if (currentContent && action?.function === 'menu') {
      resetQueue();
      setCurrentContent(null);
      openMenu(action.params);
      return;
    }

    console.log('Key pressed:', event.key, 'Action:', action);
    const fn = buttonFunctions[action?.function];
    if (fn) fn(action.params);
  };
};

/**
 * Hook to manage keyboard event listeners
 */
export const useKeyboardHandler = (keyMap, dependencies) => {
  useEffect(() => {
    if (!keyMap) return;

    const handleKeyDown = createKeyboardHandler({
      keyMap,
      ...dependencies
    });

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [keyMap, dependencies.menu, dependencies.menuOpen, dependencies.closeMenu, 
      dependencies.currentContent, dependencies.openMenu, dependencies.resetQueue, 
      dependencies.handleMenuSelection, dependencies.setShaderOpacity]);
};
