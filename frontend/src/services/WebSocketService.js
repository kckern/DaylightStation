/**
 * WebSocketService - Centralized WebSocket connection manager
 * 
 * Provides a singleton WebSocket connection with topic-based subscriptions.
 * All apps (OfficeApp, FitnessApp, TVApp) should use this service instead of
 * maintaining their own WebSocket connections.
 * 
 * @example
 * // Subscribe to specific topics
 * const unsubscribe = wsService.subscribe(['fitness', 'vibration'], (data) => {
 *   console.log('Received:', data);
 * });
 * 
 * // Subscribe with a predicate function
 * const unsubscribe = wsService.subscribe(
 *   (data) => data.menu || data.playback,
 *   handleCommand
 * );
 * 
 * // Cleanup on unmount
 * useEffect(() => unsubscribe, []);
 */

// Adaptive throttling: progressive delays that never give up
// Tiers: 1s, 2s, 4s, 8s, 15s, 30s, 1min, 5min, 15min, 1hr (terminal)
const RECONNECT_DELAYS = [
  1000,      // Tier 0: 1 second (initial fast retry)
  2000,      // Tier 1: 2 seconds
  4000,      // Tier 2: 4 seconds
  8000,      // Tier 3: 8 seconds
  15000,     // Tier 4: 15 seconds
  30000,     // Tier 5: 30 seconds
  60000,     // Tier 6: 1 minute (enters degraded mode)
  300000,    // Tier 7: 5 minutes
  900000,    // Tier 8: 15 minutes
  3600000    // Tier 9: 1 hour (terminal - stays here)
];

const DEGRADED_MODE_TIER = 6; // 1 minute mark

class WebSocketService {
  constructor() {
    this.ws = null;
    this.subscribers = new Map(); // key -> { filter, callbacks: Set }
    this.connected = false;
    this.connecting = false;
    this.reconnectTier = 0; // Current reconnection tier (0-9)
    this.degradedMode = false; // True when tier >= DEGRADED_MODE_TIER
    this.reconnectTimeout = null;
    this.messageQueue = []; // Buffer messages during disconnect
    this.statusListeners = new Set(); // Connection status observers
    this._subscriberIdCounter = 0;
  }

  /**
   * Get the WebSocket URL based on current environment
   * In dev mode with Vite, use same origin (Vite will proxy /ws to backend)
   * In production, frontend and backend are same origin
   */
  _getWsUrl() {
    // Always use current origin - in dev, Vite proxies /ws to backend
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${protocol}//${window.location.host}/ws`;
  }

