#!/usr/bin/env node

import WebSocket from 'ws';
import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';

// Configuration
const DAYLIGHT_HOST = process.env.DAYLIGHT_HOST || 'localhost';
const DAYLIGHT_PORT = process.env.DAYLIGHT_PORT || 3112;
const SIMULATION_DURATION = 180 * 1000; // 3 minutes in milliseconds
const UPDATE_INTERVAL = 2000; // Send data every 2 seconds

// Locate and parse the root config.app.yml
function loadConfig() {
  // In ESM, __dirname is not available, use import.meta.url instead
  const __filename = new URL(import.meta.url).pathname;
  const rootDir = path.resolve(path.dirname(__filename), '..', '..');
  const configPath = path.join(rootDir, 'config.app.yml');
  try {
    const raw = fs.readFileSync(configPath, 'utf8');
    return yaml.load(raw);
  } catch (err) {
    console.error('❌ Failed to load config.app.yml:', err.message);
    return {};
  }
}

const appConfig = loadConfig();
const fitnessCfg = appConfig?.fitness || {};
const antDevices = fitnessCfg?.ant_devices || {};
const hrDevicesConfig = antDevices?.hr || {}; // { deviceId: color }
const cadenceDevicesConfig = antDevices?.cadence || {}; // { deviceId: color }
const usersCfg = fitnessCfg?.users || {};
const primaryUsers = usersCfg.primary || [];
const secondaryUsers = usersCfg.secondary || [];

// Build mapping deviceId -> user (first come first serve from primary then secondary)
const hrUserMap = {};
[...primaryUsers, ...secondaryUsers].forEach(u => {
  if (u?.hr !== undefined && u?.hr !== null) {
    hrUserMap[String(u.hr)] = u.name;
  }
});

// Utility to create baseline heart rate characteristics per user/device
function baselineForDevice(deviceId) {
  // Provide varied but deterministic base using deviceId hash
  const base = 70 + (parseInt(deviceId, 10) % 10); // 70-79
  const variability = 10 + (parseInt(deviceId, 10) % 6); // 10-15
  return { baseHeartRate: base, variability };
}

// Create device list dynamically (heart rate + cadence only)
const devices = [];

Object.keys(hrDevicesConfig).forEach(id => {
  const { baseHeartRate, variability } = baselineForDevice(id);
  devices.push({
    deviceId: Number(id),
    profile: 'HeartRate',
    type: 'heart_rate',
    serialNumber: Number(id),
    baseHeartRate,
    variability,
    batteryLevel: 80,
    beatCount: 0,
    owner: hrUserMap[String(id)],
    color: hrDevicesConfig[id]
  });
});

Object.keys(cadenceDevicesConfig).forEach(id => {
  devices.push({
    deviceId: Number(id),
    profile: 'Cadence',
    type: 'cadence',
    serialNumber: Number(id),
    baseCadence: 80,
    cadenceVariability: 8,
    batteryLevel: 75,
    revolutionCount: 0
  });
});
console.log('🧪 Loaded config devices:', devices.map(d => ({ id: d.deviceId, type: d.type, owner: d.owner || null })));

class FitnessSimulator {
  constructor() {
    this.ws = null;
    this.connected = false;
    this.startTime = Date.now();
    this.intervals = [];
  }

