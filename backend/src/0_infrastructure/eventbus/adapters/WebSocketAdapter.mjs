/**
 * WebSocket Adapter for EventBus
 *
 * Broadcasts EventBus events to connected WebSocket clients.
 * Wraps the WebSocket server's broadcast functionality.
 */

export class WebSocketAdapter {
  constructor(options = {}) {
    this.name = 'websocket';
    this.broadcastFn = options.broadcastFn || null;
    this.wss = options.wss || null;
    this.logger = options.logger || console;
  }

  /**
   * Set the broadcast function (called after WebSocket server is initialized)
   * @param {Function} fn - Function that accepts (data) and broadcasts to clients
   */
  setBroadcastFunction(fn) {
    this.broadcastFn = fn;
  }

  /**
   * Set the WebSocket server instance
   * @param {WebSocketServer} wss
   */
  setWebSocketServer(wss) {
    this.wss = wss;
  }

  /**
   * Broadcast an event to WebSocket clients
   * @param {string} topic - Event topic
   * @param {Object} payload - Event payload
   */
  broadcast(topic, payload) {
    if (!this.broadcastFn && !this.wss) {
      this.logger.warn?.('websocket-adapter.no_server', { topic });
      return;
    }

    const message = {
      topic,
      timestamp: new Date().toISOString(),
      ...payload
    };

    if (this.broadcastFn) {
      this.broadcastFn(message);
    } else if (this.wss) {
      this._broadcastToClients(message);
    }
  }

  /**
   * Internal broadcast to WebSocket clients
   * @private
   */
  _broadcastToClients(message) {
    if (!this.wss) return;

    const msg = JSON.stringify(message);
    const topic = message.topic || 'default';
    let sentCount = 0;

    this.wss.clients.forEach((client) => {
      if (client.readyState === 1) { // WebSocket.OPEN = 1
        const subs = client._busMeta?.subscriptions;

        // Send if client subscribes to this topic or has wildcard
        if (!subs || subs.has(topic) || subs.has('*')) {
          client.send(msg);
          sentCount++;
        }
      }
    });

    this.logger.debug?.('websocket-adapter.broadcast', {
      topic,
      sentCount,
      clientCount: this.wss.clients.size
    });
  }

  /**
   * Get connected client count
   */
  getClientCount() {
    return this.wss?.clients?.size || 0;
  }
}

export default WebSocketAdapter;
