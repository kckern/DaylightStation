#!/usr/bin/env node

import WebSocket from 'ws';
import fs from 'fs';
import path from 'path';

// Load .env file manually (avoid dotenv dependency)
const __filename = new URL(import.meta.url).pathname;
const rootDir = path.resolve(path.dirname(__filename), '..', '..');

// Try to load .env from project root
const envPath = path.join(rootDir, '.env');
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, 'utf8');
  envContent.split('\n').forEach(line => {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith('#')) {
      const [key, ...valueParts] = trimmed.split('=');
      if (key && valueParts.length > 0) {
        const value = valueParts.join('=').replace(/^["']|["']$/g, '');
        if (!process.env[key]) { // Don't override existing env vars
          process.env[key] = value;
        }
      }
    }
  });
  console.log('📄 Loaded .env from project root');
}

// Import the new config framework
import { resolveConfigPaths } from '../../backend/lib/config/pathResolver.mjs';
import { loadAllConfig } from '../../backend/lib/config/loader.mjs';
import { configService } from '../../backend/lib/config/ConfigService.mjs';
import { userDataService } from '../../backend/lib/config/UserDataService.mjs';
import { loadFile } from '../../backend/lib/io.mjs';

// Configuration
const DAYLIGHT_HOST = process.env.DAYLIGHT_HOST || 'localhost';
const DAYLIGHT_PORT = process.env.DAYLIGHT_PORT || 3112;
const SIMULATION_DURATION = 30 * 60 * 1000; // 3 minutes in milliseconds
const UPDATE_INTERVAL = 2000; // Send data every 2 seconds

// Initialize config using the new framework
const isDocker = fs.existsSync('/.dockerenv');

// Resolve config paths (from env vars, mount, or fallback)
const configPaths = resolveConfigPaths({ isDocker, codebaseDir: rootDir });

if (configPaths.error) {
  console.error('❌ Configuration error:', configPaths.error);
  console.error('💡 Set DAYLIGHT_CONFIG_PATH and DAYLIGHT_DATA_PATH environment variables');
  console.error('   Or create a .env file in the project root');
  process.exit(1);
}

console.log(`📁 Config source: ${configPaths.source}`);
console.log(`📁 Config dir: ${configPaths.configDir}`);
console.log(`📁 Data dir: ${configPaths.dataDir}`);

// Load all config using unified loader
const configResult = loadAllConfig({
  configDir: configPaths.configDir,
  dataDir: configPaths.dataDir,
  isDocker,
  isDev: !isDocker
});

// Populate process.env with merged config (required for loadFile and services)
process.env = { 
  ...process.env, 
  isDocker, 
  ...configResult.config
};

console.log('📊 Data path:', process.env.path?.data);

// Load fitness config using the new household-aware approach
function loadConfig() {
  try {
    const householdId = configService.getDefaultHouseholdId();
    console.log(`🏠 Using household: ${householdId}`);
    
    // Try household-scoped path first
    const householdConfig = userDataService.readHouseholdAppData(householdId, 'fitness', 'config');
    if (householdConfig) {
      console.log('✅ Loaded fitness config from household path');
      console.log('🧪 Config structure keys:', Object.keys(householdConfig || {}));
      return householdConfig;
    }
    
    // Fall back to legacy global path
    console.log('⚠️  Falling back to legacy fitness/config path');
    const parsed = loadFile("fitness/config");
    console.log('🧪 Config structure keys:', Object.keys(parsed || {}));
    return parsed;
  } catch (err) {
    console.error('🧪 Config load error:', err.message);
    return {};
  }
}

const appConfig = loadConfig();
// The config is flat, not nested under 'fitness'
const fitnessCfg = appConfig || {};

// Support both old and new config formats
// New format: devices.heart_rate = { deviceId: userId }, device_colors.heart_rate = { deviceId: color }
// Old format: ant_devices.hr = { deviceId: color }
const devicesConfig = fitnessCfg?.devices || {};
const deviceColorsConfig = fitnessCfg?.device_colors || {};
const antDevices = fitnessCfg?.ant_devices || {};

