
// WebSocket server

import { WebSocketServer } from 'ws';

let wssNav = null;

export function createWebsocketServer(server) {
  console.log('Creating WebSocket servers...');
  
  // /ws: WebSocket messages
  if (!wssNav) {
    console.log('Creating WebSocket server for /ws...');
    wssNav = new WebSocketServer({ server, path: '/ws' });
    console.log('WebSocket server created, adding listeners...');
    wssNav.on('connection', (ws) => {
    //  console.log('WebSocket connection established on /ws');
      ws.on('close', () => {
      //  console.log('WebSocket connection closed on /ws');
      });
    });
    wssNav.on('error', (err) => {
      console.error('WebSocket server error on /ws:', err);
    });
    console.log('WebSocketServer for /ws is online');
  } else {
    console.log('WebSocket server for /ws already exists');
  }
  return { wssNav };
}

export function broadcastToWebsockets(data) {
  console.log({ broadcastToWebsockets: data });
  if (!wssNav) return console.warn('No WebSocket server for messages');
  
  const msg = typeof data === 'string' ? data : JSON.stringify(data);
  console.debug('Client Count:', wssNav.clients.size);
  
  wssNav.clients.forEach((client) => {
    if (client.readyState === client.OPEN) {
      client.send(msg);
      console.debug('[WebSocket] Message sent:', msg);
    } else {
      console.warn('[WebSocket] Client not open, skipping send:', client.readyState);
    }
  });
}