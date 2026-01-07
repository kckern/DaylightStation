#!/usr/bin/env node
/**
 * RENPHO Jumprope BLE Monitor
 * Connects to RENPHO R-Q008 jumprope and decodes jump data
 * 
 * Data format discovered:
 * - 0xAD packets (20 bytes): Main workout data
 * - 0xAF packets (8 bytes): Secondary metrics
 */

import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Configuration
const RENPHO_DEVICE_ADDRESS = "2B929968-AD91-44F5-ABCC-EB52B324CAF3";
const RENPHO_DEVICE_NAME = "R-Q008";
const CHARACTERISTIC_UUID = "00005303-0000-0041-4c50-574953450000";

// Workout state
let workoutActive = false;
let sessionStartTime = null;
let lastJumpCount = 0;
let totalJumps = 0;
let lastHeartRate = 0;
let lastUpdateTime = Date.now();

class RenphoJumpropeDecoder {
  constructor() {
    this.sessionData = {
      startTime: null,
      endTime: null,
      totalJumps: 0,
      maxRPM: 0,
      avgRPM: 0,
      rpmReadings: [],
      duration: 0
    };
  }

  decodeMainPacket(data) {
    // Main data packet (0xAD prefix, 20 bytes)
    // Format analysis from captured data:
    // [0]: 0xAD (packet type)
    // [1]: Jump sequence counter (0, 1, 2, 3...)
    // [2-9]: Unknown/flags
    // [10-11]: RPM - rope rotations per minute (little-endian)
    // [14-15]: Total jumps counter (little-endian)
    // [16-17]: Possibly calories or timing
    
    const packetType = data[0];
    const sequenceNum = data[1];
    
    // Extract RPM (bytes 10-11, little-endian)
    const rpm = data[10] | (data[11] << 8);
    
    // Extract jump count (bytes 14-15, little-endian)
    const jumpCount = data[14] | (data[15] << 8);
    
    // Calculate estimated calories (rough estimate: 0.1 cal per jump)
    const estimatedCalories = Math.round(jumpCount * 0.1);
    
    return {
      type: 'main',
      sequenceNum,
      rpm,
      jumpCount,
      estimatedCalories,
      rawHex: Buffer.from(data).toString('hex')
    };
  }

  decodeSecondaryPacket(data) {
    // Secondary packet (0xAF prefix, 8 bytes)
    // Appears to contain checksums or timing data
    const packetType = data[0];
    const sequenceNum = data[1];
    
    return {
      type: 'secondary',
      sequenceNum,
      rawHex: Buffer.from(data).toString('hex')
    };
  }

  decode(data) {
    if (data.length === 0) return null;
    
    const packetType = data[0];
    
    if (packetType === 0xAD && data.length >= 20) {
      return this.decodeMainPacket(data);
    } else if (packetType === 0xAF && data.length >= 8) {
      return this.decodeSecondaryPacket(data);
    }
    
    return null;
  }

  updateSession(decodedData) {
    if (!decodedData || decodedData.type !== 'main') return;
    
    const { rpm, jumpCount } = decodedData;
    
    // Initialize session on first packet
    if (!this.sessionData.startTime) {
      this.sessionData.startTime = new Date().toISOString();
      console.log('\n🏃 Workout session started!');
    }
    
    // Update session data
    this.sessionData.totalJumps = jumpCount;
    
    if (rpm > 0 && rpm < 300) {
      this.sessionData.rpmReadings.push(rpm);
      this.sessionData.maxRPM = Math.max(this.sessionData.maxRPM, rpm);
      
      // Calculate average
      const sum = this.sessionData.rpmReadings.reduce((a, b) => a + b, 0);
      this.sessionData.avgRPM = Math.round(sum / this.sessionData.rpmReadings.length);
    }
    
    // Calculate duration
    if (this.sessionData.startTime) {
      const start = new Date(this.sessionData.startTime);
      this.sessionData.duration = Math.round((Date.now() - start) / 1000);
    }
  }

  formatForWebSocket() {
    // Format data to match the fitness server's expected format
    return {
      topic: 'fitness',
      source: 'fitness',
      type: 'ble_jumprope',
      deviceId: RENPHO_DEVICE_ADDRESS,
      deviceName: RENPHO_DEVICE_NAME,
      timestamp: new Date().toISOString(),
      data: {
        jumps: this.sessionData.totalJumps,
        rpm: this.sessionData.rpmReadings.slice(-1)[0] || 0,
        avgRPM: this.sessionData.avgRPM,
        maxRPM: this.sessionData.maxRPM,
        duration: this.sessionData.duration,
        calories: Math.round(this.sessionData.totalJumps * 0.1)
      }
    };
  }

  printSummary() {
    console.log('\n' + '='.repeat(60));
    console.log('📊 WORKOUT SUMMARY');
    console.log('='.repeat(60));
    console.log(`⏱️  Duration: ${Math.floor(this.sessionData.duration / 60)}m ${this.sessionData.duration % 60}s`);
    console.log(`🦘 Total Jumps: ${this.sessionData.totalJumps}`);
    console.log(`⚡ RPM: Avg ${this.sessionData.avgRPM} rpm, Max ${this.sessionData.maxRPM} rpm`);
    console.log(`🔥 Estimated Calories: ${Math.round(this.sessionData.totalJumps * 0.1)}`);
    console.log('='.repeat(60) + '\n');
  }
}

