/**
 * BLE (Bluetooth Low Energy) Manager
 * Handles Bluetooth devices with pluggable decoders
 */

import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { readFileSync } from 'fs';
import { RenphoJumpropeDecoder } from './decoders/jumprope.mjs';
import { BleHeartRateDecoder } from './decoders/heart_rate.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load BLE devices configuration
let KNOWN_DEVICES = {};
try {
  const configPath = join(__dirname, '../config/ble-devices.json');
  KNOWN_DEVICES = JSON.parse(readFileSync(configPath, 'utf-8'));
  console.log(`✅ Loaded ${Object.keys(KNOWN_DEVICES).length} BLE device configuration(s)`);
} catch (error) {
  console.warn('⚠️  Could not load BLE device config:', error.message);
  // Fallback to hardcoded config
  KNOWN_DEVICES = {
    RENPHO_JUMPROPE: {
      name: 'R-Q008',
      address: '2B929968-AD91-44F5-ABCC-EB52B324CAF3',
      characteristic: '00005303-0000-0041-4c50-574953450000',
      type: 'jumprope'
    }
  };
}

// Map device types to their decoders
const DECODER_MAP = {
  'jumprope': RenphoJumpropeDecoder,
  'heart_rate': BleHeartRateDecoder
};

export class BLEManager {
  constructor(broadcastCallback) {
    this.devices = new Map(); // Map of device address -> device info
    this.activeMonitors = new Map(); // Map of device address -> python process
    this.decoders = new Map(); // Map of device address -> decoder
    this.broadcastCallback = broadcastCallback;
    this.initialized = false;

    // HR scan mode state
    this.hrScanProcess = null;
    this.hrDecoders = new Map();   // userId -> BleHeartRateDecoder
    this.hrMatched = new Map();    // deviceAddress -> userId
    this.bleUsers = [];            // configured BLE HR users
  }

  async initialize() {
    console.log('🔍 Initializing BLE devices...');
    
    try {
      // Check if Bluetooth is available
      const { exec } = await import('child_process');
      const { promisify } = await import('util');
      const execAsync = promisify(exec);
      
      try {
        const { stdout } = await execAsync('hciconfig 2>/dev/null || echo "no-hci"');
        if (stdout.includes('no-hci')) {
          console.log('⚠️  No Bluetooth adapter found');
          return false;
        }
        console.log('✅ Bluetooth adapter detected');
      } catch (error) {
        console.log('⚠️  Could not check Bluetooth status:', error.message);
      }

      // Check if bleak is available
      try {
        const { stdout } = await execAsync('python3 -c "import bleak" 2>&1');
        console.log('✅ Python bleak library available');
        this.initialized = true;
        return true;
      } catch (error) {
        console.log('❌ Python bleak library not installed');
        console.log('💡 Install with: pip3 install bleak');
        return false;
      }
    } catch (error) {
      console.log('❌ BLE initialization failed:', error.message);
      return false;
    }
  }

  async startMonitoring(deviceKey = 'RENPHO_JUMPROPE') {
    const deviceConfig = KNOWN_DEVICES[deviceKey];
    if (!deviceConfig) {
      console.error(`❌ Unknown device: ${deviceKey}`);
      return false;
    }

    if (this.activeMonitors.has(deviceConfig.address)) {
      console.log(`⚠️  Already monitoring ${deviceConfig.name}`);
      return true;
    }

    console.log(`📱 Starting BLE monitor for ${deviceConfig.name}...`);

    // Get the appropriate decoder for this device type
    const DecoderClass = DECODER_MAP[deviceConfig.type];
    if (!DecoderClass) {
      console.error(`❌ No decoder found for device type: ${deviceConfig.type}`);
      return false;
    }

    const decoder = new DecoderClass();
    this.decoders.set(deviceConfig.address, decoder);

    const pythonScript = this.generateMonitorScript(deviceConfig);
    
    const pythonProcess = spawn('python3', ['-c', pythonScript], {
      stdio: ['pipe', 'pipe', 'pipe']
    });

    let lastStatus = null; // Track last status to avoid spam

    pythonProcess.stdout.on('data', (data) => {
      const lines = data.toString().split('\n').filter(line => line.trim());
      
      lines.forEach(line => {
        try {
          const message = JSON.parse(line);
          // Only log if status changed
          if (message.status !== lastStatus || message.type === 'data') {
            this.handleMessage(deviceConfig.address, message, decoder);
            if (message.status) lastStatus = message.status;
          }
        } catch (error) {
          // Ignore non-JSON output
        }
      });
    });

    pythonProcess.stderr.on('data', (data) => {
      const output = data.toString();
      if (!output.includes('DeprecationWarning')) {
        console.error(`❌ BLE ${deviceConfig.name} error:`, output);
      }
    });

    pythonProcess.on('close', (code) => {
      console.log(`🛑 BLE monitor for ${deviceConfig.name} stopped (code: ${code})`);
      const decoder = this.decoders.get(deviceConfig.address);
      if (decoder && typeof decoder.reset === 'function') {
        decoder.reset();
      }
      this.activeMonitors.delete(deviceConfig.address);
      this.decoders.delete(deviceConfig.address);
    });

    this.activeMonitors.set(deviceConfig.address, pythonProcess);
    this.devices.set(deviceConfig.address, deviceConfig);

    return true;
  }

