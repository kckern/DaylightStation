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
    const action = data.action || Object.keys(data).includes('play') ? 'play' : 'queue';
    
    // Transform numeric values to plex, otherwise to media
    if (/^\d+$/.test(data.play || data.queue)) {
      data.plex = data.play || data.queue;
    } else if (data.play || data.queue) {
      data.media = data.play || data.queue;
    }
    
    // Clean up action properties to avoid confusion
    delete data.action;
    delete data[action];

    console.log('WebSocket payload received:', data);

    const selection = {
      label: "wscmd",
      [action]: [data]
    };
    
    console.log({selection});
    setCurrentContent(null);
    handleMenuSelection(selection);
  };
};
