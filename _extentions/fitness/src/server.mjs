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

// ANT+ Device scanning and management (Simplified for development)
class ANTPlusManager {
  constructor() {
    this.device = null;
    this.sensors = new Map();
    this.scanInterval = null;
  }

  async initialize() {
    console.log('🔍 Initializing ANT+ device...');
    
    // First, check for USB devices that might be ANT+ dongles
    try {
      console.log('📡 Scanning for USB devices...');
      const { stdout } = await execAsync('system_profiler SPUSBDataType | grep -A 10 -B 2 -i "ant\\|garmin\\|dynastream"');
      if (stdout.trim()) {
        console.log('✅ Found potential ANT+ devices:');
        console.log(stdout);
      } else {
        console.log('⚠️  No ANT+ dongles detected in USB devices');
      }
    } catch (error) {
      console.log('📋 USB device scan: No ANT+ dongles found or system_profiler not available');
    }

    // Try to initialize real ANT+ hardware
    try {
      const { AntDevice } = require('incyclist-ant-plus/lib/bindings/index.js');
      
      this.device = new AntDevice({ startupTimeout: 5000 });
      console.log('🔌 Attempting to open ANT+ device...');
      
      const success = await this.device.open();
      
      if (success) {
        console.log('✅ ANT+ hardware device opened successfully!');
        console.log('📡 Starting real ANT+ device scanning...');
        this.startScanning();
        return true;
      } else {
        throw new Error('ANT+ device failed to open');
      }
    } catch (error) {
      console.log('🧪 No ANT+ hardware detected - running in simulation mode for development');
      
      // Only run simulation if explicitly requested
      if (process.env.ENABLE_SIMULATION === 'true') {
        console.log('📊 Starting ANT+ simulation (ENABLE_SIMULATION=true)...');
        this.startSimulation();
      } else {
        console.log('💤 ANT+ simulation disabled - set ENABLE_SIMULATION=true to enable mock data');
      }
      
      return true;
    }
  }

  startSimulation() {
    console.log('📡 Starting ANT+ simulation mode...');
    
    // Simulate heart rate data every 30 seconds (less frequent)
    setInterval(() => {
      const simulatedData = {
        type: 'heart_rate',
        deviceId: 12345,
        heartRate: 65 + Math.floor(Math.random() * 40), // 65-105 BPM
        batteryLevel: 85
      };
      
      console.log('📊 Simulated HR:', simulatedData.heartRate, 'BPM');
      this.broadcastFitnessData(simulatedData);
    }, 30000); // Every 30 seconds

    // Simulate power data every 20 seconds (less frequent)
    setInterval(() => {
      const simulatedData = {
        type: 'power',
        deviceId: 67890,
        power: 150 + Math.floor(Math.random() * 100), // 150-250 watts
        cadence: 80 + Math.floor(Math.random() * 20) // 80-100 RPM
      };
      
      console.log('📊 Simulated Power:', simulatedData.power, 'W,', simulatedData.cadence, 'RPM');
      this.broadcastFitnessData(simulatedData);
    }, 20000); // Every 20 seconds

    console.log('🔔 Simulation will log data every 20-30 seconds');
  }

  startScanning() {
    console.log('📡 Starting ANT+ heart rate sensor scan...');
    
    // Focus only on heart rate sensors
    this.scanForHeartRateSensors();
    
    console.log('❤️  Scanning for heart rate monitors - waiting for device connections...');
  }