  /**
   * Connect to the WebSocket server
   */
  connect() {
    if (this.ws?.readyState === WebSocket.CONNECTING || this.ws?.readyState === WebSocket.OPEN) {
      return;
    }

    this.connecting = true;
    this._notifyStatusListeners();

    const wsUrl = this._getWsUrl();
    console.log(`[WebSocketService] Connecting to ${wsUrl}`);

    this.ws = new WebSocket(wsUrl);

    this.ws.onopen = () => {
      console.log('[WebSocketService] Connected');
      this.connected = true;
      this.connecting = false;
      this.reconnectTier = 0; // Reset tier on successful connection
      this.degradedMode = false;
      this._notifyStatusListeners();
      this._syncSubscriptions(); // Inform backend of our interests
      this._flushMessageQueue();
    };

    this.ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        this._dispatch(data);
      } catch (e) {
        // Ignore non-JSON messages
      }
    };

    this.ws.onclose = (event) => {
      console.log(`[WebSocketService] Disconnected (code: ${event.code})`);
      this.connected = false;
      this.connecting = false;
      this.ws = null;
      this._notifyStatusListeners();
      this._scheduleReconnect();
    };

    this.ws.onerror = (error) => {
      console.error('[WebSocketService] Error:', error);
      this.connected = false;
      this.connecting = false;
      this._notifyStatusListeners();
    };
  }

  /**
   * Disconnect and cleanup
   */
  disconnect() {
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }

    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }

    this.connected = false;
    this.connecting = false;
    this.reconnectTier = 0;
    this.degradedMode = false;
    this._notifyStatusListeners();
  }

  /**
   * Schedule a reconnection attempt with adaptive throttling.
   * Uses progressive delays that never give up, backing off to hourly attempts.
   */
  _scheduleReconnect() {
    const delay = RECONNECT_DELAYS[Math.min(this.reconnectTier, RECONNECT_DELAYS.length - 1)];
    const wasDegraded = this.degradedMode;
    this.degradedMode = this.reconnectTier >= DEGRADED_MODE_TIER;
    
    // Notify subscribers when entering or exiting degraded mode
    if (this.degradedMode !== wasDegraded) {
      console.log(`[WebSocketService] ${this.degradedMode ? 'Entering' : 'Exiting'} degraded mode (tier ${this.reconnectTier})`);
      this._notifyStatusListeners();
    }
    
    const tierLabel = this.reconnectTier < RECONNECT_DELAYS.length ? `tier ${this.reconnectTier}` : 'terminal';
    const delayLabel = delay >= 3600000 ? `${delay / 3600000}hr` : delay >= 60000 ? `${delay / 60000}min` : `${delay / 1000}s`;
    console.log(`[WebSocketService] Reconnecting in ${delayLabel} (${tierLabel})`);

    this.reconnectTimeout = setTimeout(() => {
      this.reconnectTier++;
      this.connect();
    }, delay);
  }

  /**
   * Flush queued messages after reconnection
   */
  _flushMessageQueue() {
    while (this.messageQueue.length > 0) {
      const message = this.messageQueue.shift();
      this._sendRaw(message);
    }
  }

  /**
   * Send a raw message string
   */
  _sendRaw(message) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(message);
      return true;
    }
    return false;
  }

  /**
   * Synchronize current subscriptions with the backend
   */
  _syncSubscriptions() {
    if (!this.connected || this.ws?.readyState !== WebSocket.OPEN) return;

    const topics = new Set();
    let needsWildcard = false;

    for (const { filter } of this.subscribers.values()) {
      if (typeof filter === 'string') {
        topics.add(filter);
      } else if (Array.isArray(filter)) {
        filter.forEach(t => topics.add(t));
      } else if (filter === null || filter === undefined) {
        needsWildcard = true;
      } else if (typeof filter === 'function') {
        // Predicate functions currently require a wildcard because we can't 
        // evaluate them on the backend. Phase 3 will migrate these to topics.
        needsWildcard = true;
      }
    }

    if (needsWildcard) {
      topics.add('*');
    }

    if (topics.size > 0) {
      this.send({
        type: 'bus_command',
        action: 'subscribe',
        topics: Array.from(topics)
      });
      console.log('[WebSocketService] Synced subscriptions:', Array.from(topics));
    }
  }

  /**
   * Send data through the WebSocket
   * @param {object|string} data - Data to send (will be JSON stringified if object)
   */
  send(data) {
    const message = typeof data === 'string' ? data : JSON.stringify(data);

    if (this.connected && this.ws?.readyState === WebSocket.OPEN) {
      this._sendRaw(message);
    } else {
      // Queue for later delivery
      this.messageQueue.push(message);
    }
  }

  /**
   * Subscribe to WebSocket messages
   * 
   * @param {string|string[]|function} filter - Filter for messages:
   *   - string: Match messages where topic or type equals the string
   *   - string[]: Match messages where topic or type is in the array
   *   - function: Predicate function (data) => boolean
   * @param {function} callback - Called with matching messages
   * @returns {function} Unsubscribe function
   */
  subscribe(filter, callback) {
    // Generate a unique key for this subscription
    const id = ++this._subscriberIdCounter;
    const key = `sub_${id}`;

    this.subscribers.set(key, { filter, callback });

    // Inform backend of new subscription interests
    this._syncSubscriptions();

    // Auto-connect on first subscription
    if (this.subscribers.size === 1 && !this.connected && !this.connecting) {
      this.connect();
    }

    // Return unsubscribe function
    return () => {
      this.subscribers.delete(key);
      this._syncSubscriptions(); // Update backend after unsubscription
    };
  }

  /**
   * Dispatch a message to all matching subscribers
   */
  _dispatch(data) {
    for (const [, { filter, callback }] of this.subscribers) {
      let matches = false;

      if (typeof filter === 'function') {
        // Predicate function
        try {
          matches = filter(data);
        } catch (e) {
          console.error('[WebSocketService] Filter error:', e);
          matches = false;
        }
      } else if (Array.isArray(filter)) {
        // Array of topics/types
        matches = filter.includes(data.topic) || filter.includes(data.type);
      } else if (typeof filter === 'string') {
        // Single topic/type
        matches = data.topic === filter || data.type === filter;
      } else if (filter === null || filter === undefined) {
        // Wildcard - receive all messages
        matches = true;
      }

      if (matches) {
        try {
          callback(data);
        } catch (err) {
          console.error('[WebSocketService] Subscriber callback error:', err);
        }
      }
    }
  }

  /**
   * Subscribe to connection status changes
   * @param {function} listener - Called with { connected, connecting }
   * @returns {function} Unsubscribe function
   */
  onStatusChange(listener) {
    this.statusListeners.add(listener);

    // Immediately notify with current status
    listener({ connected: this.connected, connecting: this.connecting });

    return () => {
      this.statusListeners.delete(listener);
    };
  }

  /**
   * Notify all status listeners of a change
   */
  _notifyStatusListeners() {
    const status = { 
      connected: this.connected, 
      connecting: this.connecting,
      degraded: this.degradedMode,
      reconnectTier: this.reconnectTier
    };
    for (const listener of this.statusListeners) {
      try {
        listener(status);
      } catch (e) {
        console.error('[WebSocketService] Status listener error:', e);
      }
    }
  }

  /**
   * Get current connection status
   */
  getStatus() {
    return {
      connected: this.connected,
      connecting: this.connecting,
      degraded: this.degradedMode,
      reconnectTier: this.reconnectTier,
      subscriberCount: this.subscribers.size,
      queuedMessages: this.messageQueue.length
    };
  }
}

// Singleton instance
export const wsService = new WebSocketService();

// Also export the class for testing
export { WebSocketService };

export default wsService;
