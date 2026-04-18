/**
 * WebSocketEventBus - WebSocket implementation of IEventBus
 *
 * Full event bus with WebSocket server for external clients.
 * Handles:
 * - Internal pub/sub for in-process handlers
 * - WebSocket server for browser/external clients
 * - Topic-based subscriptions with wildcard support
 * - Client connection/disconnection management
 * - Incoming message routing
 *
 * @module infrastructure/eventbus
 */

import { WebSocketServer } from 'ws';
import { nowTs, nowTs24 } from '../utils/index.mjs';
import crypto from 'crypto';
import { parseDeviceTopic, PLAYBACK_STATE_TOPIC } from '#shared-contracts/media/topics.mjs';
import {
  buildDeviceStateBroadcast,
  validateCommandEnvelope,
} from '#shared-contracts/media/envelopes.mjs';

// client-control:<clientId> topic prefix — delivered per connection identity.
const CLIENT_CONTROL_PREFIX = 'client-control:';

/**
 * @typedef {import('./IEventBus.mjs').ClientMeta} ClientMeta
 */

export class WebSocketEventBus {
  #wss = null;
  #httpServer = null;
  #path;
  #logger;
  #running = false;
  #pingInterval = null;

  // Internal pub/sub
  #subscribers = new Map(); // topic -> handler[]

  // Pattern-matched subscribers (run on every publish). Each entry is
  // `{ predicate: (topic) => bool, handler: (payload, topic) => void }`.
  #patternSubscribers = [];

  // External client tracking
  #clients = new Map(); // clientId -> { ws, meta }

  // Event handlers
  #connectionHandlers = [];
  #disconnectionHandlers = [];
  #messageHandlers = [];

