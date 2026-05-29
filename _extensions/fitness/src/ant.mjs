/**
 * ANT+ Device Manager
 * Handles ANT+ USB dongles and sensor scanning for fitness devices
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import { createRequire } from 'module';
import { createCadenceGate } from './cadenceGate.mjs';

const execAsync = promisify(exec);
const require = createRequire(import.meta.url);

export class ANTPlusManager {
  constructor(broadcastCallback) {
    this.devices = new Map(); // Map of device index -> AntDevice
    this.sensors = new Map();
    this.scanInterval = null;
    this.broadcastCallback = broadcastCallback;
    this._lastLogTime = new Map(); // Throttle logging per device

    // Multi-dongle deduplication: when multiple USB dongles receive the same
    // ANT+ broadcast, each fires a 'data' event. Track last broadcast per
    // sensor to skip duplicates within a short window.
    this._lastBroadcast = new Map(); // deviceId-profile -> { ts, hr, cadence, power }
    this._dedupeWindowMs = 50; // Skip duplicates within 50ms

    // Gate cadence on revolution-count advancement so a sensor that holds its
    // last CalculatedCadence after the crank stops reports 0 instead of a stuck value.
    this._cadenceGate = createCadenceGate({ revStaleMs: 2500 });
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
      console.log('💡 ANT+ functionality disabled - continuing without ANT+ monitoring');
      
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

        // Extract key metrics for logging (avoid raw buffer spam)
        const hr = data.ComputedHeartRate ?? data.heartRate ?? null;
        const rawCadence = data.CalculatedCadence ?? data.cadence ?? null;
        const revolutionCount = Number.isFinite(data.CumulativeCadenceRevolutionCount)
          ? data.CumulativeCadenceRevolutionCount
          : null;
        const power = data.InstantaneousPower ?? data.power ?? null;

        // Multi-dongle deduplication: skip if another dongle already sent
        // identical data for this sensor within the dedup window
        const dedupeKey = `${deviceId}-${profile}`;
        const now = Date.now();

        // Revolution-gate the cadence: zero it if the crank has stalled even though
        // the sensor keeps broadcasting a non-zero held CalculatedCadence.
        const cadence = this._cadenceGate.gate(deviceId, {
          calculatedCadence: rawCadence,
          revolutionCount,
          now
        });
        // Make downstream consumers (the app's DeviceManager) see the gated value.
        if (cadence !== null) data.CalculatedCadence = cadence;
        if (rawCadence !== null && rawCadence > 0 && cadence === 0) {
          console.log(`[${timestamp}] ${deviceId} cadence revolution-stall → 0 (was ${Math.round(rawCadence)}, revs=${revolutionCount})`);
        }

        const lastBroadcast = this._lastBroadcast.get(dedupeKey);

        if (lastBroadcast && (now - lastBroadcast.ts) < this._dedupeWindowMs) {
          // Within dedup window - check if data is identical
          if (lastBroadcast.hr === hr &&
              lastBroadcast.cadence === cadence &&
              lastBroadcast.power === power) {
            return; // Skip duplicate from other dongle
          }
        }

        // Update last broadcast tracking
        this._lastBroadcast.set(dedupeKey, { ts: now, hr, cadence, power });

        // Only log meaningful changes (throttle to reduce spam)
        const lastLog = this._lastLogTime.get(dedupeKey) || 0;

        // Log at most once per second per device
        if (now - lastLog > 1000) {
          this._lastLogTime.set(dedupeKey, now);

          // Build compact log line
          const metrics = [];
          if (hr) metrics.push(`HR:${hr}`);
          if (cadence !== null) metrics.push(`CAD:${Math.round(cadence)}`);
          if (revolutionCount !== null) metrics.push(`REV:${revolutionCount}`);
          if (power) metrics.push(`PWR:${power}`);

          if (metrics.length > 0) {
            console.log(`[${timestamp}] ${deviceId} ${profile}: ${metrics.join(' ')}`);
          }
        }

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

  broadcastFitnessData(data) {
    const message = {
      topic: 'fitness',
      source: 'fitness',
      type: data.type || 'ant',
      timestamp: new Date().toISOString(),
      ...data
    };

    // Call the broadcast callback
    if (this.broadcastCallback) {
      this.broadcastCallback(message);
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
    this._lastBroadcast.clear();
    this._lastLogTime.clear();
  }

  getStatus() {
    return {
      initialized: this.devices.size > 0,
      devices_connected: this.devices.size,
      device_indices: Array.from(this.devices.keys()),
      sensors_active: this.sensors.size
    };
  }
}
