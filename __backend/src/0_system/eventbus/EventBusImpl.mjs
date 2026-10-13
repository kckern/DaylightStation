/**
 * EventBusImpl - In-memory event bus implementation
 */

export class EventBusImpl {
  constructor() {
    this.subscribers = new Map();
    this.adapters = [];
  }

  /**
   * Add a transport adapter (WebSocket, MQTT, etc.)
   */
  addAdapter(adapter) {
    this.adapters.push(adapter);
  }

  /**
   * Publish an event
   */
  publish(topic, payload) {
    // Notify local subscribers
    const handlers = this.subscribers.get(topic) || [];
    for (const handler of handlers) {
      try {
        handler(payload, topic);
      } catch (err) {
        console.error(`EventBus handler error for ${topic}:`, err);
      }
    }

    // Notify adapters for external broadcast
    for (const adapter of this.adapters) {
      try {
        adapter.broadcast(topic, payload);
      } catch (err) {
        console.error(`EventBus adapter error:`, err);
      }
    }
  }

  /**
   * Subscribe to a topic
   */
  subscribe(topic, handler) {
    if (!this.subscribers.has(topic)) {
      this.subscribers.set(topic, []);
    }
    this.subscribers.get(topic).push(handler);

    // Return unsubscribe function
    return () => this.unsubscribe(topic, handler);
  }

  /**
   * Unsubscribe from a topic
   */
  unsubscribe(topic, handler) {
    const handlers = this.subscribers.get(topic);
    if (handlers) {
      const index = handlers.indexOf(handler);
      if (index !== -1) {
        handlers.splice(index, 1);
      }
    }
  }

  /**
   * Get subscriber count for a topic
   */
  getSubscriberCount(topic) {
    return (this.subscribers.get(topic) || []).length;
  }

  /**
   * Get all topics with subscribers
   */
  getTopics() {
    return Array.from(this.subscribers.keys());
  }
}

export default EventBusImpl;