  async connect() {
    const protocol = DAYLIGHT_PORT == 443 ? 'wss' : 'ws';
    const wsUrl = `${protocol}://${DAYLIGHT_HOST}:${DAYLIGHT_PORT}/ws`;
    
    console.log(`🔗 Connecting to DaylightStation WebSocket: ${wsUrl}`);
    
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(wsUrl);
      
      this.ws.on('open', () => {
        console.log('✅ Connected to DaylightStation WebSocket');
        this.connected = true;
        resolve();
      });
      
      this.ws.on('close', () => {
        console.log('⚠️  WebSocket connection closed');
        this.connected = false;
      });
      
      this.ws.on('error', (error) => {
        console.error('❌ WebSocket error:', error.message);
        reject(error);
      });
    });
  }

  sendFitnessData(deviceData) {
    if (!this.connected || !this.ws) return;

    const message = {
      topic: 'fitness',
      source: 'fitness-simulator',
      type: 'ant',
      timestamp: new Date().toISOString(),
      profile: deviceData.profile,
      deviceId: deviceData.deviceId,
      dongleIndex: 0, // Simulated dongle
      data: deviceData.data
    };

    this.ws.send(JSON.stringify(message));
    console.log(`📊 Sent ${deviceData.profile} data for device ${deviceData.deviceId}`);
  }

  generateHeartRateData(device, elapsedSeconds) {
    // Simulate workout intensity curve (starts low, builds up, then steady)
    let intensityFactor = 1.0;
    if (elapsedSeconds < 10) {
      intensityFactor = 0.7 + (elapsedSeconds / 10) * 0.3; // Warm up
    } else if (elapsedSeconds > 45) {
      intensityFactor = 1.1; // High intensity finish
    }

    const targetHR = Math.round(device.baseHeartRate * intensityFactor);
    const variation = (Math.random() - 0.5) * device.variability;
    const heartRate = Math.max(50, Math.round(targetHR + variation));
    
    device.beatCount += Math.round(heartRate / 30); // Approximate beats in 2 seconds
    const beatTime = (elapsedSeconds * 1024) % 65536; // ANT+ beat time format

    return {
      ManId: 255,
      SerialNumber: device.serialNumber,
      HwVersion: 5,
      SwVersion: 1,
      ModelNum: 2,
      BatteryLevel: device.batteryLevel,
      BatteryVoltage: 4.15625,
      BatteryStatus: "Good",
      DeviceID: device.deviceId,
      Channel: 0,
      BeatTime: beatTime,
      BeatCount: device.beatCount,
      ComputedHeartRate: heartRate,
      PreviousBeat: beatTime - 1024,
      OperatingTime: elapsedSeconds * 1000
    };
  }

  // Generate cadence-only data
  generateCadenceData(device, elapsedSeconds) {
    // Mild oscillation pattern
    const intervalPhase = Math.floor(elapsedSeconds / 20) % 2; // alternate every 20s
    const cadenceFactor = intervalPhase === 0 ? 0.95 : 1.05;
    const targetCadence = device.baseCadence * cadenceFactor;
    const variation = (Math.random() - 0.5) * device.cadenceVariability;
    const cadence = Math.max(50, Math.round(targetCadence + variation));
    device.revolutionCount += Math.round(cadence / 30); // approx over 2s
    const eventTime = (elapsedSeconds * 1024) % 65536;
    return {
      ManId: 255,
      SerialNumber: device.serialNumber,
      BatteryStatus: 'Good',
      BatteryLevel: device.batteryLevel,
      DeviceID: device.deviceId,
      Channel: 0,
      CadenceEventTime: eventTime,
      CumulativeCadenceRevolutionCount: device.revolutionCount,
      CalculatedCadence: cadence
    };
  }

  startSimulation() {
    console.log(`🚀 Starting fitness simulation for ${SIMULATION_DURATION / 1000} seconds`);
  console.log(`📊 Simulating ${devices.length} devices:`);
    
    devices.forEach(device => {
      console.log(`  - Device ${device.deviceId}: ${device.profile} (${device.type})`);
    });
    
    // Set up intervals for each device
    devices.forEach(device => {
      const interval = setInterval(() => {
        const elapsedSeconds = Math.floor((Date.now() - this.startTime) / 1000);
        
        let data;
        if (device.type === 'heart_rate') {
          data = this.generateHeartRateData(device, elapsedSeconds);
        } else if (device.type === 'cadence') {
          data = this.generateCadenceData(device, elapsedSeconds);
        }
        
        if (data) {
          this.sendFitnessData({
            profile: device.profile,
            deviceId: device.deviceId,
            data: data
          });
        }
      }, UPDATE_INTERVAL);
      
      this.intervals.push(interval);
    });

    // Stop simulation after duration
    setTimeout(() => {
      this.stopSimulation();
    }, SIMULATION_DURATION);
  }

  stopSimulation() {
    console.log('🛑 Stopping fitness simulation');
    
    // Clear all intervals
    this.intervals.forEach(interval => clearInterval(interval));
    this.intervals = [];
    
    // Close WebSocket connection
    if (this.ws) {
      this.ws.close();
    }
    
    // Print summary
    console.log('\n📈 Simulation Summary:');
    devices.forEach(device => {
      if (device.type === 'heart_rate') {
        console.log(`  Heart Rate ${device.deviceId} (${device.owner || 'Unassigned'}): ${device.beatCount} beats total`);
      } else if (device.type === 'cadence') {
        console.log(`  Cadence ${device.deviceId}: ${device.revolutionCount} crank revolutions`);
      }
    });
    
    console.log('\n✅ Simulation complete!');
    process.exit(0);
  }
}

// Main execution
async function main() {
  console.log('🎯 ANT+ Fitness Data Simulator');
  console.log('===============================');
  
  const simulator = new FitnessSimulator();
  
  try {
    await simulator.connect();
    simulator.startSimulation();
  } catch (error) {
    console.error('💥 Failed to start simulation:', error.message);
    process.exit(1);
  }
}

// Handle Ctrl+C gracefully
process.on('SIGINT', () => {
  console.log('\n⚠️  Received SIGINT, stopping simulation...');
  process.exit(0);
});

// Start the simulation
main();
