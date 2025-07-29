
  // WebSocket server

import { WebSocketServer } from 'ws';
import { v4 as uuidv4 } from 'uuid';


let wssPing = null;
let wssNav = null;

export function createWebsocketServer(server) {
  console.log('Creating WebSocket servers...');
  
  // /ws/ping: dial tone only - TEMPORARILY DISABLED
  // if (!wssPing) {
  //   wssPing = new WebSocketServer({ server, path: '/ws/ping' });
  //   wssPing.on('connection', (ws) => {
  //     console.log('WebSocket connection established on /ws/ping');
  //     let interval = setInterval(() => {
  //       if (ws.readyState === ws.OPEN) {
  //         ws.send(JSON.stringify({ timestamp: new Date().toISOString(), guid: uuidv4() }));
  //       }
  //     }, 1000);
  //     ws.on('close', () => {
  //       console.log('WebSocket connection closed');
  //       clearInterval(interval);
  //     });
  //   });
  //   console.log('WebSocketServer for /ws/ping is online');
  // }

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
  return { wssPing, wssNav };
}

export function broadcastToWebsockets(data) {
  console.log({broadcastToWebsockets:data})
  if (!wssNav) return console.warn('No WebSocket server for navigation messages');
  const msg = typeof data === 'string' ? data : JSON.stringify(data);
  console.debug('Client Count: ', wssNav.clients.size);
  wssNav.clients.forEach((client) => {
    if (client.readyState === client.OPEN) {
      client.send(msg);
      //on success, you can log or handle the message
      console.debug('[WebSocket] Message sent:', msg);
    }else{

      console.warn('[WebSocket] Client not open, skipping send:', client.readyState);
    }
  });
}