  // Metrics
  #metrics = {
    startedAt: null,
    messagesPublished: 0,
    messagesBroadcast: 0,
    clientsConnected: 0,
    clientsDisconnected: 0
  };

  // Optional DeviceLivenessService used for last-snapshot replay on subscribe
  #livenessService = null;

  /**
   * @param {Object} [options]
   * @param {string} [options.path='/ws'] - WebSocket path
   * @param {Object} [options.logger] - Logger instance
   * @param {Object} [options.livenessService] - DeviceLivenessService for snapshot replay
   */
  constructor(options = {}) {
    this.#path = options.path || '/ws';
    this.#logger = options.logger || console;
    this.#livenessService = options.livenessService || null;
  }

  /**
   * Inject or replace the DeviceLivenessService (used for snapshot replay).
   * Lets bootstrap wire the service after both are constructed.
   * @param {Object|null} svc
   */
  setLivenessService(svc) {
    this.#livenessService = svc || null;
  }

  /**
   * @returns {Object|null}
   */
  getLivenessService() {
    return this.#livenessService;
  }

  /**
   * Test seam: replace the client pool with a custom Map-like. Only for tests.
   * Accepts a Map where values are `{ ws, meta }`.
   * @param {Map} clients
   */
  _testSetClientPool(clients) {
    this.#clients = clients;
  }

  /**
   * Test seam: force the WebSocket server reference to a truthy value so
   * broadcast() doesn't short-circuit on missing server. Only for tests.
   */
  _testSetServerAttached() {
    if (!this.#wss) this.#wss = /** @type {any} */ ({ __test: true });
  }

  // ===========================================================================
  // Lifecycle
  // ===========================================================================

  /**
   * Start the WebSocket server
   * @param {Object} server - HTTP server to attach to
   */
  async start(server) {
    if (this.#running) {
      this.#logger.warn?.('eventbus.already_running');
      return;
    }

    this.#httpServer = server;
    this.#wss = new WebSocketServer({ server, path: this.#path });
    this.#running = true;
    this.#metrics.startedAt = Date.now();

    this.#logger.info?.('eventbus.started', { path: this.#path });

    this.#wss.on('connection', (ws, req) => this.#handleConnection(ws, req));
    this.#wss.on('error', (err) => {
      this.#logger.error?.('eventbus.server_error', { error: err.message });
    });

    // Ping all clients every 30s to detect stale connections
    this.#pingInterval = setInterval(() => {
      for (const [clientId, { ws }] of this.#clients) {
        if (ws._wsPongReceived === false) {
          // No pong since last ping — connection is stale
          this.#logger.warn?.('eventbus.client_stale', { clientId });
          ws.terminate();
          continue;
        }
        ws._wsPongReceived = false;
        ws.ping();
      }
    }, 30000);
  }

  /**
   * Stop the WebSocket server
   */
  async stop() {
    if (!this.#running) return;

    this.#logger.info?.('eventbus.stopping');

    // Stop ping interval
    if (this.#pingInterval) {
      clearInterval(this.#pingInterval);
      this.#pingInterval = null;
    }

    // Close all client connections
    for (const [clientId, { ws }] of this.#clients) {
      try {
        ws.close();
      } catch (e) {
        // Ignore close errors
      }
    }
    this.#clients.clear();

    // Close the server
    if (this.#wss) {
      this.#wss.close();
      this.#wss = null;
    }

    this.#running = false;
    this.#logger.info?.('eventbus.stopped');
  }

  /**
   * Restart the WebSocket server
   */
  async restart() {
    await this.stop();
    if (this.#httpServer) {
      await this.start(this.#httpServer);
    }
  }

  /**
   * Check if the event bus is running
   * @returns {boolean}
   */
  isRunning() {
    return this.#running;
  }

  // ===========================================================================
  // Internal Pub/Sub
  // ===========================================================================

  /**
   * Publish event to internal subscribers only
   * @param {string} topic - Event topic
   * @param {Object} payload - Event payload
   */
  publish(topic, payload) {
    this.#metrics.messagesPublished++;
    const handlers = this.#subscribers.get(topic) || [];

    for (const handler of handlers) {
      try {
        handler(payload, topic);
      } catch (err) {
        this.#logger.error?.('eventbus.handler_error', { topic, error: err.message });
      }
    }

    // Pattern subscribers run on every publish (e.g. DeviceLivenessService
    // listening to all device-state:* topics).
    for (const { predicate, handler } of this.#patternSubscribers) {
      let match = false;
      try {
        match = !!predicate(topic);
      } catch (err) {
        this.#logger.error?.('eventbus.pattern_predicate_error', { topic, error: err.message });
        continue;
      }
      if (!match) continue;
      try {
        handler(payload, topic);
      } catch (err) {
        this.#logger.error?.('eventbus.pattern_handler_error', { topic, error: err.message });
      }
    }
  }

  /**
   * Subscribe to any topic matching a predicate. Predicate receives the
   * topic string; return true to deliver. Use sparingly — pattern
   * subscribers run on every publish.
   *
   * @param {(topic: string) => boolean} predicate
   * @param {(payload: object, topic: string) => void} handler
   * @returns {Function} Unsubscribe function
   */
  subscribePattern(predicate, handler) {
    const entry = { predicate, handler };
    this.#patternSubscribers.push(entry);
    return () => {
      const idx = this.#patternSubscribers.indexOf(entry);
      if (idx !== -1) this.#patternSubscribers.splice(idx, 1);
    };
  }

  /**
   * Subscribe to internal events
   * @param {string} topic - Topic to subscribe to
   * @param {Function} handler - Handler function (payload, topic) => void
   * @returns {Function} Unsubscribe function
   */
  subscribe(topic, handler) {
    if (!this.#subscribers.has(topic)) {
      this.#subscribers.set(topic, []);
    }
    this.#subscribers.get(topic).push(handler);

    return () => this.unsubscribe(topic, handler);
  }

  /**
   * Unsubscribe from internal events
   * @param {string} topic - Topic
   * @param {Function} handler - Handler to remove
   */
  unsubscribe(topic, handler) {
    const handlers = this.#subscribers.get(topic);
    if (handlers) {
      const index = handlers.indexOf(handler);
      if (index !== -1) {
        handlers.splice(index, 1);
      }
    }
  }

  // ===========================================================================
  // External Broadcast
  // ===========================================================================

  /**
   * Broadcast event to external clients and publish internally.
   *
   * Routing rules:
   * - `device-state:<id>`, `device-ack:<id>`, `homeline:<id>`: deliver only to
   *   subscribers of that exact topic (or wildcard).
   * - `screen:<id>`: deliver only to the WS client identified as that device;
   *   if connection identity isn't tracked (current state; Task 4.1 adds it),
   *   fall back to subscribers of that exact topic.
   * - `client-control:<clientId>`: deliver only to the WS connection
   *   identified as that clientId. Identity is not yet tracked (Task 4.1),
   *   so this currently logs a warn and drops.
   * - `playback_state` (broadcast): deliver to all subscribers of that topic
   *   or to wildcard subscribers.
   * - Unknown topic prefixes with no internal subscribers: log
   *   `bus.topic.unknown` and drop external delivery. Legacy topics that
   *   already have internal subscribers continue to deliver to wildcard
   *   subscribers for backward compatibility.
   *
   * @param {string} topic - Event topic
   * @param {Object} payload - Event payload
   */
  broadcast(topic, payload) {
    // Publish internally first (always — internal handlers are topic-exact).
    this.publish(topic, payload);

    // Broadcast to WebSocket clients
    if (!this.#wss) {
      this.#logger.warn?.('eventbus.broadcast.no_server');
      return;
    }

    this.#metrics.messagesBroadcast++;

    const message = {
      topic,
      timestamp: nowTs(),
      ...payload
    };
    const msg = JSON.stringify(message);

    const parsed = parseDeviceTopic(topic);

    // Per-device topics: deliver to that device's topic subscribers only.
    if (parsed) {
      const { kind } = parsed;
      let sentCount = 0;

      if (kind === 'screen') {
        // Prefer direct delivery to the identified connection (Task 4.1).
        // Until connection identity is tracked, fall back to topic subscribers.
        for (const [, { ws, meta }] of this.#clients) {
          if (ws.readyState !== ws.OPEN) continue;
          if (meta.subscriptions.has(topic)) {
            ws.send(msg);
            sentCount++;
          }
        }
      } else {
        for (const [, { ws, meta }] of this.#clients) {
          if (ws.readyState !== ws.OPEN) continue;
          const subs = meta.subscriptions;
          if (subs.has(topic) || subs.has('*')) {
            ws.send(msg);
            sentCount++;
          }
        }
      }

      this.#logger.debug?.('eventbus.broadcast.device', {
        topic, kind, deviceId: parsed.deviceId, sentCount
      });
      return sentCount;
    }

    // client-control:<clientId>: identity-routed. Delivered only to the one
    // connection whose identity matches the parsed clientId (set by an
    // `identify` message from the client). Envelope must validate against
    // the command contract — otherwise drop with a warn so malformed
    // relays don't poison the stream.
    if (typeof topic === 'string' && topic.startsWith(CLIENT_CONTROL_PREFIX)) {
      const targetClientId = topic.slice(CLIENT_CONTROL_PREFIX.length);
      if (!targetClientId) {
        this.#logger.warn?.('client-control.invalid-topic', { topic });
        return 0;
      }

      const validation = validateCommandEnvelope(payload);
      if (!validation.valid) {
        this.#logger.warn?.('client-control.envelope-invalid', {
          topic,
          clientId: targetClientId,
          error: validation.errors[0],
        });
        return 0;
      }

      let delivered = 0;
      for (const [, { ws, meta }] of this.#clients) {
        if (meta?.clientId !== targetClientId) continue;
        if (ws.readyState !== ws.OPEN) continue;
        ws.send(msg);
        delivered++;
      }
      if (delivered === 0) {
        this.#logger.debug?.('client-control.no-client', {
          topic,
          clientId: targetClientId,
        });
      }
      return delivered;
    }

    // playback_state is a full broadcast topic.
    if (topic === PLAYBACK_STATE_TOPIC) {
      let sentCount = 0;
      for (const [, { ws, meta }] of this.#clients) {
        if (ws.readyState !== ws.OPEN) continue;
        const subs = meta.subscriptions;
        if (subs.has(topic) || subs.has('*')) {
          ws.send(msg);
          sentCount++;
        }
      }
      this.#logger.debug?.('eventbus.broadcast.playback_state', {
        topic, sentCount
      });
      return sentCount;
    }

    // Legacy topics: if anyone subscribes to this exact topic, deliver.
    // Wildcard clients also continue to receive. For topics with no
    // subscribers and no internal handlers, warn and drop.
    const hasInternalSubscribers = this.#subscribers.has(topic)
      && (this.#subscribers.get(topic) || []).length > 0;
    let hasExternalSubscribers = false;
    for (const [, { ws, meta }] of this.#clients) {
      if (ws.readyState !== ws.OPEN) continue;
      if (meta.subscriptions.has(topic) || meta.subscriptions.has('*')) {
        hasExternalSubscribers = true;
        break;
      }
    }

    if (!hasInternalSubscribers && !hasExternalSubscribers) {
      this.#logger.warn?.('bus.topic.unknown', { topic });
      return 0;
    }

    let sentCount = 0;
    for (const [, { ws, meta }] of this.#clients) {
      if (ws.readyState !== ws.OPEN) continue;
      const subs = meta.subscriptions;
      if (subs.has(topic) || subs.has('*')) {
        ws.send(msg);
        sentCount++;
      }
    }

    this.#logger.info?.('eventbus.broadcast', {
      topic,
      sentCount,
      clientCount: this.#clients.size
    });

    return sentCount;
  }

  // ===========================================================================
  // Client Subscription Management
  // ===========================================================================

  /**
   * Subscribe a client to topics
   * @param {string} clientId - Client ID
   * @param {string|string[]} topics - Topic(s) to subscribe to
   */
  subscribeClient(clientId, topics) {
    const client = this.#clients.get(clientId);
    if (!client) return;

    const topicList = Array.isArray(topics) ? topics : [topics];
    for (const topic of topicList) {
      client.meta.subscriptions.add(topic);
    }

    this.#logger.debug?.('eventbus.client_subscribed', { clientId, topics: topicList });

    // Replay last known device-state snapshot to the new subscriber.
    for (const topic of topicList) {
      this.#maybeReplayDeviceState(client, topic);
    }
  }

  /**
   * Replay the last known device-state snapshot to a newly-subscribing
   * client. If no livenessService is wired, or no snapshot exists yet, this
   * is a no-op.
   *
   * @param {{ ws: object, meta: object }} client
   * @param {string} topic
   * @private
   */
  #maybeReplayDeviceState(client, topic) {
    const parsed = parseDeviceTopic(topic);
    if (!parsed || parsed.kind !== 'device-state') return;

    const liveness = this.#livenessService;
    if (!liveness || typeof liveness.getLastSnapshot !== 'function') {
      this.#logger.debug?.('eventbus.replay.no_liveness', { topic });
      return;
    }

    const cached = liveness.getLastSnapshot(parsed.deviceId);
    if (!cached || !cached.snapshot) {
      this.#logger.debug?.('eventbus.replay.no_snapshot', { topic });
      return;
    }

    try {
      const envelope = buildDeviceStateBroadcast({
        deviceId: parsed.deviceId,
        snapshot: cached.snapshot,
        reason: 'initial',
        ts: cached.lastSeenAt,
      });
      // Envelope sets `topic: 'device-state'` (kind), but on the wire we
      // want the full topic string `device-state:<id>` so clients route it.
      const message = { ...envelope, topic, timestamp: nowTs() };

      if (client.ws?.readyState === client.ws?.OPEN) {
        client.ws.send(JSON.stringify(message));
        this.#logger.debug?.('eventbus.replay.sent', {
          topic, deviceId: parsed.deviceId,
        });
      }
    } catch (err) {
      this.#logger.warn?.('eventbus.replay.error', {
        topic, error: err?.message,
      });
    }
  }

  /**
   * Unsubscribe a client from topics
   * @param {string} clientId - Client ID
   * @param {string|string[]} topics - Topic(s) to unsubscribe from
   */
  unsubscribeClient(clientId, topics) {
    const client = this.#clients.get(clientId);
    if (!client) return;

    const topicList = Array.isArray(topics) ? topics : [topics];
    for (const topic of topicList) {
      client.meta.subscriptions.delete(topic);
    }

    this.#logger.debug?.('eventbus.client_unsubscribed', { clientId, topics: topicList });
  }

  /**
   * Clear all subscriptions for a client
   * @param {string} clientId - Client ID
   */
  clearClientSubscriptions(clientId) {
    const client = this.#clients.get(clientId);
    if (!client) return;

    client.meta.subscriptions.clear();
    this.#logger.debug?.('eventbus.client_subscriptions_cleared', { clientId });
  }

  // ===========================================================================
  // Event Handlers
  // ===========================================================================

  /**
   * Register connection handler
   * @param {Function} callback - (clientId, meta) => void
   */
  onClientConnection(callback) {
    this.#connectionHandlers.push(callback);
  }

  /**
   * Register disconnection handler
   * @param {Function} callback - (clientId) => void
   */
  onClientDisconnection(callback) {
    this.#disconnectionHandlers.push(callback);
  }

  /**
   * Register message handler
   * @param {Function} callback - (clientId, message) => void
   */
  onClientMessage(callback) {
    this.#messageHandlers.push(callback);
  }

  // ===========================================================================
  // Metrics
  // ===========================================================================

  /**
   * Get connected client count
   * @returns {number}
   */
  getClientCount() {
    return this.#clients.size;
  }

  /**
   * Get client metadata
   * @param {string} clientId - Client ID
   * @returns {ClientMeta|null}
   */
  getClientMeta(clientId) {
    const client = this.#clients.get(clientId);
    return client ? client.meta : null;
  }

  /**
   * Get internal subscriber count for a topic
   * @param {string} topic - Topic
   * @returns {number}
   */
  getSubscriberCount(topic) {
    return (this.#subscribers.get(topic) || []).length;
  }

  /**
   * Count external WS clients subscribed to a topic (or wildcard).
   * @param {string} topic - Topic to check
   * @returns {number}
   */
  getTopicSubscriberCount(topic) {
    let count = 0;
    for (const [, { ws, meta }] of this.#clients) {
      if (ws.readyState === ws.OPEN) {
        if (meta.subscriptions.has(topic) || meta.subscriptions.has('*')) {
          count++;
        }
      }
    }
    return count;
  }

  /**
   * Get all topics with internal subscribers
   * @returns {string[]}
   */
  getTopics() {
    return Array.from(this.#subscribers.keys());
  }

  /**
   * Get event bus metrics
   * @returns {Object}
   */
  getMetrics() {
    return {
      running: this.#running,
      uptime: this.#metrics.startedAt ? Date.now() - this.#metrics.startedAt : 0,
      clients: {
        current: this.#clients.size,
        connected: this.#metrics.clientsConnected,
        disconnected: this.#metrics.clientsDisconnected
      },
      messages: {
        published: this.#metrics.messagesPublished,
        broadcast: this.#metrics.messagesBroadcast
      },
      topics: this.getTopics()
    };
  }

  // ===========================================================================
  // Private Methods
  // ===========================================================================

  /**
   * Handle new WebSocket connection
   * @private
   */
  #handleConnection(ws, req) {
    const clientId = crypto.randomUUID();
    const meta = {
      id: clientId,
      ip: req?.socket?.remoteAddress,
      userAgent: req?.headers?.['user-agent'],
      subscriptions: new Set(),
      connectedAt: nowTs24()
    };

    this.#clients.set(clientId, { ws, meta });
    this.#metrics.clientsConnected++;

    this.#logger.info?.('eventbus.client_connected', { clientId, ip: meta.ip, userAgent: meta.userAgent });

    // Notify handlers
    for (const handler of this.#connectionHandlers) {
      try {
        handler(clientId, meta);
      } catch (err) {
        this.#logger.error?.('eventbus.connection_handler_error', { error: err.message });
      }
    }

    // Track pong responses for stale connection detection
    ws._wsPongReceived = true;
    ws.on('pong', () => { ws._wsPongReceived = true; });

    // Set up message handler
    ws.on('message', (rawMessage) => {
      this.#handleMessage(clientId, rawMessage);
    });

    // Set up close handler
    ws.on('close', () => {
      this.#handleDisconnection(clientId);
    });

    // Set up error handler
    ws.on('error', (err) => {
      this.#logger.error?.('eventbus.client_error', { clientId, error: err.message });
    });
  }

  /**
   * Handle incoming message from client
   * @private
   */
  #handleMessage(clientId, rawMessage) {
    let message;
    try {
      message = JSON.parse(rawMessage.toString());
    } catch (err) {
      this.#logger.warn?.('eventbus.invalid_message', { clientId, error: err.message });
      return;
    }

    // Handle built-in bus commands
    if (message.type === 'bus_command') {
      this.#handleBusCommand(clientId, message);
      return;
    }

    // Handle identity registration — clients send `{ type: 'identify', clientId }`
    // to claim a stable identity used for `client-control:<id>` routing.
    if (message.type === 'identify') {
      this.#handleIdentify(clientId, message);
      return;
    }

    // Notify message handlers
    for (const handler of this.#messageHandlers) {
      try {
        handler(clientId, message);
      } catch (err) {
        this.#logger.error?.('eventbus.message_handler_error', { error: err.message });
      }
    }
  }

  /**
   * Handle client identity registration. Records `clientId` on the client's
   * meta so `client-control:<id>` broadcasts can route to the specific
   * connection. Sends back an `identify_ack` for confirmation.
   *
   * @private
   */
  #handleIdentify(connectionId, message) {
    const identity = message?.clientId;
    if (typeof identity !== 'string' || identity.length === 0) {
      this.#logger.warn?.('eventbus.identify_invalid', { connectionId });
      return;
    }
    const client = this.#clients.get(connectionId);
    if (!client) return;

    client.meta.clientId = identity;
    this.#logger.info?.('eventbus.client_identified', {
      connectionId,
      clientId: identity,
    });

    if (client.ws.readyState === client.ws.OPEN) {
      try {
        client.ws.send(JSON.stringify({
          type: 'identify_ack',
          clientId: identity,
        }));
      } catch (err) {
        this.#logger.error?.('eventbus.identify_ack_error', {
          connectionId, error: err?.message,
        });
      }
    }
  }

  /**
   * Handle bus subscription commands
   * @private
   */
  #handleBusCommand(clientId, message) {
    const { action, topic, topics } = message;
    const targetTopics = topics || (topic ? [topic] : []);

    switch (action) {
      case 'subscribe':
        this.subscribeClient(clientId, targetTopics);
        this.#logger.info?.('eventbus.client_subscribed', { clientId, topics: targetTopics });
        break;
      case 'unsubscribe':
        this.unsubscribeClient(clientId, targetTopics);
        break;
      case 'clear_subscriptions':
        this.clearClientSubscriptions(clientId);
        break;
    }

    // Send acknowledgment
    const client = this.#clients.get(clientId);
    if (client && client.ws.readyState === client.ws.OPEN) {
      client.ws.send(JSON.stringify({
        type: 'bus_ack',
        action,
        currentSubscriptions: Array.from(client.meta.subscriptions)
      }));
    }
  }

  /**
   * Handle client disconnection
   * @private
   */
  #handleDisconnection(clientId) {
    this.#clients.delete(clientId);
    this.#metrics.clientsDisconnected++;

    this.#logger.info?.('eventbus.client_disconnected', { clientId });

    // Notify handlers
    for (const handler of this.#disconnectionHandlers) {
      try {
        handler(clientId);
      } catch (err) {
        this.#logger.error?.('eventbus.disconnection_handler_error', { error: err.message });
      }
    }
  }

  // ===========================================================================
  // One-Shot Message Waiting
  // ===========================================================================

  /**
   * Wait for a single incoming client message matching a predicate.
   * Returns a promise that resolves with the message or rejects on timeout.
   *
   * @param {Function} predicate - (message) => boolean
   * @param {number} timeoutMs - Timeout in milliseconds
   * @returns {Promise<Object>} The matching message
   */
  waitForMessage(predicate, timeoutMs) {
    return new Promise((resolve, reject) => {
      let timer;
      const handler = (_clientId, message) => {
        try {
          if (!predicate(message)) return;
        } catch {
          return; // predicate threw — skip this message
        }
        clearTimeout(timer);
        this.#removeMessageHandler(handler);
        resolve(message);
      };

      this.#messageHandlers.push(handler);

      timer = setTimeout(() => {
        this.#removeMessageHandler(handler);
        reject(new Error(`waitForMessage timed out after ${timeoutMs}ms`));
      }, timeoutMs);
    });
  }

  /**
   * Remove a specific message handler.
   * @private
   */
  #removeMessageHandler(handler) {
    const idx = this.#messageHandlers.indexOf(handler);
    if (idx !== -1) this.#messageHandlers.splice(idx, 1);
  }

  /**
   * Inject a client message for testing. Only available in non-production.
   * @param {string} clientId
   * @param {Object} message
   */
  _testInjectClientMessage(clientId, message) {
    for (const handler of this.#messageHandlers) {
      try {
        handler(clientId, message);
      } catch (err) {
        this.#logger.error?.('eventbus.test_inject_error', { error: err.message });
      }
    }
  }

  /**
   * Test seam: route a raw incoming message through the full message handler
   * pipeline (including `bus_command` and `identify` handling). Unlike
   * `_testInjectClientMessage`, this exercises internal handlers too.
   * @param {string} clientId
   * @param {Object} message
   */
  _testHandleIncomingMessage(clientId, message) {
    const raw = typeof message === 'string' ? message : JSON.stringify(message);
    this.#handleMessage(clientId, raw);
  }

  /**
   * Get message handler count (for testing cleanup verification).
   * @returns {number}
   */
  get _messageHandlerCount() {
    return this.#messageHandlers.length;
  }

  // ===========================================================================
  // Direct Client Messaging
  // ===========================================================================

  /**
   * Send message to a specific client
   * @param {string} clientId - Client ID
   * @param {Object} message - Message to send
   * @returns {boolean} - Whether message was sent
   */
  sendToClient(clientId, message) {
    const client = this.#clients.get(clientId);
    if (!client || client.ws.readyState !== client.ws.OPEN) {
      return false;
    }

    const msg = typeof message === 'string' ? message : JSON.stringify(message);
    client.ws.send(msg);
    return true;
  }
}

export default WebSocketEventBus;
