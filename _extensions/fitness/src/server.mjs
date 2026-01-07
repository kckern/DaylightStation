import express from 'express';
import WebSocket from 'ws';
import { ANTPlusManager } from './ant.mjs';
import { BLEManager } from './ble.mjs';

// Configuration from environment variables
const PORT = process.env.PORT || 3000;
const DAYLIGHT_HOST = process.env.DAYLIGHT_HOST || 'localhost';
const DAYLIGHT_PORT = process.env.DAYLIGHT_PORT || 3112;
const SERIAL_DEVICE = process.env.SERIAL_DEVICE || '/dev/ttyUSB0';
const TV_ON_COMMAND = process.env.TV_ON_COMMAND || '01 30 41 30 41 30 43 02 43 32 30 33 44 36 30 30 30 31 03 73 0D';
const TV_OFF_COMMAND = process.env.TV_OFF_COMMAND || '01 30 41 30 41 30 43 02 43 32 30 33 44 36 30 30 30 34 03 76 0D';

const app = express();

// Global state
let websocketClient = null;
let reconnectInterval = null;

// Broadcast function for fitness data
function broadcastFitnessData(message) {
  // Send via WebSocket if connected
  if (websocketClient && websocketClient.readyState === WebSocket.OPEN) {
    websocketClient.send(JSON.stringify(message));
  }
}

// Initialize managers with broadcast callback
const antManager = new ANTPlusManager(broadcastFitnessData);
const bleManager = new BLEManager(broadcastFitnessData);

// WebSocket connection management
let reconnectAttempts = 0;

async function connectWebSocket() {
  const protocol = DAYLIGHT_PORT == 443 ? 'wss' : 'ws';
  const wsUrl = `${protocol}://${DAYLIGHT_HOST}:${DAYLIGHT_PORT}/ws`;
  
  // Only log initial connection attempt, not reconnections
  if (reconnectAttempts === 0) {
    console.log(`🔗 Connecting to DaylightStation WebSocket: ${wsUrl}`);
  }
  
  try {
    websocketClient = new WebSocket(wsUrl);
    
    websocketClient.on('open', () => {
      // Only log successful connection after failures or initial connection
      if (reconnectAttempts > 0) {
        console.log('✅ WebSocket reconnected successfully');
      } else {
        console.log('✅ Connected to DaylightStation WebSocket server');
      }
      clearInterval(reconnectInterval);
      reconnectInterval = null;
      reconnectAttempts = 0;
    });
    
    websocketClient.on('message', (data) => {
      try {
        const message = JSON.parse(data);
      //  console.log('📥 Received from DaylightStation:', message.type || 'unknown');
      } catch (error) {
        console.log('📥 Received raw message:', data.toString());
      }
    });
    
    websocketClient.on('close', () => {
      // Only log close if we haven't already started reconnecting
      if (reconnectAttempts === 0) {
        console.log('⚠️  WebSocket connection lost, will retry...');
      }
      scheduleReconnect();
    });
    
    websocketClient.on('error', (error) => {
      // Only log errors that aren't routine connection issues
      if (!error.message.includes('ECONNREFUSED') && !error.message.includes('ETIMEDOUT')) {
        console.error('❌ WebSocket error:', error.message);
      }
      scheduleReconnect();
    });
    
  } catch (error) {
    console.error('❌ Failed to create WebSocket connection:', error.message);
    scheduleReconnect();
  }
}

function scheduleReconnect() {
  if (!reconnectInterval) {
    // Only log the first reconnection attempt, then stay quiet
    if (reconnectAttempts === 0) {
      console.log('🔄 Scheduling WebSocket reconnection...');
    }
    reconnectAttempts++;
    reconnectInterval = setInterval(connectWebSocket, 30000);
  }
}

// TV Control Functions
async function sendTVCommand(command) {
  try {
    const hexCommand = command.replace(/\s/g, '');
    const buffer = Buffer.from(hexCommand, 'hex');
    
    const { writeFile } = await import('fs/promises');
    await writeFile(SERIAL_DEVICE, buffer);
    
    console.log(`📺 TV command sent: ${command}`);
    return { success: true, message: 'Command sent successfully' };
    
  } catch (error) {
    console.error('❌ Failed to send TV command:', error.message);
    return { success: false, error: error.message };
  }
}

