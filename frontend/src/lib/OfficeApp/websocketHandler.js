import getLogger from '../logging/Logger.js';

const logger = getLogger().child({ module: 'websocketHandler', app: 'office' });

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
    
    logger.info('office.websocket.playback_control', { playbackCommand, keyToPress });
  } else {
    logger.warn('office.websocket.unknown_playback_command', { playbackCommand });
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
      logger.debug('office.websocket.blocked_topic', { topic: data.topic });
      return;
    }

    // GUARDRAIL: Reject messages from known non-office sources
    const BLOCKED_SOURCES = ['mqtt', 'fitness', 'fitness-simulator', 'playback-logger'];
    if (data.source && BLOCKED_SOURCES.includes(data.source)) {
      logger.debug('office.websocket.blocked_source', { source: data.source });
      return;
    }

    // GUARDRAIL: Reject messages that look like sensor data
    if (data.equipmentId || data.deviceId || data.data?.vibration !== undefined) {
      logger.debug('office.websocket.blocked_sensor_payload');
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

    // ─── Content Reference Extraction ───────────────────────────────
    // Normalize all content identifiers to a single `contentId` key.
    // The backend's ContentIdResolver handles all source resolution —
    // the frontend should not detect source types (plex, watchlist, etc.)

    // Keys that carry the content reference (in priority order)
    const CONTENT_KEYS = ['contentId', 'play', 'queue', 'plex', 'media', 'playlist', 'files'];
    // Legacy collection keys that become compound IDs (e.g., hymn:113)
    const LEGACY_COLLECTION_KEYS = ['hymn', 'scripture', 'talk', 'primary', 'poem'];
    // Keys that are modifiers, not content references
    const MODIFIER_KEYS = new Set(['shuffle', 'shader', 'volume', 'continuous', 'playbackrate',
                                    'maxVideoBitrate', 'maxResolution', 'resume', 'seconds',
                                    'topic', 'source']);

    // 1. Determine action from original keys (before any normalization)
    const action = data.action || (Object.keys(data).includes('queue') ? 'queue' : 'play');

    // 2. Extract the content reference
    let contentRef = null;

    // Check legacy collection keys first (hymn:113, scripture:gen/1, etc.)
    for (const key of LEGACY_COLLECTION_KEYS) {
      if (data[key] != null) {
        contentRef = `${key}:${data[key]}`;
        break;
      }
    }

    // Then check standard content keys
    if (!contentRef) {
      for (const key of CONTENT_KEYS) {
        const val = data[key];
        if (val != null && typeof val !== 'object') {
          contentRef = String(val);
          break;
        }
      }
    }

    // 3. Extract modifiers (non-content, non-metadata keys)
    const payload = {};
    if (contentRef) payload.contentId = contentRef;
    for (const [key, value] of Object.entries(data)) {
      if (MODIFIER_KEYS.has(key)) {
        payload[key] = value;
      }
    }

    // 4. Build selection
    const selection = {
      label: "wscmd",
      [action]: payload
    };

    logger.info('office.websocket.selection', { selection, action });
    setCurrentContent(null);
    handleMenuSelection(selection);
  };
};
