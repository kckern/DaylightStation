
// WebSocket server

import { WebSocketServer } from 'ws';

let wssNav = null;
let httpServer = null;

export function createWebsocketServer(server) {
  console.log('Creating WebSocket servers...');
  httpServer = server; // Store reference to HTTP server
  
  // /ws: WebSocket messages
  if (!wssNav) {
    console.log('Creating WebSocket server for /ws...');
    wssNav = new WebSocketServer({ server, path: '/ws' });
    console.log('WebSocket server created, adding listeners...');
    wssNav.on('connection', (ws) => {
    //  console.log('WebSocket connection established on /ws');
      
      // Handle incoming messages from fitness controller
      ws.on('message', (message) => {
        try {
          const data = JSON.parse(message.toString());
          
          // Check if message is from fitness controller
          if (data.source === 'fitness') {
        //    console.log('📊 Received fitness data:', data);
            
            // Broadcast to all connected UI clients with fitness topic
            broadcastToWebsockets({
              topic: 'fitness',
              ...data
            });
          }
        } catch (error) {
          // Ignore non-JSON messages or parsing errors
          console.debug('Non-JSON WebSocket message received');
        }
      });
      
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

export function restartWebsocketServer() {
  console.log('Restarting WebSocket server...');
  
  if (wssNav) {
    console.log('Closing existing WebSocket server...');
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
    console.log('WebSocket server restarted successfully');
    return true;
  } else {
    console.error('No HTTP server reference available for restart');
    return false;
  }
}

export function broadcastToWebsockets(data) {
//  console.log({ broadcastToWebsockets: data });
  if (!wssNav) return console.warn('No WebSocket server for messages');
  
  const msg = typeof data === 'string' ? data : JSON.stringify(data);
//  console.debug('Client Count:', wssNav.clients.size);
  
  wssNav.clients.forEach((client) => {
    if (client.readyState === client.OPEN) {
      client.send(msg);
   //   console.debug('[WebSocket] Message sent:', msg);
    } else {
      console.warn('[WebSocket] Client not open, skipping send:', client.readyState);
    }
  });
}