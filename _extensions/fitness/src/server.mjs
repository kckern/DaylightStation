import express from 'express';
import WebSocket from 'ws';
import { spawn } from 'child_process';
import { randomUUID } from 'crypto';
import { unlink } from 'fs/promises';
import { fileURLToPath } from 'url';
import { ANTPlusManager } from './ant.mjs';
import { BLEManager } from './ble.mjs';
import { selectSimCandidate } from './unlockSim.mjs';
import { createReaderArbiter } from './readerArbiter.mjs';

// Configuration from environment variables
const PORT = process.env.PORT || 3000;
// Hardware-free fingerprint unlock simulation mode. Unset (or any unrecognized
// value) takes the REAL path: the on-box libfprint helper enrolls/identifies
// against the physical reader.
//   auto-match   → immediately reply matched:true (sim candidate / first)
//   auto-deny    → immediately reply matched:false, reason:'sim-deny'
//   interactive  → hold the request; a CLI resolves it via /fingerprint/* HTTP
const FINGERPRINT_SIM = process.env.FINGERPRINT_SIM || '';
const FINGERPRINT_SIM_ACTIVE = ['auto-match', 'auto-deny', 'interactive'].includes(FINGERPRINT_SIM);

// On-box libfprint helper (sibling of this file) + its template store. The store
// MUST be a persistent bind mount — otherwise enrolled .tpl templates vanish on
// every container recreate. `--store` is a top-level helper arg (precedes the
// subcommand). Both overridable via env for non-standard deployments.
const FINGERPRINT_HELPER = process.env.FINGERPRINT_HELPER
  || fileURLToPath(new URL('./fingerprint_helper.py', import.meta.url));
const FINGERPRINT_STORE = process.env.FINGERPRINT_STORE || '/var/lib/daylight-unlock';

// Spawn the python helper with a subcommand and resolve its single stdout JSON
// object. Progress/prompts arrive on stderr; pass `onStderr` to stream them
// (used to surface enroll capture stages). Rejects only when no JSON is parseable
// (the helper prints `{error}` JSON + exits 1 on handled failures — that resolves).
function runFingerprintHelper(args, { timeoutMs = 30000, onStderr, signal } = {}) {
  return new Promise((resolve, reject) => {
    const fullArgs = [FINGERPRINT_HELPER, '--store', FINGERPRINT_STORE, ...args];
    const child = spawn('python3', fullArgs);
    let stdout = '';
    let stderr = '';
    let stderrLineBuf = '';
    const timer = timeoutMs > 0 ? setTimeout(() => child.kill('SIGTERM'), timeoutMs) : null;

    // Preemption: aborting kills the helper with SIGTERM. The helper catches it,
    // cancels the libfprint scan, closes the reader cleanly, and exits — freeing
    // the device for the preempting scan.
    const onAbort = () => child.kill('SIGTERM');
    if (signal) {
      if (signal.aborted) child.kill('SIGTERM');
      else signal.addEventListener('abort', onAbort, { once: true });
    }

    child.stdout.on('data', (d) => { stdout += d.toString(); });
    child.stderr.on('data', (d) => {
      const text = d.toString();
      stderr += text;
      if (onStderr) {
        stderrLineBuf += text;
        const lines = stderrLineBuf.split('\n');
        stderrLineBuf = lines.pop();
        for (const line of lines) if (line.trim()) onStderr(line.trim());
      }
    });
    child.on('error', (err) => { if (timer) clearTimeout(timer); reject(err); });
    child.on('close', (code) => {
      if (timer) clearTimeout(timer);
      if (signal) signal.removeEventListener('abort', onAbort);
      const out = stdout.trim();
      let parsed = null;
      if (out) {
        const lastLine = out.split('\n').filter(Boolean).pop();
        try { parsed = JSON.parse(lastLine); } catch { /* not JSON */ }
      }
      if (parsed) return resolve(parsed);
      reject(new Error(`helper exited ${code}${stderr ? `: ${stderr.trim().split('\n').pop()}` : ''}`));
    });
  });
}

// Adapt the python identify helper to the arbiter's runScan contract. Resolves
// to a uniform { matched, uuid?, reason? }; a preempt (aborted signal) maps to a
// clean 'preempted' rather than a hard error.
function runIdentifyScan(uuids, { signal }) {
  return runFingerprintHelper(
    ['identify', '--uuids', uuids.join(','), '--timeout', '15'],
    { timeoutMs: 20000, signal },
  )
    .then((result) => (result?.matched && result.uuid
      ? { matched: true, uuid: result.uuid }
      : { matched: false, reason: result?.reason || 'no-match' }))
    .catch((err) => (signal?.aborted
      ? { matched: false, reason: 'preempted' }
      : { matched: false, reason: 'identify-error', error: err.message }));
}

