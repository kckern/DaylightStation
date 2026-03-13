# BLE Heart Rate Support Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Allow Apple Watch users (starting with grannie) to participate in fitness sessions via BLE heart rate monitoring alongside existing ANT+ users.

**Architecture:** A new `BleHeartRateDecoder` parses standard GATT HR Measurement (0x2A37). The `BLEManager` gets a scan-based HR discovery mode that finds devices advertising HR Service (0x180D), matches them to configured `ble_users` via best-effort, and broadcasts messages using the same `type: 'ant'` format so the frontend needs zero changes.

**Tech Stack:** Node.js, Python bleak (BLE), existing BLEManager/decoder plugin pattern

---

### Task 1: Create BLE Heart Rate Decoder

**Files:**
- Create: `_extensions/fitness/src/decoders/heart_rate.mjs`

**Step 1: Write the decoder**

The GATT Heart Rate Measurement (0x2A37) characteristic sends:
- Byte 0: Flags (bit 0 = format: 0=UINT8, 1=UINT16; bits 1-2 = sensor contact)
- Byte 1 (or 1-2): Heart rate BPM
- Optional trailing: RR-intervals (not needed for MVP)

```javascript
/**
 * BLE Heart Rate Decoder
 * Parses standard GATT Heart Rate Measurement (0x2A37) packets.
 * Works with any device using the standard BLE HR Service (0x180D):
 * Apple Watch, Polar, Garmin, etc.
 */

export class BleHeartRateDecoder {
  constructor() {
    this.lastHeartRate = null;
    this.lastSensorContact = null;
    this.lastPacketTime = null;
  }

  /**
   * Process a raw BLE Heart Rate Measurement packet
   * @param {number[]} data - Raw bytes from 0x2A37 characteristic
   * @returns {{ heartRate: number, sensorContact: boolean|null, timestamp: string } | null}
   */
  processPacket(data) {
    if (!data || data.length < 2) return null;

    const flags = data[0];

    // Bit 0: HR format (0 = UINT8, 1 = UINT16)
    const isUint16 = (flags & 0x01) === 1;

    // Bits 1-2: Sensor contact
    // Bit 1: sensor contact feature supported
    // Bit 2: sensor contact detected
    const contactSupported = (flags & 0x02) !== 0;
    const contactDetected = (flags & 0x04) !== 0;
    const sensorContact = contactSupported ? contactDetected : null;

    // Parse heart rate value
    let heartRate;
    if (isUint16) {
      if (data.length < 3) return null;
      heartRate = data[1] | (data[2] << 8); // little-endian
    } else {
      heartRate = data[1];
    }

    // Sanity check
    if (heartRate <= 0 || heartRate > 250) return null;

    this.lastHeartRate = heartRate;
    this.lastSensorContact = sensorContact;
    this.lastPacketTime = Date.now();

    return {
      heartRate,
      sensorContact,
      timestamp: new Date().toISOString()
    };
  }

  /**
   * Format for WebSocket broadcast — matches ANT+ HR message shape
   * so the frontend handles it identically (DeviceEventRouter expects type: 'ant')
   * @param {{ deviceId: string, userId: string, deviceName: string }} context
   */
  formatForWebSocket(context) {
    return {
      topic: 'fitness',
      source: 'fitness',
      type: 'ant',  // Same as ANT+ so frontend routes it identically
      profile: 'HR',
      deviceId: context.deviceId,
      timestamp: new Date().toISOString(),
      data: {
        ComputedHeartRate: this.lastHeartRate,
        sensorContact: this.lastSensorContact,
        source: 'ble'  // Metadata only — not used for routing
      }
    };
  }

  reset() {
    this.lastHeartRate = null;
    this.lastSensorContact = null;
    this.lastPacketTime = null;
  }
}
```

**Step 2: Verify file exists and syntax is valid**

Run: `node -e "import('./_extensions/fitness/src/decoders/heart_rate.mjs').then(() => console.log('OK'))"`
Expected: `OK`

**Step 3: Commit**

```bash
git add _extensions/fitness/src/decoders/heart_rate.mjs
git commit -m "feat(fitness): add BLE heart rate decoder for GATT 0x2A37"
```

---

### Task 2: Add BLE HR Scan Mode to BLEManager

**Files:**
- Modify: `_extensions/fitness/src/ble.mjs`

