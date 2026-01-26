/**
 * EventBus Infrastructure
 *
 * Provides pub/sub messaging for internal handlers and external clients.
 *
 * Usage:
 *   import { WebSocketEventBus } from './0_system/eventbus/index.mjs';
 *
 *   const eventBus = new WebSocketEventBus({ logger });
 *   await eventBus.start(httpServer);
 *
 *   // Broadcast to external clients
 *   eventBus.broadcast('fitness', { heartRate: 120 });
 *
 *   // Subscribe to internal events
 *   eventBus.subscribe('fitness', (payload) => console.log(payload));
 *
 * @module infrastructure/eventbus
 */

// Main exports
export { IEventBus, isEventBus } from './IEventBus.mjs';
export { WebSocketEventBus } from './WebSocketEventBus.mjs';

// Legacy compatibility
export { EventBusImpl } from './EventBusImpl.mjs';
export { WebSocketAdapter, MqttAdapter } from './adapters/index.mjs';

// Default export for convenience
import { WebSocketEventBus } from './WebSocketEventBus.mjs';
export default WebSocketEventBus;
