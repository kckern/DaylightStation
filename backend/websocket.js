
// WebSocket server

import { WebSocketServer } from 'ws';
import winston from 'winston';
import { Loggly } from 'winston-loggly-bulk';

const LOGGLY_TOKEN = process.env.LOGGLY_TOKEN || process.env.LOGGLY_INPUT_TOKEN || null;
const LOGGLY_SUBDOMAIN = process.env.LOGGLY_SUBDOMAIN || null;
const LOGGLY_TAGS = ['backend', 'websocket'];

const winstonTransportList = [
  new winston.transports.Console({
    format: winston.format.combine(
      winston.format.timestamp(),
      winston.format.printf(({ level, message, timestamp, ...meta }) => {
        const serializedMeta = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : '';
        return `${timestamp} [WebSocket] ${level}: ${message}${serializedMeta}`;
      })
    )
  })
];

if (LOGGLY_TOKEN && LOGGLY_SUBDOMAIN) {
  winstonTransportList.push(new Loggly({
    token: LOGGLY_TOKEN,
    subdomain: LOGGLY_SUBDOMAIN,
    tags: LOGGLY_TAGS,
    json: true
  }));
}

const backendLogger = winston.createLogger({
  level: process.env.WEBSOCKET_LOG_LEVEL || 'info',
  transports: winstonTransportList
});

const logger = {
  info: (message, meta = {}) => backendLogger.info(message, meta),
  warn: (message, meta = {}) => backendLogger.warn(message, meta),
  error: (message, meta = {}) => backendLogger.error(message, meta)
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
    wssNav.on('connection', (ws) => {
      
      // Handle incoming messages from fitness controller
      ws.on('message', (message) => {
        try {
          const data = JSON.parse(message.toString());
          
          // Check if message is from fitness controller
          if (data.source === 'fitness' || data.source === 'fitness-simulator') {
            // Broadcast to all connected UI clients with fitness topic
            broadcastToWebsockets({
              topic: 'fitness',
              ...data
            });
            logger.info('Broadcasted fitness payload', { topic: 'fitness', source: data.source });
          }
        } catch (error) {
          // Ignore non-JSON messages or parsing errors
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