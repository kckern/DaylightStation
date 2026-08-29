/**
 * EventBus Infrastructure
 *
 * Provides pub/sub messaging for internal handlers and external clients.
 *
 * Usage:
 *   import { WebSocketEventBus } from '#adapters/eventbus/WebSocketEventBus.mjs';
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

// Legacy compatibility
export { EventBusImpl } from './EventBusImpl.mjs';

// Default export for convenience
export { EventBusImpl as default } from './EventBusImpl.mjs';