  generateMonitorScript(deviceConfig) {
    return `
import asyncio
import sys
import json
from datetime import datetime

try:
    from bleak import BleakClient, BleakScanner
except ImportError:
    print(json.dumps({"error": "bleak not installed"}))
    sys.exit(1)

TARGET_ADDRESS = "${deviceConfig.address}"
CHARACTERISTIC_UUID = "${deviceConfig.characteristic}"

async def find_and_monitor_device():
    print(json.dumps({"status": "scanning"}), flush=True)
    
    while True:
        try:
            # Scan for the device
            device = await BleakScanner.find_device_by_address(TARGET_ADDRESS, timeout=5.0)
            
            if not device:
                # Device not found, wait and try again
                print(json.dumps({"status": "waiting", "message": "Device not found, waiting..."}), flush=True)
                await asyncio.sleep(5)
                continue
            
            # Device found, connect to it
            print(json.dumps({"status": "found", "name": device.name}), flush=True)
            
            async with BleakClient(device, timeout=10.0) as client:
                print(json.dumps({"status": "connected"}), flush=True)
                
                def notification_handler(sender, data):
                    output = {
                        "type": "data",
                        "timestamp": datetime.now().isoformat(),
                        "data": list(data)
                    }
                    print(json.dumps(output), flush=True)
                
                await client.start_notify(CHARACTERISTIC_UUID, notification_handler)
                print(json.dumps({"status": "listening"}), flush=True)
                
                # Keep connection alive
                while client.is_connected:
                    await asyncio.sleep(1)
                
                # Connection lost
                print(json.dumps({"status": "disconnected", "message": "Device disconnected, will retry..."}), flush=True)
                
        except Exception as e:
            print(json.dumps({"status": "error", "message": str(e), "retry": True}), flush=True)
            await asyncio.sleep(5)
            continue

if __name__ == "__main__":
    asyncio.run(find_and_monitor_device())
`;
  }

  handleMessage(deviceAddress, message, decoder) {
    if (message.error) {
      console.error('❌ BLE Error:', message.error);
      return;
    }

    if (message.status === 'scanning') {
      console.log('🔍 Scanning for BLE device...');
      return;
    }

    if (message.status === 'waiting') {
      console.log(`⏳ ${message.message}`);
      return;
    }

    if (message.status === 'found') {
      console.log(`✅ Found BLE device: ${message.name || this.devices.get(deviceAddress)?.name}`);
      return;
    }

    if (message.status === 'connected') {
      console.log(`✅ Connected to BLE device: ${this.devices.get(deviceAddress)?.name}`);
      return;
    }

    if (message.status === 'listening') {
      console.log('👂 Listening for BLE data...');
      return;
    }

    if (message.status === 'disconnected') {
      console.log(`⚠️  ${message.message}`);
      return;
    }

    if (message.status === 'error' && message.retry) {
      console.log(`⚠️  BLE error: ${message.message} - retrying...`);
      return;
    }

    if (message.type === 'data') {
      this.handleDeviceData(deviceAddress, message.data, decoder);
    }
  }