This is the largest change. The existing BLEManager connects to pre-configured device addresses. We need a new scan-based mode that:
1. Scans for any device advertising HR Service UUID 0x180D
2. Connects and subscribes to HR Measurement characteristic 0x2A37
3. Matches discovered devices to `ble_users` config via best-effort
4. Broadcasts HR data using the `BleHeartRateDecoder`

**Step 1: Add imports and constants**

At top of `ble.mjs`, after existing imports (line 10), add:

```javascript
import { BleHeartRateDecoder } from './decoders/heart_rate.mjs';
```

Update the DECODER_MAP (line 35-40) to include heart_rate:

```javascript
const DECODER_MAP = {
  'jumprope': RenphoJumpropeDecoder,
  'heart_rate': BleHeartRateDecoder
};
```

**Step 2: Add HR scan configuration and state to the constructor**

After the existing constructor properties (after line 48), add:

```javascript
    // BLE HR scan state
    this.hrScanProcess = null;
    this.bleHRUsers = [];        // from config: ['grannie']
    this.bleHRDevices = new Map(); // Map of bleDeviceName -> { userId, decoder, deviceId }
```

**Step 3: Add `configureBleUsers` method**

Add this method to the BLEManager class, after `initialize()` (after line 86):

```javascript
  /**
   * Set the list of users expected to connect via BLE HR
   * Called from server.mjs with config from fitness.yml
   * @param {string[]} users - e.g., ['grannie']
   */
  configureBleUsers(users) {
    this.bleHRUsers = users || [];
    console.log(`📋 BLE HR users configured: ${this.bleHRUsers.join(', ') || 'none'}`);
  }
```

**Step 4: Add `startHRScan` method**

Add this method after `configureBleUsers`. This spawns a Python bleak process that scans for HR service advertisers and connects:

```javascript
  /**
   * Start scanning for BLE Heart Rate devices (0x180D service)
   * Connects to any discovered device and streams HR data
   */
  async startHRScan() {
    if (!this.initialized) {
      console.log('⚠️  BLE not initialized, cannot start HR scan');
      return false;
    }

    if (this.bleHRUsers.length === 0) {
      console.log('ℹ️  No BLE HR users configured, skipping HR scan');
      return false;
    }

    if (this.hrScanProcess) {
      console.log('⚠️  BLE HR scan already running');
      return true;
    }

    console.log('🔍 Starting BLE HR scan for devices advertising 0x180D...');

    const pythonScript = this._generateHRScanScript();

    this.hrScanProcess = spawn('python3', ['-c', pythonScript], {
      stdio: ['pipe', 'pipe', 'pipe']
    });

    this.hrScanProcess.stdout.on('data', (data) => {
      const lines = data.toString().split('\n').filter(l => l.trim());
      for (const line of lines) {
        try {
          const msg = JSON.parse(line);
          this._handleHRScanMessage(msg);
        } catch (e) {
          // Ignore non-JSON
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
      // Clear HR device decoders
      for (const [name, info] of this.bleHRDevices) {
        info.decoder.reset();
      }
      this.bleHRDevices.clear();
    });

    return true;
  }
```

**Step 5: Add the Python HR scan script generator**

```javascript
  /**
   * Generate Python script that scans for BLE HR devices,
   * connects to them, and streams HR measurement data as JSON lines.
   */
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

async def connect_and_stream(device):
    """Connect to an HR device and stream measurements."""
    addr = device.address
    name = device.name or "Unknown"
    if addr in connected_devices:
        return
    connected_devices.add(addr)

    print(json.dumps({"status": "connecting", "address": addr, "name": name}), flush=True)

    try:
        async with BleakClient(device, timeout=10.0) as client:
            print(json.dumps({"status": "connected", "address": addr, "name": name}), flush=True)

            def on_hr_data(sender, data):
                print(json.dumps({
                    "type": "hr_data",
                    "address": addr,
                    "name": name,
                    "timestamp": datetime.now().isoformat(),
                    "data": list(data)
                }), flush=True)

            await client.start_notify(HR_MEASUREMENT_UUID, on_hr_data)
            print(json.dumps({"status": "listening", "address": addr, "name": name}), flush=True)

            while client.is_connected:
                await asyncio.sleep(1)

            print(json.dumps({"status": "disconnected", "address": addr, "name": name}), flush=True)
    except Exception as e:
        print(json.dumps({"status": "error", "address": addr, "name": name, "message": str(e)}), flush=True)
    finally:
        connected_devices.discard(addr)

async def scan_loop():
    """Continuously scan for HR devices and connect to new ones."""
    print(json.dumps({"status": "scanning"}), flush=True)

    while True:
        try:
            devices = await BleakScanner.discover(timeout=5.0, service_uuids=[HR_SERVICE_UUID])
            for device in devices:
                if device.address not in connected_devices:
                    print(json.dumps({
                        "status": "found",
                        "address": device.address,
                        "name": device.name or "Unknown"
                    }), flush=True)
                    asyncio.create_task(connect_and_stream(device))
        except Exception as e:
            print(json.dumps({"status": "scan_error", "message": str(e)}), flush=True)

        await asyncio.sleep(10)

if __name__ == "__main__":
    asyncio.run(scan_loop())
`;
  }
