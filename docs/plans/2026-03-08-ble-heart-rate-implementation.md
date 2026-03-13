# BLE Heart Rate Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Enable BLE heart rate monitors (Apple Watch, Polar, etc.) to appear on the fitness dashboard alongside ANT+ HR devices, starting with grannie's Apple Watch.

**Architecture:** A scan-based BLE HR mode in the existing `BLEManager` discovers any device advertising HR Service 0x180D, connects, subscribes to characteristic 0x2A37, decodes BPM via a new `BleHeartRateDecoder`, and broadcasts as `type: 'ant', profile: 'HR'` so the frontend handles it identically to ANT+ HR. Best-effort user matching assigns discovered devices to configured `ble_users`.

**Tech Stack:** Node.js (ESM), Python bleak (BLE scanning subprocess), GATT HR Measurement 0x2A37, WebSocket broadcast.

**Reference doc:** `docs/reference/fitness/ble-heart-rate.md`

---

### Task 1: Create BleHeartRateDecoder

**Files:**
- Create: `_extensions/fitness/src/decoders/heart_rate.mjs`

**Step 1: Write the decoder**

Follow the same interface as `RenphoJumpropeDecoder`: `processPacket()`, `formatForWebSocket()`, `reset()`.

```javascript
/**
 * BLE Heart Rate Measurement Decoder (GATT 0x2A37)
 *
 * Parses standard BLE HR Measurement characteristic packets.
 * Spec: https://www.bluetooth.com/specifications/gatt/characteristics/
 *
 * Packet format:
 *   Byte 0: Flags
 *     - Bit 0: HR format (0 = UINT8, 1 = UINT16)
 *     - Bits 1-2: Sensor contact status
 *   Byte 1 (or 1-2): Heart rate value
 *   Remaining: RR-intervals (optional, ignored)
 */
export class BleHeartRateDecoder {
  constructor() {
    this.lastHR = 0;
    this.sensorContact = false;
    this.lastPacketTime = null;
  }

  /**
   * Process a raw BLE HR Measurement packet
   * @param {number[]} data - Raw byte array from GATT notification
   * @returns {{ hr: number, sensorContact: boolean, timestamp: string } | null}
   */
  processPacket(data) {
    if (!data || data.length < 2) return null;

    const flags = data[0];
    const isUint16 = flags & 0x01;
    const sensorContactSupported = (flags >> 1) & 0x01;
    const sensorContactDetected = (flags >> 2) & 0x01;

    let hr;
    if (isUint16) {
      if (data.length < 3) return null;
      hr = data[1] | (data[2] << 8); // little-endian UINT16
    } else {
      hr = data[1]; // UINT8
    }

    // Ignore zero or absurd readings
    if (hr === 0 || hr > 250) return null;

    this.lastHR = hr;
    this.sensorContact = sensorContactSupported ? !!sensorContactDetected : true;
    this.lastPacketTime = Date.now();

    return {
      hr: this.lastHR,
      sensorContact: this.sensorContact,
      timestamp: new Date().toISOString()
    };
  }

  /**
   * Format for WebSocket broadcast — matches ANT+ HR shape exactly
   * @param {string} userId - Matched user ID (e.g., 'grannie')
   */
  formatForWebSocket(userId) {
    return {
      topic: 'fitness',
      source: 'fitness',
      type: 'ant',
      profile: 'HR',
      deviceId: `ble_${userId}`,
      timestamp: new Date().toISOString(),
      data: {
        ComputedHeartRate: this.lastHR,
        sensorContact: this.sensorContact,
        source: 'ble'
      }
    };
  }

  reset() {
    this.lastHR = 0;
    this.sensorContact = false;
    this.lastPacketTime = null;
  }
}
```

**Step 2: Commit**

```bash
git add _extensions/fitness/src/decoders/heart_rate.mjs
git commit -m "feat(fitness): add BLE heart rate measurement decoder (GATT 0x2A37)"
```

---

### Task 2: Add HR Scan Mode to BLEManager

**Files:**
- Modify: `_extensions/fitness/src/ble.mjs`

This is the core change. The existing `BLEManager` only does address-based connections (jumprope). HR needs scan-based discovery: find any device advertising HR Service 0x180D, connect, subscribe to 0x2A37, match to configured `ble_users`.

**Step 1: Add imports and HR scan state**

At the top of `ble.mjs`, add the heart rate decoder import alongside the existing jumprope import:

```javascript
import { BleHeartRateDecoder } from './decoders/heart_rate.mjs';
```

Add to the `DECODER_MAP`:

```javascript
const DECODER_MAP = {
  'jumprope': RenphoJumpropeDecoder,
  'heart_rate': BleHeartRateDecoder
};
```