// Express Routes
app.use(express.json());

app.get('/status', (req, res) => {
  const status = {
    server: 'Fitness Controller',
    version: '1.0.0',
    timestamp: new Date().toISOString(),
    ant_plus: antManager.getStatus(),
    ble: bleManager.getStatus(),
    websocket: {
      connected: websocketClient?.readyState === WebSocket.OPEN,
      url: `${DAYLIGHT_PORT == 443 ? 'wss' : 'ws'}://${DAYLIGHT_HOST}:${DAYLIGHT_PORT}/ws`
    },
    tv_control: {
      device: SERIAL_DEVICE,
      available: true
    }
  };
  
  res.json(status);
});

app.get('/tv/on', async (req, res) => {
  console.log('📺 TV ON command received');
  const result = await sendTVCommand(TV_ON_COMMAND);
  res.json(result);
});

app.get('/tv/off', async (req, res) => {
  console.log('📺 TV OFF command received');
  const result = await sendTVCommand(TV_OFF_COMMAND);
  res.json(result);
});

// BLE control endpoints
app.get('/ble/start/:device?', async (req, res) => {
  const device = req.params.device || 'RENPHO_JUMPROPE';
  console.log(`📱 Starting BLE monitoring for ${device}`);
  const result = await bleManager.startMonitoring(device);
  res.json({ success: result, device });
});

app.get('/ble/stop/:device?', async (req, res) => {
  const device = req.params.device;
  console.log(`📱 Stopping BLE monitoring`);
  const result = await bleManager.stopMonitoring(device);
  res.json({ success: result });
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ 
    status: 'healthy',
    uptime: process.uptime(),
    timestamp: new Date().toISOString()
  });
});

// Error handling
app.use((err, req, res, next) => {
  console.error('Express error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('\n🛑 Received SIGINT, shutting down gracefully...');
  
  // Close WebSocket
  if (websocketClient) {
    websocketClient.close();
  }
  
  // Close ANT+ device
  await antManager.cleanup();
  
  // Close BLE monitors
  await bleManager.cleanup();
  
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('\n🛑 Received SIGTERM, shutting down gracefully...');
  
  // Close WebSocket
  if (websocketClient) {
    websocketClient.close();
  }
  
  // Close ANT+ device
  await antManager.cleanup();
  
  // Close BLE monitors
  await bleManager.cleanup();
  
  process.exit(0);
});

// Startup sequence
async function startServer() {
  console.log('🚀 Starting Fitness Controller Server...');
  console.log(`📡 DaylightStation WebSocket: ${DAYLIGHT_PORT == 443 ? 'wss' : 'ws'}://${DAYLIGHT_HOST}:${DAYLIGHT_PORT}/ws`);
  console.log(`📺 TV Control Device: ${SERIAL_DEVICE}`);
  
  // Initialize ANT+ first
  try {
    const antSuccess = await antManager.initialize();
    if (antSuccess) {
      console.log('✅ ANT+ manager initialized');
    }
  } catch (error) {
    console.error('❌ ANT+ initialization failed:', error.message);
    // Continue without ANT+ - server can still handle other functions
  }
  
  // Initialize BLE
  try {
    const bleSuccess = await bleManager.initialize();
    if (bleSuccess) {
      console.log('✅ BLE manager initialized');
      // Auto-start monitoring for known devices
      await bleManager.startMonitoring('RENPHO_JUMPROPE');
    }
  } catch (error) {
    console.error('❌ BLE initialization failed:', error.message);
    // Continue without BLE
  }
  
  // Connect to DaylightStation WebSocket
  await connectWebSocket();
  
  // Start Express server
  const server = app.listen(PORT, () => {
    console.log(`✅ Fitness Controller Server running on port ${PORT}`);
    console.log(`🌐 Health check: http://localhost:${PORT}/health`);
    console.log(`📊 Status: http://localhost:${PORT}/status`);
    console.log(`📺 TV Control: GET http://localhost:${PORT}/tv/on or /tv/off`);
    console.log(`📱 BLE Control: GET http://localhost:${PORT}/ble/start or /ble/stop`);
    console.log('🎯 Ready for ANT+ and BLE fitness monitoring!');
  });
  
  return server;
}

// Start the application
startServer().catch((error) => {
  console.error('💥 Failed to start server:', error.message);
  process.exit(1);
});
