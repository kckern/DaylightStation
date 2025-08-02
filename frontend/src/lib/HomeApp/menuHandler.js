/**
 * Menu selection handler for HomeApp
 * Manages menu selection logic and returns selection data
 */

export const createMenuSelectionHandler = (dependencies) => {
  const {
    queue,
    clear,
    playbackKeys,
    setMenuOpen,
    closeMenu,
    setCurrentContent,
    handleMenuSelection
  } = dependencies;

  return (selection) => {
    setMenuOpen(false);
    
    if (!selection || !selection.label) {
      closeMenu();
      return;
    }
    
    if (!playbackKeys) {
      console.error('Playback keys are not yet loaded.');
      return;
    }
    
    const props = {
      queue,
      ...selection,
      clear,
      onSelection: handleMenuSelection,
      playbackKeys
    };
    
    // Return the selection data instead of JSX
    const selectionKeys = Object.keys(selection);
    const availableKeys = ['play', 'queue', 'playlist', 'list', 'menu', 'open'];
    const firstMatch = selectionKeys.find((key) => availableKeys.includes(key));
    
    if (firstMatch) {
      // Signal to parent component what to render
      setCurrentContent({
        type: firstMatch,
        props: props
      });
      closeMenu();
    }
  };
};