```

**Step 6: Add the HR scan message handler**

```javascript
  /**
   * Handle messages from the BLE HR scan Python process.
   * Performs best-effort user matching and broadcasts HR data.
   */
  _handleHRScanMessage(msg) {
    if (msg.error) {
      console.error('❌ BLE HR Error:', msg.error);
      return;
    }

    if (msg.status === 'scanning') {
      console.log('🔍 BLE HR: Scanning for heart rate devices...');
      return;
    }

    if (msg.status === 'found') {
      console.log(`💓 BLE HR: Found device "${msg.name}" (${msg.address})`);
      return;
    }

    if (msg.status === 'connecting') {
      console.log(`🔗 BLE HR: Connecting to "${msg.name}"...`);
      return;
    }

    if (msg.status === 'connected') {
      console.log(`✅ BLE HR: Connected to "${msg.name}" (${msg.address})`);
      // Best-effort user matching
      this._matchHRDeviceToUser(msg.address, msg.name);
      return;
    }

    if (msg.status === 'listening') {
      console.log(`👂 BLE HR: Listening for HR data from "${msg.name}"`);
      return;
    }

    if (msg.status === 'disconnected') {
      console.log(`⚠️  BLE HR: "${msg.name}" disconnected`);
      this.bleHRDevices.delete(msg.name);
      return;
    }

    if (msg.status === 'error' || msg.status === 'scan_error') {
      console.log(`⚠️  BLE HR error: ${msg.message}`);
      return;
    }

    if (msg.type === 'hr_data') {
      this._handleHRData(msg);
    }
  }

  /**
   * Best-effort matching: assign a discovered BLE HR device to an unmatched ble_user.
   * Priority: 1) known device name, 2) only one unmatched device + one unmatched user.
   */
  _matchHRDeviceToUser(address, name) {
    // Already matched?
    if (this.bleHRDevices.has(name)) return;

    // Find unmatched users
    const matchedUserIds = new Set(
      Array.from(this.bleHRDevices.values()).map(d => d.userId)
    );
    const unmatchedUsers = this.bleHRUsers.filter(u => !matchedUserIds.has(u));

    if (unmatchedUsers.length === 0) {
      console.log(`⚠️  BLE HR: No unmatched users for "${name}"`);
      return;
    }

    // Assign first unmatched user (best-effort: works great with 1 BLE user)
    const userId = unmatchedUsers[0];
    const decoder = new BleHeartRateDecoder();
    // Use a stable synthetic deviceId that can be mapped in fitness.yml
    const deviceId = `ble_${userId}`;

    this.bleHRDevices.set(name, { userId, decoder, deviceId, address });
    console.log(`🎯 BLE HR: Matched "${name}" → user "${userId}" (deviceId: ${deviceId})`);
  }

  /**
   * Process incoming HR measurement data and broadcast via WebSocket.
   */
  _handleHRData(msg) {
    const deviceInfo = this.bleHRDevices.get(msg.name);
    if (!deviceInfo) return; // Unmatched device, ignore

    const result = deviceInfo.decoder.processPacket(msg.data);
    if (!result) return;

    const wsData = deviceInfo.decoder.formatForWebSocket({
      deviceId: deviceInfo.deviceId,
      userId: deviceInfo.userId,
      deviceName: msg.name
    });

    // Throttle logging to once per second
    const now = Date.now();
    if (!this._lastHRLogTime || now - this._lastHRLogTime > 1000) {
      this._lastHRLogTime = now;
      console.log(`💓 BLE HR [${deviceInfo.userId}]: ${result.heartRate} BPM`);
    }

    if (this.broadcastCallback) {
      this.broadcastCallback(wsData);
    }
  }
