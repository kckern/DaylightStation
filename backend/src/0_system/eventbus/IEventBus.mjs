/**
 * IEventBus - Event Bus Port Interface
 *
 * Defines the contract for event bus implementations.
 * Supports both internal pub/sub and external client connections (WebSocket, MQTT).
 *
 * @module infrastructure/eventbus
 */

/**
 * Client metadata
 * @typedef {Object} ClientMeta
 * @property {string} id - Unique client identifier
 * @property {string} [ip] - Client IP address
 * @property {string} [userAgent] - Client user agent
 * @property {Set<string>} subscriptions - Topics client is subscribed to
 */

/**
 * Check if an object implements IEventBus
 * @param {Object} obj
 * @returns {boolean}
 */
export function isEventBus(obj) {
  return (
    obj &&
    typeof obj.publish === 'function' &&
    typeof obj.subscribe === 'function' &&
    typeof obj.broadcast === 'function'
  );
}

/**
 * IEventBus interface definition
 *
 * Core methods:
 *
 * publish(topic: string, payload: object): void
 *   Publish event to internal subscribers (in-process handlers).
 *
 * subscribe(topic: string, handler: Function): Function
 *   Subscribe to internal events. Returns unsubscribe function.
 *
 * unsubscribe(topic: string, handler: Function): void
 *   Unsubscribe from internal events.
 *
 * broadcast(topic: string, payload: object): void
 *   Broadcast to external clients (WebSocket, MQTT, etc.).
 *   Also publishes internally.
 *
 * Client management (for server-side implementations):
 *
 * subscribeClient(clientId: string, topics: string[]): void
 *   Subscribe an external client to topics.
 *
 * unsubscribeClient(clientId: string, topics: string[]): void
 *   Unsubscribe an external client from topics.
 *
 * clearClientSubscriptions(clientId: string): void
 *   Remove all subscriptions for a client.
 *
 * Event handlers:
 *
 * onClientConnection(callback: (clientId, meta) => void): void
 *   Register handler for new client connections.
 *
 * onClientDisconnection(callback: (clientId) => void): void
 *   Register handler for client disconnections.
 *
 * onClientMessage(callback: (clientId, message) => void): void
 *   Register handler for incoming messages from clients.
 *
 * Metrics:
 *
 * getClientCount(): number
 * getClientMeta(clientId: string): ClientMeta | null
 * getSubscriberCount(topic: string): number
 * getTopics(): string[]
 *
 * Lifecycle:
 *
 * start(server?: object): Promise<void>
 * stop(): Promise<void>
 * isRunning(): boolean
 */

export const IEventBus = {
  // Core pub/sub
  publish(topic, payload) {},
  subscribe(topic, handler) {},
  unsubscribe(topic, handler) {},
  broadcast(topic, payload) {},

  // Client management
  subscribeClient(clientId, topics) {},
  unsubscribeClient(clientId, topics) {},
  clearClientSubscriptions(clientId) {},

  // Event handlers
  onClientConnection(callback) {},
  onClientDisconnection(callback) {},
  onClientMessage(callback) {},

  // Metrics
  getClientCount() {},
  getClientMeta(clientId) {},
  getSubscriberCount(topic) {},
  getTopics() {},

  // Lifecycle
  async start(server) {},
  async stop() {},
  isRunning() {}
};

export default { IEventBus, isEventBus };
