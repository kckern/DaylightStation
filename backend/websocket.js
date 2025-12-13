
// WebSocket server

import { WebSocketServer } from 'ws';
import winston from 'winston';
import { Loggly } from 'winston-loggly-bulk';
import { createLogger, winstonTransportAdapter } from './lib/logging/index.js';
import { getLogglyConfig } from './lib/logging/logglyConfig.js';
import { loadLoggingConfig, resolveLoggerLevel } from './lib/logging/config.js';

const LOGGLY_TAGS = ['backend', 'websocket'];
let loggingConfig = loadLoggingConfig();

let backendLogger = null;
let backendRootLoggerInstance = null;

function getBackendRootLogger() {
  if (backendRootLoggerInstance) return backendRootLoggerInstance;
  backendRootLoggerInstance = backendRootLogger();
  return backendRootLoggerInstance;
}

const backendRootLogger = () =>
  createLogger({
    name: 'DaylightBackend',
    context: { app: 'websocket' },
    level: resolveLoggerLevel('websocket', loggingConfig),
    transports: [winstonTransportAdapter(getLogger())]
  });

function getLogger() {
  if (backendLogger) return backendLogger;

  const { token: LOGGLY_TOKEN, subdomain: LOGGLY_SUBDOMAIN } = getLogglyConfig({ tags: LOGGLY_TAGS });
  // Avoid recursion: log initialization via console to prevent calling Daylight logger before it exists
  const initLine = `[WebSocket] Logger init ${JSON.stringify({
    hasToken: !!LOGGLY_TOKEN,
    subdomain: LOGGLY_SUBDOMAIN,
    tokenPrefix: LOGGLY_TOKEN ? `${LOGGLY_TOKEN.substring(0, 4)}...` : 'N/A'
  })}\n`;
  process.stdout.write(initLine);

  // Filter to exclude playback-logger events from the console
  const ignorePlayback = winston.format((info) => {
    if (info.source === 'playback-logger') return false;
    return info;
  });

  // Reorder keys to put message first (after timestamp/level)
  const reorderFormat = winston.format((info) => {
      const { timestamp, level, message, ...rest } = info;
      return { timestamp, level, message, ...rest };
  });

  const winstonTransportList = [
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.simple()
      )
    })
  ];

  if (LOGGLY_TOKEN && LOGGLY_SUBDOMAIN) {
    winstonTransportList.push(new Loggly({
      token: LOGGLY_TOKEN,
      subdomain: LOGGLY_SUBDOMAIN,
      tags: LOGGLY_TAGS,
      json: true,
      bufferOptions: { size: 1, retriesInMilliSeconds: 60 * 1000 }
    }));
  }

  backendLogger = winston.createLogger({
    level: resolveLoggerLevel('websocket', loggingConfig) || process.env.WEBSOCKET_LOG_LEVEL || 'info',
    format: winston.format.combine(
        winston.format.timestamp(),
        reorderFormat(),
        winston.format.json() 
    ),
    transports: winstonTransportList
  });
  
  return backendLogger;
}

const logger = {
  info: (message, meta = {}) => getLogger().info(message, meta),
  warn: (message, meta = {}) => getLogger().warn(message, meta),
  error: (message, meta = {}) => getLogger().error(message, meta)
};

let wssNav = null;
let httpServer = null;

export function createWebsocketServer(server) {
  logger.info('Creating WebSocket servers...');
  httpServer = server; // Store reference to HTTP server
  
  // /ws: WebSocket messages
  if (!wssNav) {
    logger.info('Creating WebSocket server for /ws...');
    wssNav = new WebSocketServer({ server, path: '/ws' });
    logger.info('WebSocket server created, adding listeners...');
    wssNav.on('connection', (ws, req) => {
      ws._clientMeta = {
        ip: req?.socket?.remoteAddress,
        userAgent: req?.headers?.['user-agent']
      };

      logger.info('WebSocket connection established', { ip: ws._clientMeta.ip });
      
      // Handle incoming messages from fitness controller
      ws.on('message', (message) => {
        const rawMessage = message.toString();
        try {
          const data = JSON.parse(rawMessage);
          const ingestLogger = getBackendRootLogger().child({ module: 'ws-ingest' });
          
          // Check if message is from fitness controller
          if (data.source === 'fitness' || data.source === 'fitness-simulator') {
            // Broadcast to all connected UI clients with fitness topic
            broadcastToWebsockets({
              topic: 'fitness',
              ...data
            });
            logger.info('Broadcasted fitness payload', { topic: 'fitness', source: data.source });
          } else if (data.source === 'playback-logger') {
            // Log playback events to backend logger (which forwards to Loggly)
            const { level, event, payload, context } = data;
            
            // Construct a cleaner meta object
            // We want 'message' to be the main thing, which is passed as the first arg to logger.info
            // We want to avoid polluting the root with all payload fields.
            
            const meta = {
              event,
              source: data.source,
              context: context || {},
              data: payload // Nested!
            };
            
            // Map frontend log levels to backend logger methods
            if (level === 'error') {
              logger.error(`[Frontend] ${event}`, meta);
            } else if (level === 'warn') {
              logger.warn(`[Frontend] ${event}`, meta);
            } else {
              logger.info(`[Frontend] ${event}`, meta);
            }
          } else if (data.topic === 'logging') {
            // DEBUG: Print received logging payload
            console.log('[WebSocket] Received logging payload:', JSON.stringify(data).substring(0, 200));

            const events = Array.isArray(data.events)
              ? data.events
              : data.event
                ? [data.event]
                : [data];

            events.forEach((evt) => {
              // Some clients wrap the actual log event inside an `event` property; unwrap it when present
              const nestedEvent = evt && typeof evt.event === 'object' && !Array.isArray(evt.event) ? evt.event : null;
              const base = nestedEvent ? { ...evt, ...nestedEvent } : evt || {};
              const eventName = typeof base.event === 'string' && base.event.length
                ? base.event
                : nestedEvent && typeof nestedEvent.event === 'string'
                  ? nestedEvent.event
                  : 'logging.event';

              const normalized = {
                ts: base.ts || new Date().toISOString(),
                level: base.level || 'info',
                event: eventName,
                message: base.message,
                data: base.data || base.payload || {},
                tags: base.tags || [],
                source: base.source || 'frontend',
                context: {
                  ...(base.context || {}),
                  ip: ws._clientMeta?.ip,
                  userAgent: ws._clientMeta?.userAgent
                }
              };

              ingestLogger.log(normalized.level, normalized.event, normalized.data, {
                message: normalized.message,
                tags: normalized.tags,
                context: normalized.context,
                source: normalized.source
              });
            });
          } else {
             logger.warn('Received unknown WebSocket message source', { source: data.source, data });
          }
        } catch (error) {
          logger.warn('Failed to parse WebSocket message', { error: error.message, raw: rawMessage });
        }
      });
      
      ws.on('close', () => {
        // Connection closed
        logger.info('WebSocket connection closed');
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

export function broadcastToWebsockets(data) {
  if (!wssNav) return;
  
  const msg = typeof data === 'string' ? data : JSON.stringify(data);
  
  wssNav.clients.forEach((client) => {
    if (client.readyState === client.OPEN) {
      client.send(msg);
    }
  });
}