  handleDeviceData(deviceAddress, dataArray, decoder) {
    const result = decoder.processPacket(dataArray);

    if (!result) return;

    const now = Date.now();
    const lastLog = this._lastJumpLogTime || 0;
    if (now - lastLog > 1000) {
      this._lastJumpLogTime = now;
      const timestamp = new Date().toISOString().split('T')[1].slice(0, -5);
      console.log(`[${timestamp}] Jumprope: ${result.revolutions} revolutions`);
    }

    const deviceConfig = this.devices.get(deviceAddress);
    const wsData = decoder.formatForWebSocket(deviceConfig);
    if (this.broadcastCallback) {
      this.broadcastCallback(wsData);
    }
  }

  async stopMonitoring(deviceAddress) {
    const process = this.activeMonitors.get(deviceAddress);
    if (process) {
      process.kill();
      this.activeMonitors.delete(deviceAddress);
      this.decoders.delete(deviceAddress);
      console.log(`🛑 Stopped monitoring device: ${deviceAddress}`);
      return true;
    }
    return false;
  }

  configureBleUsers(users) {
    this.bleUsers = users || [];
    console.log(`📋 BLE HR users configured: ${this.bleUsers.join(', ') || 'none'}`);
  }

  async startHRScan() {
    if (this.hrScanProcess) {
      console.log('⚠️  BLE HR scan already running');
      return true;
    }

    if (this.bleUsers.length === 0) {
      console.log('⚠️  No BLE HR users configured');
      return false;
    }

    console.log(`🔍 Starting BLE HR scan for users: ${this.bleUsers.join(', ')}`);

    const pythonScript = this._generateHRScanScript();

    this.hrScanProcess = spawn('python3', ['-c', pythonScript], {
      stdio: ['pipe', 'pipe', 'pipe']
    });

    this.hrScanProcess.stdout.on('data', (data) => {
      const lines = data.toString().split('\n').filter(l => l.trim());
      for (const line of lines) {
        try {
          const msg = JSON.parse(line);
          this._handleHRMessage(msg);
        } catch (e) {
          // ignore non-JSON
        }
      }
    });

    this.hrScanProcess.stderr.on('data', (data) => {
      const output = data.toString();
      if (!output.includes('DeprecationWarning')) {
        console.error('❌ BLE HR scan error:', output.trim());
      }
    });

    this.hrScanProcess.on('close', (code) => {
      console.log(`🛑 BLE HR scan stopped (code: ${code})`);
      this.hrScanProcess = null;
      this.hrDecoders.clear();
      this.hrMatched.clear();
    });

    return true;
  }

  async stopHRScan() {
    if (this.hrScanProcess) {
      this.hrScanProcess.kill();
      this.hrScanProcess = null;
      this.hrDecoders.clear();
      this.hrMatched.clear();
      console.log('🛑 BLE HR scan stopped');
      return true;
    }
    return false;
  }

  _handleHRMessage(msg) {
    if (msg.status) {
      if (msg.status === 'found') {
        console.log(`✅ Found BLE HR device: ${msg.name || msg.address}`);
        this._matchHRDevice(msg.address, msg.name);
      } else if (msg.status === 'connected') {
        console.log(`✅ Connected to BLE HR: ${msg.address}`);
      } else if (msg.status === 'disconnected') {
        const userId = this.hrMatched.get(msg.address);
        if (userId) {
          console.log(`⚠️  BLE HR disconnected: ${userId} (${msg.address})`);
          this.hrMatched.delete(msg.address);
          this.hrDecoders.delete(userId);
        }
      } else if (msg.status === 'scanning') {
        console.log('🔍 Scanning for BLE HR devices...');
      }
      return;
    }

    if (msg.type === 'hr_data') {
      const userId = this.hrMatched.get(msg.address);
      if (!userId) return;

      let decoder = this.hrDecoders.get(userId);
      if (!decoder) {
        decoder = new BleHeartRateDecoder();
        this.hrDecoders.set(userId, decoder);
      }

      const result = decoder.processPacket(msg.data);
      if (!result) return;

      // Throttle logging to once per second per user
      const now = Date.now();
      const logKey = `ble_hr_${userId}`;
      const lastLog = this._lastLogTime?.get(logKey) || 0;
      if (now - lastLog > 1000) {
        if (!this._lastLogTime) this._lastLogTime = new Map();
        this._lastLogTime.set(logKey, now);
        console.log(`BLE HR (${userId}): ${result.hr} bpm`);
      }

      const wsData = decoder.formatForWebSocket(userId);
      if (this.broadcastCallback) {
        this.broadcastCallback(wsData);
      }
    }
  }

