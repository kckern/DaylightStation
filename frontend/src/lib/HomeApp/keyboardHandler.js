import { useEffect } from 'react';
import { DaylightAPI } from '../api.mjs';

/**
 * Application-level keyboard handler for HomeApp
 * Handles menu navigation, app functions, and hardware keypad integration
 * Media playback is now handled by the centralized keyboardManager system
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

  // Helper function to check if there's an active media player
  const hasActivePlayer = () => {
    const player = document.querySelector('.player:not(.overlay), .content-scroller:not(.overlay)');
    const mediaElement = player && player.querySelector('audio:not(.ambient), video:not(.ambient), dash-video:not(.ambient)');
    return !!mediaElement;
  };

  // Simplified playback dispatcher - just maps params to keyboard events
  const dispatchPlaybackKey = (params) => {
    const keyMapping = {
      'play': 'Enter',
      'pause': 'Enter', 
      'prev': 'Backspace',
      'rew': 'ArrowLeft',
      'fwd': 'ArrowRight'
    };
    
    const keyToDispatch = keyMapping[params] || 'Tab';
    
    const keyboardEvent = new KeyboardEvent('keydown', {
      key: keyToDispatch,
      code: keyToDispatch,
      bubbles: true,
      cancelable: true
    });
    
    window.dispatchEvent(keyboardEvent);
    console.log(`App dispatched: ${params} -> ${keyToDispatch}`);
  };

  // Helper function to execute secondary/fallback action
  const executeSecondaryAction = (secondary) => {
    const colonIndex = secondary.indexOf(':');
    if (colonIndex === -1) return false;

    const functionName = secondary.substring(0, colonIndex).trim().toLowerCase();
    const params = secondary.substring(colonIndex + 1).trim();
    const fn = buttonFunctions[functionName];
    
    if (fn) {
      console.log(`Executing fallback: ${functionName}(${params})`);
      fn(params);
      return true;
    }
    return false;
  };

  const parseParams = (p) => {
    if (p?.includes?.(":")) {
      return p.split(":").map(s => s.trim());
    }
    // Only default to plex if value is numeric
    if (/^\d+$/.test(p)) {
      return ["plex", p ?? ""];
    }
    // Otherwise default to media
    return ["media", p ?? ""];
  };

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
    playback: (params, action) => {
      if (hasActivePlayer()) {
        // Player components handle their own keyboard events directly
        // Don't dispatch synthetic events to avoid double handling
        console.log(`Active player detected, letting it handle ${params} directly`);
      } else if (action?.secondary) {
        if (!executeSecondaryAction(action.secondary)) {
          console.warn('Failed to execute secondary action:', action.secondary);
        }
      } else {
        console.log('No active player and no secondary function defined');
      }
    },
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
            endpoint = 'exe/vol/cycle';
        }
        
        const response = await DaylightAPI(endpoint);
        console.log('Volume control response:', response);
      } catch (error) {
        console.error('Volume control error:', error);
      }
    },
    shader: (params) => {
      setShaderOpacity((currentOpacity) => {
        const opacityLevels = [0, 0.25, 0.5, 0.75, 0.9];
        const currentIndex = opacityLevels.findIndex(level => Math.abs(level - currentOpacity) < 0.01);

        if (currentIndex === -1) {
          console.log(`Shader opacity changed from ${Math.round(currentOpacity * 100)}% to 25%`);
          return 0.25;
        }

        let nextIndex;
        if (typeof setShaderOpacity._direction === 'undefined') {
          setShaderOpacity._direction = 1;
        }
        if (currentIndex === opacityLevels.length - 1) {
          setShaderOpacity._direction = -1;
        } else if (currentIndex === 0) {
          setShaderOpacity._direction = 1;
        }
        nextIndex = currentIndex + setShaderOpacity._direction;
        nextIndex = Math.max(0, Math.min(opacityLevels.length - 1, nextIndex));

        const nextOpacity = opacityLevels[nextIndex];
        console.log(`Shader opacity changed from ${Math.round(currentOpacity * 100)}% to ${Math.round(nextOpacity * 100)}%`);
        return nextOpacity;
      });
    },
    rate: () => {
      const player = document.querySelector('.player:not(.overlay), .content-scroller:not(.overlay)');
      let mediaElement = null;
      if (player) {
        mediaElement = player.querySelector('audio:not(.ambient), video:not(.ambient), dash-video:not(.ambient)');
      }
      
      if (!mediaElement) {
        console.log('No media element found');
        return;
      }

      const currentRate = mediaElement.playbackRate;
      let nextRate;
      if (currentRate === 1.0) {
        nextRate = 1.5;
      } else if (currentRate === 1.5) {
        nextRate = 2.0;
      } else {
        nextRate = 1.0;
      }
      mediaElement.playbackRate = nextRate;
      console.log(`Playback rate changed from ${currentRate}x to ${nextRate}x`);
    },
    sleep: () => {
      setShaderOpacity((currentOpacity) => {
        if (currentOpacity === 1.0) {
          // Already asleep, so wake up
          const restoreOpacity = (previousShaderOpacity === null || previousShaderOpacity === 1.0) ? 0 : previousShaderOpacity;
          console.log(`Sleep wake: Restoring shader opacity to ${Math.round(restoreOpacity * 100)}%`);
          previousShaderOpacity = null;
          return restoreOpacity;
        } else {
          // Not asleep, so go to sleep
          previousShaderOpacity = currentOpacity;
          console.log(`Sleep off: Storing opacity ${Math.round(currentOpacity * 100)}% and turning off (100%)`);
          // Add a one-time keydown listener to wake up
          const wakeUp = (e) => {
            e.stopPropagation();
            e.preventDefault();
            setShaderOpacity((_) => {
              const restoreOpacity = (previousShaderOpacity === null || previousShaderOpacity === 1.0) ? 0 : previousShaderOpacity;
              console.log(`Sleep wake (keydown): Restoring shader opacity to ${Math.round(restoreOpacity * 100)}%`);
              previousShaderOpacity = null;
              return restoreOpacity;
            });
            window.removeEventListener('keydown', wakeUp, true);
          };
          window.addEventListener('keydown', wakeUp, true);
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
    if (fn) {
      // Pass the action object for playback function to access secondary property
      if (action?.function === 'playback') {
        fn(action.params, action);
      } else {
        fn(action.params);
      }
    }
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