// New format: devices.heart_rate = { deviceId: userId }
const hrDevicesNew = devicesConfig?.heart_rate || {};
// Old format: ant_devices.hr = { deviceId: color }
const hrDevicesOld = antDevices?.hr || {};
// Merge - new format takes precedence
const hrDevicesConfig = Object.keys(hrDevicesNew).length > 0 ? hrDevicesNew : hrDevicesOld;
const hrColorsConfig = deviceColorsConfig?.heart_rate || antDevices?.hr || {};

// Same for cadence
const cadenceDevicesNew = devicesConfig?.cadence || {};
const cadenceDevicesOld = antDevices?.cadence || {};
const cadenceDevicesConfig = Object.keys(cadenceDevicesNew).length > 0 ? cadenceDevicesNew : cadenceDevicesOld;

const usersCfg = fitnessCfg?.users || {};
const primaryUsers = usersCfg.primary || [];
const secondaryUsers = usersCfg.secondary || [];

// Build mapping deviceId -> userName
// New format: devices.heart_rate = { deviceId: userId } - direct mapping
// Old format: users have hr property with deviceId
const hrUserMap = {};

// First, use the new devices.heart_rate mapping (deviceId -> userId)
Object.entries(hrDevicesConfig).forEach(([deviceId, userId]) => {
  hrUserMap[String(deviceId)] = String(userId);
});

// Fallback: Also check users for hr property (old format)
[...primaryUsers, ...secondaryUsers].forEach(u => {
  if (u?.hr !== undefined && u?.hr !== null) {
    hrUserMap[String(u.hr)] = u.name || u.id;
  }
});

console.log('🔧 HR device to user mapping:', hrUserMap);

// Utility to create baseline heart rate characteristics per user/device
function baselineForDevice(deviceId) {
  // Deterministic seed based on device id for reproducibility
  const seed = parseInt(deviceId, 10) % 17; // widen range a bit
  // Center base near moderate intensity (we will shape phases around this)
  const base = 102 + seed; // 102-118
  const variability = 12 + (seed % 7); // 12-18 bpm jitter envelope
  const intensityScale = 0.9 + (seed % 5) * 0.05; // 0.9 - 1.1 range
  const phaseShiftSec = (seed * 7) % 90; // 0-89s offset so curves de-sync
  const surgeEvery = 50 + (seed % 6) * 20; // 50-150s surge cadence
  return { baseHeartRate: base, variability, intensityScale, phaseShiftSec, surgeEvery };
}

