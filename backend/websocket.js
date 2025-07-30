
// WebSocket server

import { WebSocketServer } from 'ws';

let wssNav = null;

export function createWebsocketServer(server) {
  console.log('Creating WebSocket servers...');
  
  // /ws/nav: navigation messages
  if (!wssNav) {
    console.log('Creating WebSocket server for /ws/nav...');
    wssNav = new WebSocketServer({ server, path: '/ws/nav' });
    console.log('WebSocket server created, adding listeners...');
    wssNav.on('connection', (ws) => {
      console.log('WebSocket connection established on /ws/nav');
      ws.on('close', () => {
        console.log('WebSocket connection closed on /ws/nav');
      });
    });
    wssNav.on('error', (err) => {
      console.error('WebSocket server error on /ws/nav:', err);
    });
    console.log('WebSocketServer for /ws/nav is online');
  } else {
    console.log('WebSocket server for /ws/nav already exists');
  }
  return { wssNav };
}

export function broadcastToWebsockets(data) {
  console.log({ broadcastToWebsockets: data });
  if (!wssNav) return console.warn('No WebSocket server for navigation messages');
  
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