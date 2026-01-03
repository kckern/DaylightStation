
import WebSocket from 'ws';
import http from 'http';
import { createWebsocketServer } from '../routers/websocket.mjs';

// Setup test server
const PORT = 3113; // Use different port to avoid conflicts
const server = http.createServer();
// We need to initialize the wss logic
// The module expects 'express' server typically but it just attaches to 'upgrade' or 'server' instance usually.
// Looking at websocket.mjs:
//   wssNav = new WebSocketServer({ server, path: '/ws' });
// This accepts a raw http server.

// We need to dynamically import because the backend uses ES modules and might have other deps.
// Assuming the imports in websocket.mjs (logger, etc) are resolvable. 
// They are relative paths: '../lib/logging/logger.js', etc.
// The test is in backend/tests/ so '../routers' works.
// BUT 'websocket.mjs' imports `createLogger` from `../lib/logging/logger.js`.
// Relative to `backend/routers/`, `../lib` is `backend/lib`.
// Relative to `backend/tests/` (where this script is), `../routers/websocket.mjs` is reachable.
// But we need to make sure we don't crash on other imports.
// The logging module likely exists.

// Initialize the server
console.log('Starting in-process test server...');
const { wssNav } = createWebsocketServer(server);
server.listen(PORT);

function createClient() {
    return new Promise((resolve) => {
        const ws = new WebSocket(`ws://localhost:${PORT}/ws`);
        ws.on('open', () => resolve(ws));
    });
}

async function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function testStrictRouting() {
    console.log(`Test Server running on port ${PORT}`);
    
    // 1. Client A: No subscriptions (Should receive NOTHING)
    console.log('1. Connecting Client A (No subscriptions)...');
    const clientA = await createClient();
    const messagesA = [];
    clientA.on('message', (data) => {
        messagesA.push(JSON.parse(data));
    });

    // 2. Client B: Subscribed to 'test_topic'
    console.log('2. Connecting Client B (Subscribed to test_topic)...');
    const clientB = await createClient();
    const messagesB = [];
    clientB.on('message', (data) => {
        messagesB.push(JSON.parse(data));
    });
    
    // Subscribe Client B
    clientB.send(JSON.stringify({
        type: 'bus_command',
        action: 'subscribe',
        topics: ['test_topic']
    }));
    await sleep(200);

    // 3. Broadcast to 'test_topic'
    console.log('3. Broadcasting to test_topic...');
    
    // Use the exported broadcast function directly! 
    // This is better than http request since we are in-process.
    // Need to re-import it from the same module instance.
    const { broadcastToWebsockets } = await import('../routers/websocket.mjs');
    
    broadcastToWebsockets({
        topic: 'test_topic',
        data: 'hello'
    });
    
    await sleep(500);

    console.log(`Client A messages: ${messagesA.length}`);
    console.log(`Client B messages: ${messagesB.length}`);

    let passed = true;

    // Client A should have 0 messages (ignoring potential welcome/ack? websocket.mjs doesn't send welcome)
    if (messagesA.length > 0) {
        // Double check what messages it got.
        // It might get 'bus_ack' if it sent a command, but it didn't.
        // It connects and does nothing.
        // It initiates with empty set.
        console.error('❌ Client A received message despite no subscription:', messagesA);
        passed = false;
    } else {
        console.log('✅ Client A received no messages.');
    }

    // Client B should have the message
    // It also has the 'bus_ack' for subscription.
    const broadcastsB = messagesB.filter(m => m.topic === 'test_topic' && m.data === 'hello');
    if (broadcastsB.length > 0) {
        console.log('✅ Client B received the broadcast.');
    } else {
        console.error('❌ Client B missing broadcast. Messages:', messagesB);
        passed = false;
    }

    clientA.close();
    clientB.close();
    server.close();
    // wssNav.close() if accessible, but server.close() destroys the socket.
    
    if (passed) {
        console.log('--- TEST PASSED: Strict Routing Enforced ---');
        process.exit(0);
    } else {
        console.error('--- TEST FAILED ---');
        process.exit(1);
    }
}

testStrictRouting().catch(e => {
    console.error(e);
    server.close();
    process.exit(1);
});