// Python BLE monitor script embedded
const pythonScript = `
import asyncio
import sys
import json
from datetime import datetime

try:
    from bleak import BleakClient
except ImportError:
    print(json.dumps({"error": "bleak not installed"}))
    sys.exit(1)

TARGET_ADDRESS = "${RENPHO_DEVICE_ADDRESS}"
CHARACTERISTIC_UUID = "${CHARACTERISTIC_UUID}"

async def monitor_jumprope():
    try:
        async with BleakClient(TARGET_ADDRESS, timeout=10.0) as client:
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
            
            # Run indefinitely
            while True:
                await asyncio.sleep(1)
                
    except Exception as e:
        print(json.dumps({"error": str(e)}), flush=True)
        sys.exit(1)

if __name__ == "__main__":
    asyncio.run(monitor_jumprope())
`;

class RenphoMonitor {
  constructor() {
    this.decoder = new RenphoJumpropeDecoder();
    this.pythonProcess = null;
    this.lastPrintTime = 0;
    this.printInterval = 1000; // Print every 1 second max
  }

  async start() {
    console.log('🔍 Starting RENPHO Jumprope Monitor...');
    console.log(`📱 Device: ${RENPHO_DEVICE_NAME} (${RENPHO_DEVICE_ADDRESS})`);
    console.log('💡 Make sure your jumprope is turned on and nearby\n');

    // Find Python in venv or system
    const pythonPaths = [
      join(__dirname, '../../../.venv/bin/python'),
      'python3',
      'python'
    ];

    let pythonCmd = pythonPaths[0];
    
    console.log(`🐍 Using Python: ${pythonCmd}`);
    console.log('🔌 Connecting to jumprope...\n');

    this.pythonProcess = spawn(pythonCmd, ['-c', pythonScript], {
      stdio: ['pipe', 'pipe', 'pipe']
    });

    this.pythonProcess.stdout.on('data', (data) => {
      const lines = data.toString().split('\n').filter(line => line.trim());
      
      lines.forEach(line => {
        try {
          const message = JSON.parse(line);
          this.handleMessage(message);
        } catch (error) {
          console.log('📝 Raw output:', line);
        }
      });
    });

    this.pythonProcess.stderr.on('data', (data) => {
      const output = data.toString();
      if (!output.includes('DeprecationWarning')) {
        console.error('❌ Python error:', output);
      }
    });

    this.pythonProcess.on('close', (code) => {
      if (code !== 0) {
        console.error(`\n❌ Python process exited with code ${code}`);
      }
      
      if (this.decoder.sessionData.startTime) {
        this.decoder.printSummary();
      }
      
      process.exit(code);
    });

    // Handle termination
    process.on('SIGINT', () => {
      console.log('\n\n🛑 Stopping monitor...');
      if (this.pythonProcess) {
        this.pythonProcess.kill();
      }
    });
  }

  handleMessage(message) {
    if (message.error) {
      console.error('❌ Error:', message.error);
      return;
    }

    if (message.status === 'connected') {
      console.log('✅ Connected to RENPHO jumprope!');
      return;
    }

    if (message.status === 'listening') {
      console.log('👂 Listening for jump data...');
      console.log('🦘 Start jumping to see live data!\n');
      return;
    }

    if (message.type === 'data') {
      this.handleJumpData(message.data);
    }
  }

  handleJumpData(dataArray) {
    const decoded = this.decoder.decode(dataArray);
    
    if (!decoded) return;

    // Only process and print main packets
    if (decoded.type === 'main') {
      this.decoder.updateSession(decoded);
      
      // Throttle console output
      const now = Date.now();
      if (now - this.lastPrintTime >= this.printInterval) {
        this.printLiveStats(decoded);
        this.lastPrintTime = now;
      }
      
      // This is where we would send to WebSocket
      // const wsData = this.decoder.formatForWebSocket();
      // console.log('\n📤 WebSocket data:', JSON.stringify(wsData, null, 2));
    }
  }

  printLiveStats(decoded) {
    const { jumpCount, rpm, estimatedCalories } = decoded;
    const { duration, avgRPM } = this.decoder.sessionData;
    
    const minutes = Math.floor(duration / 60);
    const seconds = duration % 60;
    const timeStr = `${minutes}:${seconds.toString().padStart(2, '0')}`;
    
    // Clear previous line and print new stats
    process.stdout.write('\r\x1b[K');
    process.stdout.write(
      `⏱️  ${timeStr} | ` +
      `🦘 Jumps: ${jumpCount.toString().padStart(4)} | ` +
      `⚡ RPM: ${rpm.toString().padStart(3)} (avg ${avgRPM}) | ` +
      `🔥 ${estimatedCalories} cal`
    );
  }
}

// Main execution
const monitor = new RenphoMonitor();
monitor.start().catch(error => {
  console.error('💥 Fatal error:', error);
  process.exit(1);
});
