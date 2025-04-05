
  // WebSocket server

  import { WebSocketServer } from 'ws'; // Import WebSocketServer
  import { v4 as uuidv4 } from 'uuid';


  export default function createWebsocketServer(server){

    const wss = new WebSocketServer({ server, path: '/ws/ping' });

    wss.on('connection', (ws) => {
      console.log('WebSocket connection established on /ws/ping');
  
      let interval = null;

      ws.on('open', () => {
        interval = setInterval(() => {
          if (ws.readyState === ws.OPEN) {
            ws.send(JSON.stringify({ timestamp: new Date().toISOString(), guid: uuidv4() }));
          }
        }, 1000);
      });

      ws.on('close', () => {
        console.log('WebSocket connection closed');
        if (interval) {
          clearInterval(interval);
          interval = null;
        }
      });
    });
    return wss;
  }