  _matchHRDevice(address, name) {
    if (this.hrMatched.has(address)) return;

    const matchedUsers = new Set(this.hrMatched.values());
    const unmatchedUsers = this.bleUsers.filter(u => !matchedUsers.has(u));

    if (unmatchedUsers.length === 0) {
      console.log(`⚠️  BLE HR device ${address} found but all users already matched`);
      return;
    }

    if (unmatchedUsers.length === 1) {
      const userId = unmatchedUsers[0];
      this.hrMatched.set(address, userId);
      console.log(`✅ Matched BLE HR device ${name || address} → ${userId} (auto-assign)`);
      return;
    }

    console.log(`⚠️  BLE HR device ${address} found but ${unmatchedUsers.length} unmatched users — cannot auto-assign`);
  }

  _generateHRScanScript() {
    return `
import asyncio
import sys
import json
from datetime import datetime

try:
    from bleak import BleakClient, BleakScanner
except ImportError:
    print(json.dumps({"error": "bleak not installed"}))
    sys.exit(1)

HR_SERVICE_UUID = "0000180d-0000-1000-8000-00805f9b34fb"
HR_MEASUREMENT_UUID = "00002a37-0000-1000-8000-00805f9b34fb"

connected_devices = set()

async def monitor_device(address, name):
    """Connect to a single HR device and stream data."""
    try:
        print(json.dumps({"status": "connected", "address": address}), flush=True)
        async with BleakClient(address, timeout=15.0) as client:
            def on_hr_data(sender, data):
                output = {
                    "type": "hr_data",
                    "address": address,
                    "timestamp": datetime.now().isoformat(),
                    "data": list(data)
                }
                print(json.dumps(output), flush=True)

            await client.start_notify(HR_MEASUREMENT_UUID, on_hr_data)

            while client.is_connected:
                await asyncio.sleep(1)

    except Exception as e:
        pass
    finally:
        connected_devices.discard(address)
        print(json.dumps({"status": "disconnected", "address": address}), flush=True)

async def scan_and_connect():
    print(json.dumps({"status": "scanning"}), flush=True)

    while True:
        try:
            devices = await BleakScanner.discover(timeout=5.0, service_uuids=[HR_SERVICE_UUID])
            for device in devices:
                if device.address not in connected_devices:
                    connected_devices.add(device.address)
                    print(json.dumps({
                        "status": "found",
                        "address": device.address,
                        "name": device.name
                    }), flush=True)
                    asyncio.create_task(monitor_device(device.address, device.name))
        except Exception as e:
            print(json.dumps({"status": "error", "message": str(e)}), flush=True)

        await asyncio.sleep(10)

if __name__ == "__main__":
    asyncio.run(scan_and_connect())
`;
  }

  async cleanup() {
    console.log('🧹 Cleaning up BLE monitors...');
    if (this.hrScanProcess) {
      this.hrScanProcess.kill();
      this.hrScanProcess = null;
    }
    this.hrDecoders.clear();
    this.hrMatched.clear();
    for (const [address, process] of this.activeMonitors) {
      process.kill();
    }
    this.activeMonitors.clear();
    this.decoders.clear();
    this.devices.clear();
  }

  getStatus() {
    return {
      initialized: this.initialized,
      devices_monitoring: this.activeMonitors.size,
      devices: Array.from(this.devices.values()).map(d => ({
        name: d.name,
        type: d.type,
        address: d.address
      })),
      hr_scan: {
        running: !!this.hrScanProcess,
        configured_users: this.bleUsers,
        matched: Object.fromEntries(this.hrMatched)
      }
    };
  }
}