```

**Step 7: Update `stopMonitoring` and `cleanup` to handle HR scan**

In the `cleanup()` method (around line 302-310), add HR scan cleanup:

```javascript
  async cleanup() {
    console.log('🧹 Cleaning up BLE monitors...');
    // Stop HR scan
    if (this.hrScanProcess) {
      this.hrScanProcess.kill();
      this.hrScanProcess = null;
    }
    this.bleHRDevices.clear();
    // Existing cleanup
    for (const [address, process] of this.activeMonitors) {
      process.kill();
    }
    this.activeMonitors.clear();
    this.decoders.clear();
    this.devices.clear();
  }
```

Update `getStatus()` to include HR scan info:

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
        ble_users: this.bleHRUsers,
        matched_devices: Array.from(this.bleHRDevices.entries()).map(([name, info]) => ({
          name,
          userId: info.userId,
          deviceId: info.deviceId
        }))
      }
    };
  }
```

**Step 8: Commit**

```bash
git add _extensions/fitness/src/ble.mjs
git commit -m "feat(fitness): add BLE HR scan mode with best-effort user matching"
```

---

### Task 3: Wire Up BLE HR Scan in Server Startup

**Files:**
- Modify: `_extensions/fitness/src/server.mjs`

**Step 1: Add ble_users config loading and HR scan startup**

In `server.mjs`, the `startServer()` function (line 220) initializes managers. After BLE initialization (around line 243), add HR scan startup.

First, add config loading near the top of the file (after line 11):

```javascript
// Load fitness config for BLE users
let BLE_HR_USERS = [];
try {
  // Config is passed via environment variable or loaded from mounted config
  const bleUsers = process.env.BLE_HR_USERS;
  if (bleUsers) {
    BLE_HR_USERS = bleUsers.split(',').map(u => u.trim()).filter(Boolean);
  }
} catch (e) {
  // Will be configured via API or default to empty
}
```

Then in `startServer()`, after `bleManager.startMonitoring('RENPHO_JUMPROPE')` (line 242), add:

```javascript
      // Configure and start BLE HR scanning
      bleManager.configureBleUsers(BLE_HR_USERS);
      await bleManager.startHRScan();
```

**Step 2: Add API endpoint for BLE HR control**

After the existing BLE endpoints (around line 167), add:

```javascript
app.get('/ble/hr/start', async (req, res) => {
  console.log('💓 Starting BLE HR scan');
  const result = await bleManager.startHRScan();
  res.json({ success: result });
});

app.get('/ble/hr/stop', async (req, res) => {
  console.log('💓 Stopping BLE HR scan');
  if (bleManager.hrScanProcess) {
    bleManager.hrScanProcess.kill();
    bleManager.hrScanProcess = null;
  }
  res.json({ success: true });
});
```

**Step 3: Commit**

```bash
git add _extensions/fitness/src/server.mjs
git commit -m "feat(fitness): wire BLE HR scan into server startup and API"
```

---

### Task 4: Update Docker Compose and Config

**Files:**
- Modify: `_extensions/fitness/docker-compose.yaml` (add BLE_HR_USERS env var)

**Step 1: Add environment variable**

In `docker-compose.yaml`, under `environment:` (after line 27), add:

```yaml
      - BLE_HR_USERS=${BLE_HR_USERS:-grannie}
```

**Step 2: Commit**

```bash
git add _extensions/fitness/docker-compose.yaml
git commit -m "feat(fitness): add BLE_HR_USERS config to docker-compose"
```

---

### Task 5: Update fitness.yml Config (Runtime)

**Files:**
- Modify: `data/household/config/fitness.yml` (inside Docker volume — not in git)

**Step 1: Add ble_users and device mapping**

Add `ble_users` list and a synthetic device ID for grannie to the config. This is done via `docker exec` since it's runtime config:

Under `devices.heart_rate`, add:
```yaml
    ble_grannie: grannie  # BLE Apple Watch (auto-matched)
```

