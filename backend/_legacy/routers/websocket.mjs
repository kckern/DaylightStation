/**
 * WebSocket Server - Bridge to new EventBus infrastructure
 *
 * This module provides backward-compatible exports while delegating
 * to the new WebSocketEventBus in 0_system/eventbus.
 *
 * Exports:
 *   createWebsocketServer(server) - Initialize WebSocket server
 *   broadcastToWebsockets(data) - Broadcast to all subscribed clients
 *   restartWebsocketServer() - Restart the WebSocket server
 *
 * @module routers/websocket
 */

import { createEventBus, getEventBus, broadcastEvent, restartEventBus } from '../../src/0_system/bootstrap.mjs';
import { createLogger } from '../lib/logging/logger.js';
import { ingestFrontendLogs } from '../lib/logging/ingestion.js';

const logger = createLogger({ source: 'websocket', app: 'api' });

/**
 * Create and initialize the WebSocket server
 * Delegates to the new EventBus infrastructure
 * @param {Object} server - HTTP server instance
 * @returns {Object} - Object with eventBus reference
 */
export async function createWebsocketServer(server) {
  // Check if already initialized
  let eventBus = getEventBus();
  const wasAlreadyInitialized = !!eventBus;

  if (!eventBus) {
    // Create new EventBus if it doesn't exist
    eventBus = await createEventBus({
      httpServer: server,
      path: '/ws',
      logger
    });
    logger.info('websocket.server.started', { path: '/ws' });
  } else {
    logger.info('websocket.using_existing_eventbus');
  }

  // Always register message handlers (new backend may not have registered all of them)
  // Note: This means handlers may be registered twice, but that's safe
  // and ensures backward compatibility features like log ingestion work
  eventBus.onClientMessage((clientId, message) => {
    handleIncomingMessage(clientId, message, eventBus);
  });

  if (wasAlreadyInitialized) {
    logger.info('websocket.handlers_registered', { message: 'Registered legacy message handlers on existing EventBus' });
  }

  return { eventBus };
}

/**
 * Handle incoming messages from clients
 * Routes messages based on source/topic for backward compatibility
 * @private
 */
function handleIncomingMessage(clientId, message, eventBus) {
  // Fitness controller messages
  if (message.source === 'fitness' || message.source === 'fitness-simulator') {
    eventBus.broadcast('fitness', message);
    logger.info('websocket.fitness.broadcast', { source: message.source });
    return;
  }

  // Piano MIDI messages
  if (message.source === 'piano' && message.topic === 'midi') {
    if (!message.type || !message.timestamp) {
      logger.warn('websocket.midi.invalid', { clientId });
      return;
    }
    eventBus.broadcast('midi', {
      source: message.source,
      type: message.type,
      timestamp: message.timestamp,
      sessionId: message.sessionId,
      data: message.data
    });
    if (message.type === 'session') {
      logger.info('websocket.midi.session', { event: message.data?.event, sessionId: message.sessionId });
    }
    return;
  }

  // Frontend logging messages
  if (message.source === 'playback-logger' || message.topic === 'logging') {
    const clientMeta = eventBus.getClientMeta(clientId);
    ingestFrontendLogs(message, {
      ip: clientMeta?.ip,
      userAgent: clientMeta?.userAgent
    });
    return;
  }

  // Unknown source - log warning
  logger.warn('websocket.unknown_source', { source: message.source, clientId });
}

/**
 * Broadcast data to all subscribed WebSocket clients
 * Backward-compatible wrapper for the new EventBus
 * @param {Object} data - Data to broadcast (should include topic)
 */
export function broadcastToWebsockets(data) {
  const eventBus = getEventBus();
  if (!eventBus) {
    logger.warn('websocket.broadcast.not_initialized');
    return;
  }

  const topic = data.topic || 'legacy';
  eventBus.broadcast(topic, data);
}

/**
 * Restart the WebSocket server
 * @returns {boolean} - Whether restart succeeded
 */
export function restartWebsocketServer() {
  const eventBus = getEventBus();
  if (!eventBus) {
    logger.error('websocket.restart.not_initialized');
    return false;
  }

  restartEventBus();
  logger.info('websocket.restarted');
  return true;
}

// Re-export for convenience
export { getEventBus, broadcastEvent };