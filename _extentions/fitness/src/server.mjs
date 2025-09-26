import express from 'express';
import { exec } from 'child_process';
import { promisify } from 'util';
import { createRequire } from 'module';
import WebSocket from 'ws';

const execAsync = promisify(exec);

// Create require function for CommonJS modules in ES module context
const require = createRequire(import.meta.url);

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
let antInitialized = false;
let reconnectInterval = null;

// ANT+ Device scanning and management (Multi-dongle support)
class ANTPlusManager {
  constructor() {
    this.devices = new Map(); // Map of device index -> AntDevice
    this.sensors = new Map();
    this.scanInterval = null;
  }

  async initialize() {
    console.log('🔍 Initializing ANT+ devices...');
    
    // First, check for USB devices that might be ANT+ dongles
    try {
      console.log('📡 Scanning for USB devices...');
      const { stdout } = await execAsync('lsusb | grep -i "dynastream\\|ant"');
      if (stdout.trim()) {
        console.log('✅ Found ANT+ devices:');
        const lines = stdout.trim().split('\n');
        lines.forEach((line, index) => {
          console.log(`  Device ${index}: ${line}`);
        });
      } else {
        console.log('⚠️  No ANT+ dongles detected in USB devices');
      }
    } catch (error) {
      console.log('📋 USB device scan: No ANT+ dongles found or lsusb not available');
    }

    // Try to initialize multiple ANT+ hardware devices
    let successCount = 0;
    try {
      const { AntDevice } = require('incyclist-ant-plus/lib/bindings/index.js');
      
      // Try to open multiple devices (typically 0, 1, 2...)
      for (let deviceIndex = 0; deviceIndex < 4; deviceIndex++) {
        try {
          console.log(`🔌 Attempting to open ANT+ device ${deviceIndex}...`);
          const device = new AntDevice({ 
            startupTimeout: 5000,
            deviceNo: deviceIndex  // Specify device number
          });
          
          const success = await device.open();
          
          if (success) {
            this.devices.set(deviceIndex, device);
            console.log(`✅ ANT+ device ${deviceIndex} opened successfully!`);
            successCount++;
          } else {
            console.log(`⚠️  ANT+ device ${deviceIndex} failed to open`);
          }
        } catch (deviceError) {
          console.log(`⚠️  ANT+ device ${deviceIndex} not available: ${deviceError.message}`);
          // Continue trying other devices
        }
      }
      
      if (successCount > 0) {
        console.log(`✅ Successfully initialized ${successCount} ANT+ device(s)`);
        console.log('📡 Starting real ANT+ device scanning...');
        this.startScanning();
        return true;
      } else {
        throw new Error('No ANT+ devices could be opened');
      }
    } catch (error) {
      console.log('❌ ANT+ hardware initialization failed:', error.message);
      console.log('🔍 Error details:', error);
      console.log('� ANT+ functionality disabled - continuing without heart rate monitoring');
      
      // Clear device references to prevent further ANT+ operations
      this.devices.clear();
      return false;
    }
  }

  startScanning() {
    if (this.devices.size === 0) {
      console.log('⚠️  No ANT+ devices available - skipping sensor scanning');
      return;
    }
    
    console.log(`📡 Starting ANT+ sensor scan on ${this.devices.size} device(s)...`);
    
    // Scan with all available devices and attach all sensors dynamically
    this.scanForAllSensors();
    
    console.log('🛰️  Scanning for ANT+ devices - waiting for broadcasts...');
  }

  async scanForAllSensors() {
    if (this.devices.size === 0) {
      console.log('⚠️  No ANT+ devices available - cannot scan for sensors');
      return;
    }
    
    // Set up scanning for each device
    for (const [deviceIndex, device] of this.devices) {
      try {
        console.log(`🔗 Setting up scanning on ANT+ device ${deviceIndex}...`);
        await this.setupSensorScanning(device, deviceIndex);
      } catch (error) {
        console.error(`❌ Failed to setup scanning on device ${deviceIndex}:`, error.message);
      }
    }
  }

