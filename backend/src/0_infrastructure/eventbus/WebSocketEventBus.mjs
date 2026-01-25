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

/**
 * @typedef {import('./IEventBus.mjs').ClientMeta} ClientMeta
 */

export class WebSocketEventBus {
  #wss = null;
  #httpServer = null;
  #path;
  #logger;
  #running = false;

  // Internal pub/sub
  #subscribers = new Map(); // topic -> handler[]

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

  /**
   * @param {Object} [options]
   * @param {string} [options.path='/ws'] - WebSocket path
   * @param {Object} [options.logger] - Logger instance
   */
  constructor(options = {}) {
    this.#path = options.path || '/ws';
    this.#logger = options.logger || console;
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
  }

  /**
   * Stop the WebSocket server
   */
  async stop() {
    if (!this.#running) return;

    this.#logger.info?.('eventbus.stopping');

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
   * Broadcast event to external clients and publish internally
   * @param {string} topic - Event topic
   * @param {Object} payload - Event payload
   */
  broadcast(topic, payload) {
    // Publish internally first
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

    let sentCount = 0;
    for (const [clientId, { ws, meta }] of this.#clients) {
      if (ws.readyState === ws.OPEN) {
        const subs = meta.subscriptions;

        // Send if client subscribes to topic or has wildcard
        if (subs.has(topic) || subs.has('*')) {
          ws.send(msg);
          sentCount++;
        }
      }
    }

    this.#logger.debug?.('eventbus.broadcast', {
      topic,
      sentCount,
      clientCount: this.#clients.size
    });
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

    this.#logger.debug?.('eventbus.client_connected', { clientId, ip: meta.ip });

    // Notify handlers
    for (const handler of this.#connectionHandlers) {
      try {
        handler(clientId, meta);
      } catch (err) {
        this.#logger.error?.('eventbus.connection_handler_error', { error: err.message });
      }
    }

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
   * Handle bus subscription commands
   * @private
   */
  #handleBusCommand(clientId, message) {
    const { action, topic, topics } = message;
    const targetTopics = topics || (topic ? [topic] : []);

    switch (action) {
      case 'subscribe':
        this.subscribeClient(clientId, targetTopics);
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

    this.#logger.debug?.('eventbus.client_disconnected', { clientId });

    // Notify handlers
    for (const handler of this.#disconnectionHandlers) {
      try {
        handler(clientId);
      } catch (err) {
        this.#logger.error?.('eventbus.disconnection_handler_error', { error: err.message });
      }
    }
  }

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