**Step 2: Add HR scan properties to constructor**

Add these properties inside the existing `constructor()`:

```javascript
    // HR scan mode state
    this.hrScanProcess = null;
    this.hrDecoders = new Map();   // userId -> BleHeartRateDecoder
    this.hrMatched = new Map();    // deviceAddress -> userId
    this.bleUsers = [];            // configured BLE HR users
```

**Step 3: Add `configureBleUsers()` method**

```javascript
  configureBleUsers(users) {
    this.bleUsers = users || [];
    console.log(`📋 BLE HR users configured: ${this.bleUsers.join(', ') || 'none'}`);
  }
```

**Step 4: Add `startHRScan()` method**

This spawns a Python bleak subprocess that scans for 0x180D advertisers, connects, subscribes to 0x2A37, and outputs JSON lines.

```javascript
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
```

**Step 5: Add `stopHRScan()` method**

```javascript
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
```

**Step 6: Add `_handleHRMessage()` method**

```javascript
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
```

**Step 7: Add `_matchHRDevice()` method**

Best-effort matching: known name match first, then single-unmatched auto-assign.

```javascript
  _matchHRDevice(address, name) {
    if (this.hrMatched.has(address)) return;

    // Find unmatched users (not yet assigned to any device)
    const matchedUsers = new Set(this.hrMatched.values());
    const unmatchedUsers = this.bleUsers.filter(u => !matchedUsers.has(u));

    if (unmatchedUsers.length === 0) {
      console.log(`⚠️  BLE HR device ${address} found but all users already matched`);
      return;
    }

    // Single unmatched user + unmatched device → auto-assign
    if (unmatchedUsers.length === 1) {
      const userId = unmatchedUsers[0];
      this.hrMatched.set(address, userId);
      console.log(`✅ Matched BLE HR device ${name || address} → ${userId} (auto-assign)`);
      return;
    }

    // Multiple unmatched users — can't auto-assign
    console.log(`⚠️  BLE HR device ${address} found but ${unmatchedUsers.length} unmatched users — cannot auto-assign`);
  }
```

**Step 8: Add `_generateHRScanScript()` method**

Python script that scans for 0x180D, connects, subscribes to 0x2A37:

```javascript
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
```

**Step 9: Update `getStatus()` to include HR scan info**

Replace existing `getStatus()`:

```javascript
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
```

**Step 10: Update `cleanup()` to stop HR scan**

Add to existing `cleanup()` method, before the final clears:

```javascript
    if (this.hrScanProcess) {
      this.hrScanProcess.kill();
      this.hrScanProcess = null;
    }
    this.hrDecoders.clear();
    this.hrMatched.clear();
```

**Step 11: Commit**

```bash
git add _extensions/fitness/src/ble.mjs
git commit -m "feat(fitness): add BLE HR scan mode with auto user matching"
```

---

### Task 3: Add API Endpoints and Auto-Start

**Files:**
- Modify: `_extensions/fitness/src/server.mjs`

**Step 1: Add `/ble/hr/start` and `/ble/hr/stop` endpoints**

Add after the existing `/ble/stop/:device?` route (~line 167):

```javascript
// BLE HR scan endpoints
app.get('/ble/hr/start', async (req, res) => {
  console.log('📱 Starting BLE HR scan');
  const result = await bleManager.startHRScan();
  res.json({ success: result, users: bleManager.bleUsers });
});

app.get('/ble/hr/stop', async (req, res) => {
  console.log('📱 Stopping BLE HR scan');
  const result = await bleManager.stopHRScan();
  res.json({ success: result });
});
```

**Step 2: Add BLE HR user config loading and auto-start**

In the `startServer()` function, after the existing BLE initialization block (~line 247), add:

```javascript
  // Configure BLE HR users from environment
  const bleHrUsers = process.env.BLE_HR_USERS;
  if (bleHrUsers) {
    const users = bleHrUsers.split(',').map(u => u.trim()).filter(Boolean);
    bleManager.configureBleUsers(users);
    // Auto-start HR scan if users configured
    if (users.length > 0) {
      try {
        await bleManager.startHRScan();
        console.log('✅ BLE HR scan auto-started');
      } catch (error) {
        console.error('❌ BLE HR auto-start failed:', error.message);
      }
    }
  }
```

**Step 3: Commit**

```bash
git add _extensions/fitness/src/server.mjs
git commit -m "feat(fitness): add BLE HR API endpoints and auto-start"
```

---

### Task 4: Create HR Simulator

**Files:**
- Create: `_extensions/fitness/simulation-heartrate.mjs`

A standalone script that sends HR data via WebSocket, bypassing BLE. For testing without hardware.