Remove the ANT+ entry `2747: grannie` (unless she still uses the ANT+ strap sometimes).

Add new section:
```yaml
ble_users:
  - grannie
```

Under `device_colors.heart_rate`, add:
```yaml
    ble_grannie: purple   # or whatever color for BLE HR
```

**Step 2: Verify config loads correctly**

Run: `curl -s http://10.0.0.101:3000/status | jq '.ble.hr_scan'`
Expected: Shows `ble_users: ["grannie"]`

---

### Task 6: Create BLE HR Simulator

**Files:**
- Create: `_extensions/fitness/simulation-heartrate.mjs`

**Step 1: Write the simulator**

Model after `simulation-jumprope.mjs`. Sends fake BLE HR data via WebSocket in the same format the BLEManager would produce (after decoding):

```javascript
#!/usr/bin/env node
/**
 * BLE Heart Rate Simulator - Generates realistic HR data
 * Simulates an Apple Watch broadcasting BLE HR during a workout.
 *
 * Usage:
 *   node simulation-heartrate.mjs [options]
 *
 * Options:
 *   --duration=SECONDS  Simulation duration (default: 120)
 *   --user=USER_ID      User to simulate (default: grannie)
 *   --resting=BPM       Resting heart rate (default: 72)
 */

import WebSocket from 'ws';
import fs from 'fs';
import path from 'path';

const __filename = new URL(import.meta.url).pathname;
const rootDir = path.resolve(path.dirname(__filename), '..', '..');

const envPath = path.join(rootDir, '.env');
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, 'utf8');
  envContent.split('\n').forEach(line => {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith('#')) {
      const [key, ...valueParts] = trimmed.split('=');
      if (key && valueParts.length > 0) {
        const value = valueParts.join('=').replace(/^["']|["']$/g, '');
        if (!process.env[key]) process.env[key] = value;
      }
    }
  });
}

const DAYLIGHT_HOST = process.env.DAYLIGHT_HOST || 'localhost';
const DAYLIGHT_PORT = process.env.DAYLIGHT_PORT || 3112;
const UPDATE_INTERVAL = 1000; // HR updates every ~1 second

const durationArg = process.argv.find(a => a.startsWith('--duration='));
const userArg = process.argv.find(a => a.startsWith('--user='));
const restingArg = process.argv.find(a => a.startsWith('--resting='));

const DURATION = (durationArg ? parseInt(durationArg.split('=')[1], 10) : 120) * 1000;
const USER_ID = userArg ? userArg.split('=')[1] : 'grannie';
const RESTING_HR = restingArg ? parseInt(restingArg.split('=')[1], 10) : 72;
const DEVICE_ID = `ble_${USER_ID}`;

const WORKOUT_PHASES = [
  { name: 'warmup',    duration: 20, targetHR: RESTING_HR + 30, variability: 5 },
  { name: 'moderate',  duration: 30, targetHR: RESTING_HR + 50, variability: 8 },
  { name: 'intense',   duration: 20, targetHR: RESTING_HR + 70, variability: 10 },
  { name: 'recovery',  duration: 15, targetHR: RESTING_HR + 30, variability: 5 },
  { name: 'intense',   duration: 20, targetHR: RESTING_HR + 75, variability: 12 },
  { name: 'cooldown',  duration: 15, targetHR: RESTING_HR + 15, variability: 5 }
];

class HRSimulator {
  constructor() {
    this.ws = null;
    this.connected = false;
    this.startTime = null;
    this.interval = null;
    this.currentHR = RESTING_HR;
    this.hrReadings = [];
  }

  async connect() {
    const protocol = DAYLIGHT_PORT == 443 ? 'wss' : 'ws';
    const wsUrl = `${protocol}://${DAYLIGHT_HOST}:${DAYLIGHT_PORT}/ws`;
    console.log(`Connecting to ${wsUrl}`);

    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(wsUrl);
      this.ws.on('open', () => { this.connected = true; resolve(); });
      this.ws.on('error', reject);
    });
  }

  getCurrentPhase(elapsedSec) {
    const total = WORKOUT_PHASES.reduce((s, p) => s + p.duration, 0);
    const t = elapsedSec % total;
    let acc = 0;
    for (const phase of WORKOUT_PHASES) {
      acc += phase.duration;
      if (t < acc) return phase;
    }
    return WORKOUT_PHASES[WORKOUT_PHASES.length - 1];
  }

  generateHR(elapsedSec) {
    const phase = this.getCurrentPhase(elapsedSec);
    // Smooth transition toward target
    this.currentHR += (phase.targetHR - this.currentHR) * 0.1;
    const variation = (Math.random() - 0.5) * phase.variability;
    return Math.round(Math.max(40, Math.min(220, this.currentHR + variation)));
  }

  sendHR() {
    if (!this.connected) return;
    const elapsed = Math.floor((Date.now() - this.startTime) / 1000);
    const hr = this.generateHR(elapsed);
    this.hrReadings.push(hr);

    // Same format as BleHeartRateDecoder.formatForWebSocket()
    const message = {
      topic: 'fitness',
      source: 'fitness-simulator',
      type: 'ant',
      profile: 'HR',
      deviceId: DEVICE_ID,
      timestamp: new Date().toISOString(),
      data: {
        ComputedHeartRate: hr,
        sensorContact: true,
        source: 'ble'
      }
    };

    this.ws.send(JSON.stringify(message));

    if (elapsed % 5 === 0 && this._lastLog !== elapsed) {
      this._lastLog = elapsed;
      const phase = this.getCurrentPhase(elapsed);
      console.log(`[${elapsed}s] ${phase.name}: ${hr} BPM (${USER_ID})`);
    }
  }

  start() {
    console.log(`\nBLE HR Simulator: ${USER_ID} (${DEVICE_ID})`);
    console.log(`Duration: ${DURATION / 1000}s, Resting HR: ${RESTING_HR}\n`);

    this.startTime = Date.now();
    this.interval = setInterval(() => this.sendHR(), UPDATE_INTERVAL);
    setTimeout(() => this.stop(), DURATION);
  }

  stop() {
    clearInterval(this.interval);
    const avg = Math.round(this.hrReadings.reduce((a, b) => a + b, 0) / this.hrReadings.length);
    const max = Math.max(...this.hrReadings);
    console.log(`\nSummary: avg=${avg} BPM, max=${max} BPM, readings=${this.hrReadings.length}`);
    this.ws?.close();
    process.exit(0);
  }
}