// The single owner of the physical reader. ALL real identify scans go through it
// so an always-armed emergency scan and an on-demand foreground unlock never
// fight over the device — a foreground request preempts an in-flight emergency.
const readerArbiter = createReaderArbiter({ runScan: runIdentifyScan, logger: console });
const DAYLIGHT_HOST = process.env.DAYLIGHT_HOST || 'localhost';
const DAYLIGHT_PORT = process.env.DAYLIGHT_PORT || 3112;
const SERIAL_DEVICE = process.env.SERIAL_DEVICE || '/dev/ttyUSB0';
const TV_ON_COMMAND = process.env.TV_ON_COMMAND || '01 30 41 30 41 30 43 02 43 32 30 33 44 36 30 30 30 31 03 73 0D';
const TV_OFF_COMMAND = process.env.TV_OFF_COMMAND || '01 30 41 30 41 30 43 02 43 32 30 33 44 36 30 30 30 34 03 76 0D';

const app = express();

// Global state
let websocketClient = null;
let reconnectInterval = null;

// Pending interactive unlock requests, keyed by requestId. Only populated when
// FINGERPRINT_SIM === 'interactive': the request is held until a CLI resolves it
// via POST /fingerprint/simulate. Insertion order is preserved, so the "most
// recent" pending request is the last entry.
const pendingUnlockRequests = new Map();

// Send a single bus message ({ topic, ...payload }) to the backend over the WS.
// Deliberately NO `source: 'fitness'` key — that would make the backend
// rebroadcast the message as fitness sensor data; the backend routes purely on
// `topic`. Used for unlock / enroll / delete results + enroll progress.
function sendBus(topic, payload) {
  if (websocketClient && websocketClient.readyState === WebSocket.OPEN) {
    websocketClient.send(JSON.stringify({ topic, ...payload }));
    return true;
  }
  console.error(`❌ Cannot send ${topic} (requestId=${payload?.requestId}): WebSocket not open`);
  return false;
}

