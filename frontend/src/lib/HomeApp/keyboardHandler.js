import { useEffect } from 'react';

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
    handleMenuSelection
  } = dependencies;

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
    volume: () => {
      console.log('Volume');
    },
    sleep: () => {
      console.log('Sleep');
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
      dependencies.currentContent, dependencies.openMenu, dependencies.resetQueue, dependencies.handleMenuSelection]);
};