const sim = new HRSimulator();
sim.connect().then(() => sim.start()).catch(e => {
  console.error('Failed:', e.message);
  process.exit(1);
});

process.on('SIGINT', () => process.exit(0));
```

**Step 2: Test the simulator**

Run: `cd _extensions/fitness && node simulation-heartrate.mjs --duration=10`
Expected: Connects to WebSocket and streams HR data for 10 seconds, printing phase/BPM updates.

**Step 3: Commit**

```bash
git add _extensions/fitness/simulation-heartrate.mjs
git commit -m "feat(fitness): add BLE heart rate simulator"
```

---

### Task 7: End-to-End Verification

**Step 1: Run simulator and verify frontend shows HR data**

1. Ensure dev server is running (`npm run dev` or check `lsof -i :3112`)
2. Run: `cd _extensions/fitness && node simulation-heartrate.mjs --duration=60 --user=grannie`
3. Open the fitness dashboard in a browser
4. Verify grannie appears as a participant with real-time HR data
5. Verify existing ANT+ users still work (run the ANT+ simulator if needed)

**Step 2: Test with real Apple Watch (when available)**

1. SSH to 10.0.0.101
2. Rebuild and redeploy the fitness container with the new code
3. Have grannie start a workout on Apple Watch (Workout app must be open for HR broadcast)
4. Check fitness controller logs: `docker logs daylight-fitness --tail=50 -f`
5. Verify HR data appears on dashboard

**Step 3: Final commit if any fixes needed**

---

## Notes

- **Apple Watch only broadcasts HR via BLE during an active Workout** — grannie must start a workout on the watch
- **MAC address rotation** — the scan approach handles this since we match by service UUID, not address
- **Multiple BLE HR users** — the best-effort matching works for 1 user. For 2+ simultaneous BLE HR users, device name matching or UI-based claiming would be needed (future enhancement)
- **No frontend changes** — by using `type: 'ant'` and `ComputedHeartRate` in the payload, the existing DeviceEventRouter/DeviceManager handles BLE HR identically to ANT+