```javascript
#!/usr/bin/env node

/**
 * BLE Heart Rate Simulator
 * Sends simulated HR data via WebSocket for testing without hardware.
 *
 * Usage:
 *   node _extensions/fitness/simulation-heartrate.mjs --duration=60 --user=grannie --resting=72
 */

import WebSocket from 'ws';

const args = Object.fromEntries(
  process.argv.slice(2)
    .filter(a => a.startsWith('--'))
    .map(a => { const [k, v] = a.slice(2).split('='); return [k, v]; })
);

const USER_ID = args.user || 'grannie';
const DURATION_S = parseInt(args.duration || '120', 10);
const RESTING_HR = parseInt(args.resting || '72', 10);
const HOST = args.host || process.env.DAYLIGHT_HOST || 'localhost';
const PORT = args.port || process.env.DAYLIGHT_PORT || '3111';

const protocol = PORT === '443' ? 'wss' : 'ws';
const wsUrl = `${protocol}://${HOST}:${PORT}/ws`;

console.log(`💓 HR Simulator: user=${USER_ID}, duration=${DURATION_S}s, resting=${RESTING_HR}`);
console.log(`🔗 Connecting to ${wsUrl}`);

const ws = new WebSocket(wsUrl);
let elapsed = 0;

ws.on('open', () => {
  console.log('✅ Connected');

  const interval = setInterval(() => {
    elapsed += 2;
    if (elapsed > DURATION_S) {
      console.log('⏱️  Duration reached, stopping');
      clearInterval(interval);
      ws.close();
      return;
    }

    // Simulate a workout curve: ramp up, sustain, cool down
    const progress = elapsed / DURATION_S;
    let targetHR;
    if (progress < 0.2) {
      // Warm up: resting → resting+40
      targetHR = RESTING_HR + (40 * (progress / 0.2));
    } else if (progress < 0.7) {
      // Working: resting+40 → resting+60
      const workProgress = (progress - 0.2) / 0.5;
      targetHR = RESTING_HR + 40 + (20 * workProgress);
    } else {
      // Cool down: resting+60 → resting+10
      const coolProgress = (progress - 0.7) / 0.3;
      targetHR = RESTING_HR + 60 - (50 * coolProgress);
    }

    // Add some noise
    const hr = Math.round(targetHR + (Math.random() - 0.5) * 6);

    const message = {
      topic: 'fitness',
      source: 'fitness',
      type: 'ant',
      profile: 'HR',
      deviceId: `ble_${USER_ID}`,
      timestamp: new Date().toISOString(),
      data: {
        ComputedHeartRate: hr,
        sensorContact: true,
        source: 'ble'
      }
    };

    ws.send(JSON.stringify(message));
    console.log(`💓 ${USER_ID}: ${hr} bpm (${Math.round(progress * 100)}%)`);
  }, 2000);
});

ws.on('error', (err) => {
  console.error('❌ WebSocket error:', err.message);
  process.exit(1);
});

ws.on('close', () => {
  console.log('👋 Disconnected');
  process.exit(0);
});
```

**Step 2: Commit**

```bash
git add _extensions/fitness/simulation-heartrate.mjs
git commit -m "feat(fitness): add BLE HR simulator for testing without hardware"
```

---

### Task 5: Update Docker Compose for BLE HR

**Files:**
- Modify: `_extensions/fitness/docker-compose.yaml`

**Step 1: Add BLE_HR_USERS environment variable**

Add to the environment section:

```yaml
      - BLE_HR_USERS=grannie
```

**Step 2: Commit**

```bash
git add _extensions/fitness/docker-compose.yaml
git commit -m "feat(fitness): configure BLE HR users in docker-compose"
```

---

### Task 6: Verify with Simulator

**Step 1: Run the HR simulator**

```bash
node _extensions/fitness/simulation-heartrate.mjs --duration=30 --user=grannie
```

Expected: HR values appear in WebSocket stream, frontend shows grannie's heart rate card with purple color.

**Step 2: Verify frontend rendering**

Open fitness dashboard. Grannie should appear as a participant with a purple HR card showing the simulated BPM values.

---

## Notes

- **No frontend changes needed** — BLE HR messages use `type: 'ant', profile: 'HR'` with `data.ComputedHeartRate`, so `DeviceEventRouter` handles them identically to ANT+ HR
- **Config already updated** — `fitness.yml` in the container already has `ble_users: [grannie]`, `ble_grannie` device mapping, and purple color
- **Real device testing** — Apple Watch must have an active Workout session to broadcast HR over BLE. The fitness container needs Bluetooth access (privileged mode, host network, dbus mounts)