  async scanForHeartRateSensors() {
    try {
      // Use the same import approach as the working reference
      const { HeartRateSensor } = require('incyclist-ant-plus');
      
      console.log('🔗 Getting ANT+ channel...');
      const channel = this.device.getChannel();
      console.log('✅ ANT+ channel reserved');

      // Track detected devices
      const detectedDevices = new Map();
      let rawDetectionCount = 0;
      let rawDataCount = 0;

      // Enhanced event listeners with more detail (like hardware diagnostic)
      channel.on('detect', (profile, deviceId) => {
        rawDetectionCount++;
        const timestamp = new Date().toISOString().split('T')[1].slice(0, -5);
        
        console.log(`[${timestamp}] DETECTED ${deviceId} ${profile}`);
        
        if (!detectedDevices.has(deviceId)) {
          detectedDevices.set(deviceId, {
            profile: profile,
            firstSeen: timestamp,
            dataPackets: 0
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
        
        // Only log heart rate data
        if (data.ComputedHeartRate) {
          console.log(`[${timestamp}] ${deviceId} bpm ${data.ComputedHeartRate}`);
          
          // Broadcast heart rate data
          this.broadcastFitnessData({
            type: 'heart_rate',
            deviceId: deviceId,
            heartRate: data.ComputedHeartRate,
            batteryLevel: data.BatteryLevel || null,
            heartBeatCount: data.HeartBeatCount || null,
            profile: profile
          });
        }
      });

      // Create and attach heart rate sensor (like hardware diagnostic)
      console.log('❤️  Creating heart rate sensor...');
      const hrSensor = new HeartRateSensor();
      console.log('🔗 Attaching heart rate sensor to channel...');
      channel.attach(hrSensor);
      
      console.log('🔍 Starting ANT+ scanner for heart rate devices...');
      console.log('💡 Turn on your heart rate monitor now!');
      console.log('📻 Looking for heart rate monitors broadcasting...\n');
      
      // Start scanning (indefinitely)
      await channel.startScanner();
      console.log('✅ Heart Rate scanning active - waiting for device broadcasts...');
      
    } catch (error) {
      console.error('❌ Heart Rate Sensor setup failed:', error.message);
      console.log('💡 Try turning on your heart rate monitor and ensure it\'s broadcasting');
    }
  }

  startRawChannelMonitoring() {
    // Simple channel monitoring as fallback
    console.log('📡 Monitoring ANT+ channels for heart rate data...');
    // This would require more low-level ANT+ implementation
    // For now, just log that we're ready
    console.log('📡 Ready to receive heart rate data - start your workout!');
  }

  broadcastFitnessData(data) {
    const message = {
      topic: 'fitness',
      source: 'fitness',
      type: data.type || 'heart_rate',
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
    if (this.device) {
      try {
        await this.device.close();
        console.log('✅ ANT+ device closed successfully');
      } catch (error) {
        console.error('❌ Error closing ANT+ device:', error.message);
      }
    }
  }
}

// Global ANT+ manager instance
const antManager = new ANTPlusManager();

// WebSocket connection management
async function connectWebSocket() {
  const protocol = DAYLIGHT_PORT == 443 ? 'wss' : 'ws';
  const wsUrl = `${protocol}://${DAYLIGHT_HOST}:${DAYLIGHT_PORT}/ws`;
  
  console.log(`🔗 Connecting to DaylightStation WebSocket: ${wsUrl}`);
  
  try {
    websocketClient = new WebSocket(wsUrl);
    
    websocketClient.on('open', () => {
      console.log('✅ Connected to DaylightStation WebSocket server');
      clearInterval(reconnectInterval);
      reconnectInterval = null;
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
      console.log('❌ WebSocket connection closed');
      scheduleReconnect();
    });
    
    websocketClient.on('error', (error) => {
      console.error('❌ WebSocket error:', error.message);
      scheduleReconnect();
    });
    
  } catch (error) {
    console.error('❌ Failed to create WebSocket connection:', error.message);
    scheduleReconnect();
  }
}

function scheduleReconnect() {
  if (!reconnectInterval) {
    console.log('🔄 Scheduling WebSocket reconnection in 30 seconds...');
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
      device_connected: !!antManager.device,
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

app.post('/tv/on', async (req, res) => {
  console.log('📺 TV ON command received');
  const result = await sendTVCommand(TV_ON_COMMAND);
  res.json(result);
});

app.post('/tv/off', async (req, res) => {
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
    console.log(`📺 TV Control: POST http://localhost:${PORT}/tv/on or /tv/off`);
    console.log('🎯 Ready for ANT+ heart rate monitoring and TV control!');
  });
  
  return server;
}

// Start the application
startServer().catch((error) => {
  console.error('💥 Failed to start server:', error.message);
  process.exit(1);
});