// fitness.unlock.result shape, matching Task 2.3 exactly.
function sendUnlockResult(result) {
  return sendBus('fitness.unlock.result', result);
}

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

      // Subscribe to the fingerprint request topics. The backend bus topic-filters
      // by subscription, so without these we'd never receive the requests.
      try {
        for (const topic of ['fitness.unlock.request', 'fitness.enroll.request', 'fitness.fingerprint.delete.request']) {
          websocketClient.send(JSON.stringify({ type: 'bus_command', action: 'subscribe', topic }));
        }
        console.log('🔐 Subscribed to unlock / enroll / delete request topics');
      } catch (error) {
        console.error('❌ Failed to subscribe to fingerprint requests:', error.message);
      }
    });

    websocketClient.on('message', (data) => {
      let message;
      try {
        message = JSON.parse(data);
      } catch (error) {
        console.log('📥 Received raw message:', data.toString());
        return;
      }

      // Fingerprint unlock request: the backend wants this box to identify a
      // finger against the candidate uuids. The FINGERPRINT_SIM env selects a
      // hardware-free simulation path; unset, the real on-box libfprint helper
      // runs against the physical reader.
      if (message.topic === 'fitness.unlock.request') {
        const { requestId, lockName, candidateUuids } = message;
        const candidateCount = Array.isArray(candidateUuids) ? candidateUuids.length : 0;
        console.log(`🔐 Unlock request received (lock=${lockName}, candidates=${candidateCount}, requestId=${requestId}, sim=${FINGERPRINT_SIM || 'off'})`);

        if (FINGERPRINT_SIM === 'auto-match') {
          const chosen = selectSimCandidate(candidateUuids);
          if (chosen) {
            sendUnlockResult({ requestId, matched: true, userId: chosen.username, uuid: chosen.uuid });
            console.log(`🔐 Unlock result sent (sim auto-match, user=${chosen.username}, uuid=${chosen.uuid}) for requestId=${requestId}`);
          } else {
            sendUnlockResult({ requestId, matched: false, reason: 'sim-deny' });
            console.log(`🔐 Unlock result sent (sim auto-match had no candidates → deny) for requestId=${requestId}`);
          }
          return;
        }

        if (FINGERPRINT_SIM === 'auto-deny') {
          sendUnlockResult({ requestId, matched: false, reason: 'sim-deny' });
          console.log(`🔐 Unlock result sent (sim auto-deny) for requestId=${requestId}`);
          return;
        }

        if (FINGERPRINT_SIM === 'interactive') {
          pendingUnlockRequests.set(requestId, {
            requestId,
            candidateUuids: Array.isArray(candidateUuids) ? candidateUuids : [],
            receivedAt: new Date().toISOString()
          });
          console.log(`🔐 Unlock request held for interactive resolution (requestId=${requestId}, pending=${pendingUnlockRequests.size})`);
          return;
        }

        // Real path: ask the on-box libfprint helper to identify a finger against
        // the candidate templates. The matched template's username IS the uuid,
        // which maps back to a user via candidateUuids.
        const uuids = (Array.isArray(candidateUuids) ? candidateUuids : [])
          .map((c) => c?.uuid)
          .filter(Boolean);
        if (uuids.length === 0) {
          sendUnlockResult({ requestId, matched: false, reason: 'no-candidates' });
          console.log(`🔐 Unlock result sent (no candidate uuids) for requestId=${requestId}`);
          return;
        }
        // A foreground unlock (any non-emergency lock) preempts an in-flight
        // emergency scan; emergency / duplicate requests that arrive while the
        // reader is busy come back as reader-busy and the backend re-arms.
        const kind = lockName === 'emergency' ? 'emergency' : 'foreground';
        console.log(`🔐 Submitting ${kind} identify against ${uuids.length} template(s) for requestId=${requestId} …`);
        readerArbiter.submit({ kind, uuids })
          .then((result) => {
            if (result.matched && result.uuid) {
              const chosen = candidateUuids.find((c) => c?.uuid === result.uuid);
              const userId = chosen?.username;
              sendUnlockResult({ requestId, matched: true, userId, uuid: result.uuid });
              console.log(`🔐 Unlock result sent (hardware match, user=${userId}, uuid=${result.uuid}) for requestId=${requestId}`);
            } else {
              const reason = result.reason || 'no-match';
              sendUnlockResult({ requestId, matched: false, reason });
              console.log(`🔐 Unlock result sent (hardware, matched=false, reason=${reason}) for requestId=${requestId}`);
            }
          })
          .catch((err) => {
            sendUnlockResult({ requestId, matched: false, reason: 'identify-error' });
            console.error(`❌ Unlock identify failed for requestId=${requestId}: ${err.message}`);
          });
        return;
      }

      // Enroll request: mint a fresh uuid, capture the finger (6 touches), persist
      // a <uuid>.tpl, and reply with that uuid (the backend writes it to the user's
      // profile.yml). Capture stages are streamed back as enroll progress.
      if (message.topic === 'fitness.enroll.request') {
        const { requestId, finger, username } = message;
        const uuid = randomUUID();
        console.log(`🔐 Enroll request (user=${username}, finger=${finger}, requestId=${requestId}, sim=${FINGERPRINT_SIM || 'off'})`);

        if (FINGERPRINT_SIM_ACTIVE) {
          // Hardware-free: skip the reader, return a fresh uuid as if enrolled.
          sendBus('fitness.enroll.result', { requestId, success: true, uuid });
          console.log(`🔐 Enroll result sent (sim, uuid=${uuid}) for requestId=${requestId}`);
          return;
        }

        runFingerprintHelper(['enroll', '--uuid', uuid, '--finger', finger], {
          timeoutMs: 120000,
          onStderr: (line) => {
            const m = line.match(/capture\s+(\d+)\/(\d+)/i);
            if (m) sendBus('fitness.enroll.progress', { requestId, stage: Number(m[1]), stagesTotal: Number(m[2]) });
          },
        })
          .then((result) => {
            if (result?.enrolled) {
              sendBus('fitness.enroll.result', { requestId, success: true, uuid });
              console.log(`🔐 Enroll result sent (success, uuid=${uuid}) for requestId=${requestId}`);
            } else {
              sendBus('fitness.enroll.result', { requestId, success: false, error: result?.error || 'enroll-failed' });
              console.log(`🔐 Enroll result sent (failed: ${result?.error || 'enroll-failed'}) for requestId=${requestId}`);
            }
          })
          .catch((err) => {
            sendBus('fitness.enroll.result', { requestId, success: false, error: err.message });
            console.error(`❌ Enroll failed for requestId=${requestId}: ${err.message}`);
          });
        return;
      }

      // Delete request: remove the <uuid>.tpl template. Idempotent — a missing
      // template still resolves success so the backend can prune the profile entry.
      if (message.topic === 'fitness.fingerprint.delete.request') {
        const { requestId, uuid } = message;
        console.log(`🔐 Delete request (uuid=${uuid}, requestId=${requestId})`);
        const path = `${FINGERPRINT_STORE}/${uuid}.tpl`;
        unlink(path)
          .then(() => {
            sendBus('fitness.fingerprint.delete.result', { requestId, success: true });
            console.log(`🔐 Delete result sent (removed, uuid=${uuid}) for requestId=${requestId}`);
          })
          .catch((err) => {
            if (err.code === 'ENOENT') {
              sendBus('fitness.fingerprint.delete.result', { requestId, success: true });
              console.log(`🔐 Delete result sent (already absent, uuid=${uuid}) for requestId=${requestId}`);
            } else {
              sendBus('fitness.fingerprint.delete.result', { requestId, success: false, error: err.message });
              console.error(`❌ Delete failed for uuid=${uuid}: ${err.message}`);
            }
          });
        return;
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

// Fingerprint simulation endpoints (FINGERPRINT_SIM=interactive). A CLI calls
// these to resolve a held unlock request without the physical reader.

// Resolve the MOST RECENT pending request and send its fitness.unlock.result.
//   body { match: true, uuid?: <uuid> } → matched with selected candidate
//   body { match: false }               → matched:false, reason:'sim-deny'
app.post('/fingerprint/simulate', (req, res) => {
  if (pendingUnlockRequests.size === 0) {
    return res.status(409).json({ error: 'no-pending-request' });
  }

  // Map preserves insertion order; the last key is the most recent request.
  const requestId = Array.from(pendingUnlockRequests.keys()).pop();
  const pending = pendingUnlockRequests.get(requestId);
  pendingUnlockRequests.delete(requestId);

  const { match, uuid } = req.body || {};

  if (match === true) {
    const chosen = selectSimCandidate(pending.candidateUuids, uuid);
    if (chosen) {
      sendUnlockResult({ requestId, matched: true, userId: chosen.username, uuid: chosen.uuid });
      console.log(`🔐 Interactive simulate → MATCH (user=${chosen.username}, uuid=${chosen.uuid}) for requestId=${requestId}`);
      return res.json({ resolved: requestId, matched: true, userId: chosen.username, uuid: chosen.uuid });
    }
    // match:true requested but the held request carried no candidates.
    sendUnlockResult({ requestId, matched: false, reason: 'sim-deny' });
    console.log(`🔐 Interactive simulate → MATCH requested but no candidates → deny for requestId=${requestId}`);
    return res.json({ resolved: requestId, matched: false, reason: 'sim-deny' });
  }

  sendUnlockResult({ requestId, matched: false, reason: 'sim-deny' });
  console.log(`🔐 Interactive simulate → DENY for requestId=${requestId}`);
  return res.json({ resolved: requestId, matched: false, reason: 'sim-deny' });
});

// Debug visibility into held interactive requests.
app.get('/fingerprint/pending', (req, res) => {
  const pending = Array.from(pendingUnlockRequests.values()).map((p) => ({
    requestId: p.requestId,
    candidateCount: p.candidateUuids.length,
    receivedAt: p.receivedAt
  }));
  res.json({ pending });
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

  // Fetch BLE HR users from DaylightStation fitness config
  try {
    const protocol = DAYLIGHT_PORT == 443 ? 'https' : 'http';
    const configUrl = `${protocol}://${DAYLIGHT_HOST}:${DAYLIGHT_PORT}/api/v1/fitness`;
    const res = await fetch(configUrl);
    const fitnessConfig = await res.json();
    const users = fitnessConfig.ble_users || [];
    if (users.length > 0) {
      bleManager.configureBleUsers(users);
      try {
        await bleManager.startHRScan();
        console.log('✅ BLE HR scan auto-started');
      } catch (error) {
        console.error('❌ BLE HR auto-start failed:', error.message);
      }
    }
  } catch (error) {
    console.log('⚠️  Could not fetch fitness config for BLE HR users:', error.message);
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
