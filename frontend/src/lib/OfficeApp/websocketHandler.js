import getLogger from '../logging/Logger.js';

/**
 * WebSocket payload handler for OfficeApp
 * Handles incoming websocket messages and transforms them into menu selections
 */

/**
 * Handles media playback control commands by simulating keyboard events
 * Maps playback commands to keyboard shortcuts that the media players understand
 */
const handleMediaPlaybackControl = (playbackCommand) => {
  const playbackMap = {
    // Basic playback controls
    'play': ' ', // Space key to play/pause
    'pause': ' ', // Space key to play/pause
    'toggle': ' ', // Space key to play/pause
    'playpause': ' ', // Space key to play/pause
    'play_pause': ' ', // Space key to play/pause
    
    // Navigation controls
    'next': 'Tab', // Tab key to skip to next track
    'previous': 'Backspace', // Backspace to skip to previous track
    'prev': 'Backspace', // Short form for previous
    'skip': 'Tab', // Skip to next
    'back': 'Backspace', // Go back
    
    // Seeking controls
    'forward': 'ArrowRight', // Seek forward
    'rewind': 'ArrowLeft', // Seek backward
    'fwd': 'ArrowRight', // Short form for forward
    'rew': 'ArrowLeft', // Short form for rewind
    'ff': 'ArrowRight', // Fast forward
    'rw': 'ArrowLeft', // Rewind
    
    // Stop/clear controls
    'stop': 'Escape', // Escape to stop/clear
    'clear': 'Escape', // Clear the current content
    'exit': 'Escape', // Exit current playback
    
    // Shader/display controls
    'shader_up': 'ArrowUp', // Cycle shader up
    'shader_down': 'ArrowDown', // Cycle shader down
    'display_up': 'ArrowUp', // Display mode up
    'display_down': 'ArrowDown' // Display mode down
  };

  const keyToPress = playbackMap[playbackCommand.toLowerCase()];
  
  if (keyToPress) {
    // Create and dispatch a keyboard event
    const keyboardEvent = new KeyboardEvent('keydown', {
      key: keyToPress,
      code: keyToPress === ' ' ? 'Space' : keyToPress,
      bubbles: true,
      cancelable: true
    });
    
    // Dispatch the event on the window to ensure it reaches the media handlers
    window.dispatchEvent(keyboardEvent);
    
    console.log(`Playback control: ${playbackCommand} -> ${keyToPress}`);
  } else {
    getLogger().warn('office.websocket.unknown_playback_command', { playbackCommand });
  }
};

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
    // GUARDRAIL: Reject sensor telemetry and non-office messages that may have leaked through
    const BLOCKED_TOPICS = ['vibration', 'fitness', 'sensor', 'telemetry', 'logging'];
    if (data.topic && BLOCKED_TOPICS.includes(data.topic)) {
      console.debug('[WebSocket] Blocked non-office topic:', data.topic);
      return;
    }
    
    // GUARDRAIL: Reject messages from known non-office sources
    const BLOCKED_SOURCES = ['mqtt', 'fitness', 'fitness-simulator', 'playback-logger'];
    if (data.source && BLOCKED_SOURCES.includes(data.source)) {
      console.debug('[WebSocket] Blocked non-office source:', data.source);
      return;
    }
    
    // GUARDRAIL: Reject messages that look like sensor data
    if (data.equipmentId || data.deviceId || data.data?.vibration !== undefined) {
      console.debug('[WebSocket] Blocked sensor-like payload');
      return;
    }

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

    // Handle playback control actions
    if (data.playback) {
      handleMediaPlaybackControl(data.playback);
      return;
    }

    // Determine action type (play or queue)
    // Default to 'play' for single items like scripture, hymn, talk, etc.
    // Only use 'queue' when explicitly specified or when it's clearly a playlist
    const hasPlayKey = Object.keys(data).includes('play');
    const hasQueueKey = Object.keys(data).includes('queue');
    const isContentItem = data.hymn || data.scripture || data.talk || data.primary; // These are always 'play' actions
    const isPlaylistItem = (/^\d+$/.test(Object.values(data)[0]) || data.plex) && !isContentItem; // Numeric IDs or plex usually indicate playlists, but not if it's content
    
    // Use an object with test functions to determine the action type
    const actionTests = {
      play: () => hasPlayKey || isContentItem,
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
