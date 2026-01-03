
// WebSocket server

import { WebSocketServer } from 'ws';
import crypto from 'crypto';
import { createLogger } from '../lib/logging/logger.js';
import { serializeError } from '../lib/logging/utils.js';
import { ingestFrontendLogs } from '../lib/logging/ingestion.js';
import { isLoggingInitialized } from '../lib/logging/dispatcher.js';

// Logger for websocket module itself (not for frontend events)
const logger = createLogger({ source: 'websocket', app: 'api' });

let wssNav = null;
let httpServer = null;

export function createWebsocketServer(server) {
  httpServer = server; // Store reference to HTTP server
  
  // /ws: WebSocket messages
  if (!wssNav) {
    wssNav = new WebSocketServer({ server, path: '/ws' });
    logger.info('websocket.server.started', { path: '/ws' });
    wssNav.on('connection', (ws, req) => {
      ws._clientMeta = {
        ip: req?.socket?.remoteAddress,
        userAgent: req?.headers?.['user-agent']
      };
      
      ws._busMeta = {
        subscriptions: new Set(), // Default: No subscriptions (must opt-in) Phase 1
        id: crypto.randomUUID()
      };

      //logger.info('WebSocket connection established', { ip: ws._clientMeta.ip });
      
      // Handle incoming messages from fitness controller
      ws.on('message', (message) => {
        const rawMessage = message.toString();
        try {
          const data = JSON.parse(rawMessage);
          
          // Handle Bus Commands (subscribe/unsubscribe)
          if (data.type === 'bus_command') {
            handleBusCommand(ws, data);
            return;
          }

          // Check if message is from fitness controller
          if (data.source === 'fitness' || data.source === 'fitness-simulator') {
            // Broadcast to all connected UI clients with fitness topic
            broadcastToWebsockets({
              topic: 'fitness',
              ...data
            });
            logger.info('Broadcasted fitness payload', { topic: 'fitness', source: data.source });
          } else if (data.source === 'playback-logger' || data.topic === 'logging') {
            // All frontend logging events go through ingestion service
            const clientMeta = {
              ip: ws._clientMeta?.ip,
              userAgent: ws._clientMeta?.userAgent
            };
            ingestFrontendLogs(data, clientMeta);
          } else {
             logger.warn('Received unknown WebSocket message source', { source: data.source, data });
          }
        } catch (error) {
          logger.warn('Failed to parse WebSocket message', { error: serializeError(error), raw: rawMessage });
        }
      });
      
      ws.on('close', () => {
        // Connection closed
      //  logger.info('WebSocket connection closed');
      });
    });
    wssNav.on('error', (err) => {
      logger.error('WebSocket server error on /ws', err);
    });
    logger.info('WebSocketServer for /ws is online');
  } else {
    logger.warn('WebSocket server for /ws already exists');
  }
  return { wssNav };
}

export function restartWebsocketServer() {
  logger.info('Restarting WebSocket server...');
  
  if (wssNav) {
    logger.info('Closing existing WebSocket server...');
    // Close all existing connections
    wssNav.clients.forEach((client) => {
      client.close();
    });
    wssNav.close();
    wssNav = null;
  }
  
  if (httpServer) {
    // Recreate WebSocket server
    createWebsocketServer(httpServer);
    logger.info('WebSocket server restarted successfully');
    return true;
  } else {
    logger.error('No HTTP server reference available for restart');
    return false;
  }
}

/**
 * Handles subscription commands from clients
 */
function handleBusCommand(ws, data) {
  const { action, topic, topics } = data;
  const targetTopics = topics || (topic ? [topic] : []);
  
  if (!ws._busMeta) {
    ws._busMeta = { subscriptions: new Set(['*']) };
  }

  if (action === 'subscribe') {
    targetTopics.forEach(t => ws._busMeta.subscriptions.add(t));
    logger.info('Client subscribed to topics', { id: ws._busMeta.id, topics: targetTopics });
  } else if (action === 'unsubscribe') {
    targetTopics.forEach(t => ws._busMeta.subscriptions.delete(t));
    logger.info('Client unsubscribed from topics', { id: ws._busMeta.id, topics: targetTopics });
  } else if (action === 'clear_subscriptions') {
    ws._busMeta.subscriptions.clear();
    logger.info('Client cleared all subscriptions', { id: ws._busMeta.id });
  }
  
  // Acknowledge the command
  ws.send(JSON.stringify({
    type: 'bus_ack',
    action,
    currentSubscriptions: Array.from(ws._busMeta.subscriptions)
  }));
}

export function broadcastToWebsockets(data) {
  if (!wssNav) {
    logger.warn('websocket.broadcast.server_not_initialized');
    return;
  }
  
  const msg = typeof data === 'string' ? data : JSON.stringify(data);
  const clientCount = wssNav.clients.size;
  let sentCount = 0;
  
  const topic = data.topic || 'legacy';
  
  wssNav.clients.forEach((client) => {
    if (client.readyState === client.OPEN) {
      const subs = client._busMeta?.subscriptions;
      
      // Routing decision:
      // 1. Client has explicit subscription to the topic
      // 2. Client has wildcard '*' subscription
      // 3. (Backward compatibility) Message has no topic and client has '*'
      if (subs && (subs.has(topic) || subs.has('*'))) {
        client.send(msg);
        sentCount++;
      }
    }
  });
  
  logger.info('websocket.broadcast.sent', { 
    sentCount, 
    clientCount, 
    topic: data.topic, 
    action: data.action,
    summary: data.topic ? null : msg.substring(0, 100)
  });
}