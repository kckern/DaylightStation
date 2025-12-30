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

const MAX_RECONNECT_ATTEMPTS = 10;
const BASE_RECONNECT_DELAY_MS = 1000;
const MAX_RECONNECT_DELAY_MS = 30000;

class WebSocketService {
  constructor() {
    this.ws = null;
    this.subscribers = new Map(); // key -> { filter, callbacks: Set }
    this.connected = false;
    this.connecting = false;
    this.reconnectAttempts = 0;
    this.reconnectTimeout = null;
    this.messageQueue = []; // Buffer messages during disconnect
    this.statusListeners = new Set(); // Connection status observers
    this._subscriberIdCounter = 0;
  }

  /**
   * Get the WebSocket URL based on current environment
   */
  _getWsUrl() {
    const isLocalhost = /localhost/.test(window.location.href);
    const baseUrl = isLocalhost ? 'http://localhost:3112' : window.location.origin;
    return baseUrl.replace(/^http/, 'ws') + '/ws';
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
      this.reconnectAttempts = 0;
      this._notifyStatusListeners();
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
    this.reconnectAttempts = 0;
    this._notifyStatusListeners();
  }

  /**
   * Schedule a reconnection attempt with exponential backoff
   */
  _scheduleReconnect() {
    if (this.reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
      console.error('[WebSocketService] Max reconnection attempts reached');
      return;
    }

    const delay = Math.min(
      BASE_RECONNECT_DELAY_MS * Math.pow(2, this.reconnectAttempts),
      MAX_RECONNECT_DELAY_MS
    );

    console.log(`[WebSocketService] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts + 1}/${MAX_RECONNECT_ATTEMPTS})`);

    this.reconnectTimeout = setTimeout(() => {
      this.reconnectAttempts++;
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

    // Auto-connect on first subscription
    if (this.subscribers.size === 1 && !this.connected && !this.connecting) {
      this.connect();
    }

    // Return unsubscribe function
    return () => {
      this.subscribers.delete(key);
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
    const status = { connected: this.connected, connecting: this.connecting };
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
      reconnectAttempts: this.reconnectAttempts,
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
