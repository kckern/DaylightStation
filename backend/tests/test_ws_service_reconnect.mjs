
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import fs from 'fs';

// Mock Browser Environment
global.window = {
  location: {
    href: 'http://localhost:3000',
    origin: 'http://localhost:3000'
  }
};

// Mock WebSocket class
class MockWebSocket {
  constructor(url) {
    this.url = url;
    this.readyState = 0; // CONNECTING
    this.sentMessages = [];
    
    // Simulate connection delay
    setTimeout(() => {
        this.readyState = 1; // OPEN
        if (this.onopen) this.onopen();
    }, 10);
  }

  send(data) {
    this.sentMessages.push(data);
  }

  close() {
    this.readyState = 3; // CLOSED
    if (this.onclose) this.onclose({ code: 1000 });
  }
}

// Add constants
MockWebSocket.CONNECTING = 0;
MockWebSocket.OPEN = 1;
MockWebSocket.CLOSING = 2;
MockWebSocket.CLOSED = 3;

global.WebSocket = MockWebSocket;

// Import the service under test
// Note: We need to import the file dynamically to pick up the mocks
const currentDir = dirname(fileURLToPath(import.meta.url));
// Adjust path from backend/tests/ to frontend/src/services/
const servicePath = join(currentDir, '../../frontend/src/services/WebSocketService.js');

async function runTest() {
  console.log('Loading WebSocketService from', servicePath);
  const { wsService } = await import(servicePath);

  console.log('1. Initial Connection & Subscription');
  
  // Set up a subscription
  wsService.subscribe('fitness', () => {});
  wsService.subscribe(['system', 'menu'], () => {});

  // Wait for connection simulation
  await new Promise(resolve => setTimeout(resolve, 50));

  // Check if subscriptions were sent
  const ws = wsService.ws;
  if (!ws) {
      console.error('❌ WebSocket not initialized');
      process.exit(1);
  }

  const subMsg = ws.sentMessages.find(m => {
      const d = JSON.parse(m);
      return d.type === 'bus_command' && d.action === 'subscribe';
  });

  if (subMsg) {
      const data = JSON.parse(subMsg);
      // We expect 'fitness', 'system', 'menu'
      const topics = data.topics.sort();
      const expected = ['fitness', 'menu', 'system'].sort();
      
      const match = JSON.stringify(topics) === JSON.stringify(expected);
      if (match) {
          console.log('✅ Initial subscription sync verified:', topics);
      } else {
          console.error('❌ Mismatch in topics:', topics, 'Expected:', expected);
          process.exit(1);
      }
  } else {
      console.error('❌ No subscribe command sent on initial connect');
      process.exit(1);
  }

  console.log('2. Simulating Disconnection');
  ws.close();
  
  if (wsService.connected) {
      console.error('❌ Service should report disconnected');
      process.exit(1);
  }
  console.log('✅ Service disconnected');

  console.log('3. Simulating Reconnection');
  // Manually trigger connect (simulate retry or manual connect)
  wsService.connect();

  // Wait for connection
  await new Promise(resolve => setTimeout(resolve, 50));

  const newWs = wsService.ws;
  if (newWs === ws) {
      console.error('❌ Should have created a new WebSocket instance');
      process.exit(1);
  }

  const reSubMsg = newWs.sentMessages.find(m => {
      const d = JSON.parse(m);
      return d.type === 'bus_command' && d.action === 'subscribe';
  });

  if (reSubMsg) {
       console.log('✅ Re-subscription verified');
  } else {
      console.error('❌ No subscribe command sent on reconnection');
      process.exit(1);
  }

  console.log('--- TEST PASSED ---');
}

runTest().catch(console.error);
