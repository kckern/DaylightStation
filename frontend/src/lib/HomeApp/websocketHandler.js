/**
 * WebSocket payload handler for HomeApp
 * Handles incoming websocket messages and transforms them into menu selections
 */

export const createWebSocketHandler = (callbacks) => {
  const {
    setLastPayloadMessage,
    setMenu,
    setMenuOpen,
    resetQueue,
    setCurrentContent,
    setMenuKey,
    handleMenuSelection
  } = callbacks;

  return (data) => {
    setLastPayloadMessage(data);
    delete data.timestamp;

    // Handle menu display
    if (data.menu) {
      setMenu(data.menu);
      setMenuOpen(true);
      return;
    }

    // Handle reset action
    if (data.action === "reset") {
      resetQueue();
      setCurrentContent(null);
      setMenu(false);
      setMenuOpen(false);
      setMenuKey(0);
      return;
    }

    // Determine action type (play or queue)
    // Default to 'play' for single items like scripture, hymn, talk, etc.
    // Only use 'queue' when explicitly specified or when it's clearly a playlist
    const hasPlayKey = Object.keys(data).includes('play');
    const hasQueueKey = Object.keys(data).includes('queue');
    const isPlaylistItem = /^\d+$/.test(Object.values(data)[0]) || data.plex; // Numeric IDs or plex usually indicate playlists
    // Use an object with test functions to determine the action type
    const actionTests = {
      play: () => hasPlayKey,
      queue: () => hasQueueKey || isPlaylistItem
    };

    const action =
      data.action ||
      Object.keys(actionTests).find(key => actionTests[key]()) ||
      'play';
      
    // Transform numeric values to plex, otherwise to media
    if (/^\d+$/.test(data.play || data.queue)) {
      data.plex = data.play || data.queue;
      delete data.play;
      delete data.queue;
    }

    delete data.action;

    const selection = {
      label: "wscmd",
      [action]: data
    };
    
    console.log({selection});
    setCurrentContent(null);
    handleMenuSelection(selection);
  };
};