  async setupSensorScanning(device, deviceIndex) {
    try {
      // Dynamically import all available sensor classes from incyclist-ant-plus
      const ant = require('incyclist-ant-plus');
      
      console.log(`🔗 Getting ANT+ channel for device ${deviceIndex}...`);
      const channel = device.getChannel();
      console.log(`✅ ANT+ channel reserved for device ${deviceIndex}`);

      // Track detected devices
      const detectedDevices = new Map();
      let rawDetectionCount = 0;
      let rawDataCount = 0;

      // Enhanced event listeners with more detail (like hardware diagnostic)
      channel.on('detect', (profile, deviceId) => {
        rawDetectionCount++;
        const timestamp = new Date().toISOString().split('T')[1].slice(0, -5);
        
        console.log(`[${timestamp}] DETECTED ${deviceId} ${profile} (Dongle ${deviceIndex})`);
        
        if (!detectedDevices.has(deviceId)) {
          detectedDevices.set(deviceId, {
            profile: profile,
            firstSeen: timestamp,
            dataPackets: 0,
            dongleIndex: deviceIndex
          });
        }
      });

      channel.on('data', (profile, deviceId, data) => {
        rawDataCount++;
        const timestamp = new Date().toISOString().split('T')[1].slice(0, -5);
        
        // Update device data packet count
        if (detectedDevices.has(deviceId)) {
          detectedDevices.get(deviceId).dataPackets++;
        }
        // Log generic ANT+ data and broadcast raw content without guessing names
        console.log(`[${timestamp}] ${deviceId} ${profile}:`, JSON.stringify(data));

        this.broadcastFitnessData({
          type: 'ant',
          profile,
          deviceId,
          dongleIndex: deviceIndex,
          data
        });
      });

      // Attach all available sensors dynamically (without hardcoding names)
      const sensorEntries = Object.entries(ant)
        .filter(([name, ctor]) => typeof ctor === 'function' && /Sensor$/.test(name));

      if (sensorEntries.length === 0) {
        console.log(`⚠️  No sensor classes found in incyclist-ant-plus export; proceeding with raw scanner`);
      } else {
        for (const [name, SensorClass] of sensorEntries) {
          try {
            const sensorInstance = new SensorClass();
            channel.attach(sensorInstance);
            console.log(`🔗 Attached ${name} on device ${deviceIndex}`);
          } catch (attachErr) {
            console.log(`⚠️  Failed to attach ${name} on device ${deviceIndex}: ${attachErr.message}`);
          }
        }
      }
      
      console.log(`🔍 Starting ANT+ scanner for device ${deviceIndex}...`);
      console.log(`💡 Device ${deviceIndex} ready for ANT+ devices!`);
      
      // Start scanning (indefinitely)
      await channel.startScanner();
      console.log(`✅ Scanning active on device ${deviceIndex} - waiting for broadcasts...`);
      
    } catch (error) {
      console.error(`❌ Sensor setup failed on device ${deviceIndex}:`, error.message);
      console.log(`💡 ANT+ scanning disabled on device ${deviceIndex} due to initialization failure`);
    }
  }

  startRawChannelMonitoring() {
    // Simple channel monitoring as fallback
    console.log('📡 Monitoring ANT+ channels for data...');
    // This would require more low-level ANT+ implementation
    // For now, just log that we're ready
    console.log('📡 Ready to receive ANT+ data - start your workout!');
  }

  broadcastFitnessData(data) {
    const message = {
      topic: 'fitness',
      source: 'fitness',
      type: data.type || 'ant',
      timestamp: new Date().toISOString(),
      ...data
    };

    // Send via WebSocket if connected
    if (websocketClient && websocketClient.readyState === WebSocket.OPEN) {
      websocketClient.send(JSON.stringify(message));
    }
  }

  // Cleanup method
  async cleanup() {
    for (const [deviceIndex, device] of this.devices) {
      try {
        await device.close();
        console.log(`✅ ANT+ device ${deviceIndex} closed successfully`);
      } catch (error) {
        console.error(`❌ Error closing ANT+ device ${deviceIndex}:`, error.message);
      }
    }
    this.devices.clear();
  }
}

// Global ANT+ manager instance
const antManager = new ANTPlusManager();

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
    ant_plus: {
      initialized: antInitialized,
      devices_connected: antManager.devices.size,
      device_indices: Array.from(antManager.devices.keys()),
      sensors_active: antManager.sensors.size
    },
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
  
  process.exit(0);
});

// Startup sequence
async function startServer() {
  console.log('🚀 Starting Fitness Controller Server...');
  console.log(`📡 DaylightStation WebSocket: ${DAYLIGHT_PORT == 443 ? 'wss' : 'ws'}://${DAYLIGHT_HOST}:${DAYLIGHT_PORT}/ws`);
  console.log(`📺 TV Control Device: ${SERIAL_DEVICE}`);
  
  // Initialize ANT+ first
  try {
    await antManager.initialize();
    antInitialized = true;
    console.log('✅ ANT+ manager initialized');
  } catch (error) {
    console.error('❌ ANT+ initialization failed:', error.message);
    // Continue without ANT+ - server can still handle TV control
  }
  
  // Connect to DaylightStation WebSocket
  await connectWebSocket();
  
  // Start Express server
  const server = app.listen(PORT, () => {
    console.log(`✅ Fitness Controller Server running on port ${PORT}`);
    console.log(`🌐 Health check: http://localhost:${PORT}/health`);
    console.log(`📊 Status: http://localhost:${PORT}/status`);
    console.log(`📺 TV Control: GET http://localhost:${PORT}/tv/on or /tv/off`);
    console.log('🎯 Ready for ANT+ monitoring and TV control!');
  });
  
  return server;
}

// Start the application
startServer().catch((error) => {
  console.error('💥 Failed to start server:', error.message);
  process.exit(1);
});