// Parse optional counts
// Arg 1 (index 2): HR users count  e.g. `node simulation.mjs 2`
// Arg 2 (index 3): RPM devices count e.g. `node simulation.mjs 2 3`
function parseCountArg(idx) {
  const arg = process.argv[idx];
  if (!arg) return null; // null means "all"
  const n = parseInt(arg, 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

const requestedHrCount = parseCountArg(2);
const requestedRpmCount = parseCountArg(3);

// Create device list dynamically (heart rate + cadence only)
const devices = [];

// Build ordered list of HR device IDs (prioritize ones mapped to users)
const hrDeviceIdsAll = Object.keys(hrDevicesConfig);
const hrOwnedIds = hrDeviceIdsAll.filter(id => hrUserMap[String(id)] !== undefined);
const hrUnownedIds = hrDeviceIdsAll.filter(id => hrUserMap[String(id)] === undefined);
let hrDeviceIds = [...hrOwnedIds, ...hrUnownedIds];
if (requestedHrCount !== null) {
  if (requestedHrCount < hrDeviceIds.length) {
    console.log(`🔧 Limiting heart rate users to ${requestedHrCount} of ${hrDeviceIds.length} (argument provided).`);
  }
  hrDeviceIds = hrDeviceIds.slice(0, requestedHrCount);
}

// Build cadence (RPM) device id list and optionally limit
const cadenceDeviceIdsAll = Object.keys(cadenceDevicesConfig);
let cadenceDeviceIds = [...cadenceDeviceIdsAll];
if (requestedRpmCount !== null) {
  if (requestedRpmCount < cadenceDeviceIds.length) {
    console.log(`🔧 Limiting RPM devices to ${requestedRpmCount} of ${cadenceDeviceIds.length} (argument provided).`);
  }
  cadenceDeviceIds = cadenceDeviceIds.slice(0, requestedRpmCount);
}

hrDeviceIds.forEach(id => {
  const { baseHeartRate, variability, intensityScale, phaseShiftSec, surgeEvery } = baselineForDevice(id);
  devices.push({
    deviceId: Number(id),
    profile: 'HR',
    type: 'heart_rate',
    serialNumber: Number(id),
    baseHeartRate,
    variability,
    intensityScale,
    phaseShiftSec,
    surgeEvery,
    batteryLevel: 80,
    beatCount: 0,
    owner: hrUserMap[String(id)],
    color: hrDevicesConfig[id]
  });
});

// Cadence (RPM) devices
cadenceDeviceIds.forEach(id => {
  devices.push({
    deviceId: Number(id),
    profile: 'CAD',
    type: 'cadence',
    serialNumber: Number(id),
    baseCadence: 80,
    cadenceVariability: 8,
    batteryLevel: 75,
    revolutionCount: 0
  });
});
console.log('🧪 Loaded config devices:', devices.map(d => ({ id: d.deviceId, type: d.type, owner: d.owner || null })));
if (requestedHrCount !== null) {
  const hrSimCount = devices.filter(d => d.type === 'heart_rate').length;
  console.log(`👥 Heart rate user simulation count: ${hrSimCount}`);
}
if (requestedRpmCount !== null) {
  const rpmSimCount = devices.filter(d => d.type === 'cadence').length;
  console.log(`⚙️  RPM device simulation count: ${rpmSimCount}`);
}

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
    // Four phase waveform to span 95-180 bpm range
    const phaseDur = 45; // seconds
    const shiftedSeconds = elapsedSeconds + (device.phaseShiftSec || 0);
    const phase = Math.floor(shiftedSeconds / phaseDur) % 4; // 0..3
    let target;
    switch (phase) {
      case 0: { // Warm-up: 95 -> 125
        const t = Math.min(shiftedSeconds, phaseDur) / phaseDur; // 0..1
        target = 95 + t * 30; // 95-125
        break; }
      case 1: { // Build: 125 -> 155
        const t = (shiftedSeconds - phaseDur) / phaseDur;
        target = 125 + t * 30; // 125-155
        break; }
      case 2: { // Peak oscillation: 160 +/- 20 (160->180->160)
        const t = (shiftedSeconds - 2 * phaseDur) / phaseDur; // 0..1
        target = 160 + Math.sin(t * Math.PI) * 20; // 160-180-160
        break; }
      case 3:
      default: { // Cooldown: 150 -> 110
        const t = (shiftedSeconds - 3 * phaseDur) / phaseDur; // 0..1
        target = 150 - t * 40; // 150-110
        break; }
    }
    // Apply device-specific intensity and base to differentiate curves
    target *= device.intensityScale || 1;
    target += (device.baseHeartRate - 110) * 0.5; // shift +/- a bit more

    // Inject occasional surges unique per device
    if (device.surgeEvery && device.surgeEvery > 0 && (Math.floor(shiftedSeconds) % device.surgeEvery) === 0) {
      target += 10 + (device.baseHeartRate % 6); // brief surge
    }
    const variation = (Math.random() - 0.5) * device.variability; // jitter
    let heartRate = Math.round(target + variation);
    if (heartRate < 95) heartRate = 95;
    if (heartRate > 180) heartRate = 180;
    
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
    const cadence = Math.max(0, Math.round(targetCadence + variation)); // Allow zero for inactive periods
    device.revolutionCount += Math.round(cadence / 30); // approx over 2s
    const eventTime = (elapsedSeconds * 1024) % 65536;
    const updateTime = Date.now();
    
    // Generate dummy Buffer data similar to real device
    const rawDataArray = Array(24).fill(0).map(() => Math.floor(Math.random() * 256));
    
    return {
      ManId: 255,
      SerialNumber: device.serialNumber,
      BatteryStatus: "Invalid", // Match real device format
      DeviceID: device.deviceId,
      _UpdateTime: updateTime,
      CalculatedCadence: cadence,
      Channel: 0,
      _RawData: {
        type: "Buffer",
        data: rawDataArray
      },
      CadenceEventTime: eventTime,
      CumulativeCadenceRevolutionCount: device.revolutionCount
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
