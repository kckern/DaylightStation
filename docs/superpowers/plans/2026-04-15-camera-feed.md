# Camera Feed Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Serve IP camera snapshots and live HLS streams through the backend so any frontend screen can display camera feeds without exposing credentials.

**Architecture:** Proper DDD layering: port interfaces in `3_applications/camera/ports/` define the contracts. `ReolinkCameraAdapter` (vendor-specific) implements `ICameraGateway`. `HlsStreamManager` (generic ffmpeg lifecycle) implements `IStreamAdapter`. `CameraService` in the application layer orchestrates both. The API router talks only to `CameraService`. Frontend gets a reusable `CameraFeed` module; HomeApp is the first consumer.

**Tech Stack:** Node.js (child_process for ffmpeg), Express, ffmpeg (already in container), hls.js (new npm dep), React

**Spec:** `docs/superpowers/specs/2026-04-14-camera-feed-design.md`

---

## File Structure

```
backend/src/
├── 1_adapters/camera/
│   ├── ReolinkCameraAdapter.mjs   # Implements ICameraGateway — Reolink-specific snapshot + stream URLs
│   ├── HlsStreamManager.mjs      # Implements IStreamAdapter — generic ffmpeg RTSP→HLS lifecycle
│   └── index.mjs                 # Exports
│
├── 3_applications/camera/
│   ├── ports/
│   │   ├── ICameraGateway.mjs    # Port: list cameras, fetch snapshot, get stream URL
│   │   ├── IStreamAdapter.mjs    # Port: start/stop/touch HLS streams
│   │   └── index.mjs             # Re-exports
│   ├── CameraService.mjs         # Application service — orchestrates gateway + stream adapter
│   └── index.mjs                 # Factory: createCameraServices()
│
├── 4_api/v1/routers/
│   └── camera.mjs                # Express router — talks only to CameraService
│
frontend/src/modules/CameraFeed/
├── CameraFeed.jsx                # Reusable component (snapshot + live modes)
└── CameraFeed.scss               # Styles
```

No domain layer (`2_domains/camera/`) — there's no pure business logic (no state machines, calculations, or rules). Cameras are config-driven data records.

---

### Task 1: Port interfaces

**Files:**
- Create: `backend/src/3_applications/camera/ports/ICameraGateway.mjs`
- Create: `backend/src/3_applications/camera/ports/IStreamAdapter.mjs`
- Create: `backend/src/3_applications/camera/ports/index.mjs`

- [ ] **Step 1: Create ICameraGateway port**

```javascript
// backend/src/3_applications/camera/ports/ICameraGateway.mjs
/**
 * ICameraGateway Port — camera discovery and snapshot access
 *
 * Abstraction for IP camera communication.
 * Implemented by ReolinkCameraAdapter (and future vendors).
 *
 * @module applications/camera/ports
 */

/**
 * @typedef {Object} CameraInfo
 * @property {string} id - Device ID from devices.yml
 * @property {string} host - Camera IP/hostname
 * @property {string} manufacturer
 * @property {string} model
 * @property {string[]} capabilities - e.g. ['snapshot', 'live']
 * @property {string[]} streams - Available stream names (e.g. ['main', 'sub'])
 * @property {Object} homeassistant - HA entity mappings
 */

/**
 * @typedef {Object} SnapshotResult
 * @property {Buffer} buffer - JPEG image data
 * @property {string} contentType - MIME type
 */

/**
 * Check if object implements ICameraGateway
 * @param {any} obj
 * @returns {boolean}
 */
export function isCameraGateway(obj) {
  return (
    obj !== null &&
    typeof obj === 'object' &&
    typeof obj.listCameras === 'function' &&
    typeof obj.getCamera === 'function' &&
    typeof obj.fetchSnapshot === 'function' &&
    typeof obj.getStreamUrl === 'function'
  );
}

/**
 * Assert that object implements ICameraGateway
 * @param {any} obj
 * @param {string} [context]
 * @throws {Error}
 */
export function assertCameraGateway(obj, context = 'CameraGateway') {
  if (!isCameraGateway(obj)) {
    throw new Error(`${context} must implement ICameraGateway (listCameras, getCamera, fetchSnapshot, getStreamUrl)`);
  }
}

/**
 * Create a no-op camera gateway (for environments without cameras)
 * @returns {Object}
 */
export function createNoOpCameraGateway() {
  return {
    listCameras: () => [],
    getCamera: () => null,
    fetchSnapshot: async () => null,
    getStreamUrl: () => null,
  };
}
```

- [ ] **Step 2: Create IStreamAdapter port**

```javascript
// backend/src/3_applications/camera/ports/IStreamAdapter.mjs
/**
 * IStreamAdapter Port — live video stream lifecycle
 *
 * Abstraction for on-demand video stream transcoding.
 * Implemented by HlsStreamManager (ffmpeg RTSP→HLS).
 *
 * @module applications/camera/ports
 */

/**
 * Check if object implements IStreamAdapter
 * @param {any} obj
 * @returns {boolean}
 */
export function isStreamAdapter(obj) {
  return (
    obj !== null &&
    typeof obj === 'object' &&
    typeof obj.ensureStream === 'function' &&
    typeof obj.touch === 'function' &&
    typeof obj.stop === 'function' &&
    typeof obj.isActive === 'function'
  );
}

/**
 * Assert that object implements IStreamAdapter
 * @param {any} obj
 * @param {string} [context]
 * @throws {Error}
 */
export function assertStreamAdapter(obj, context = 'StreamAdapter') {
  if (!isStreamAdapter(obj)) {
    throw new Error(`${context} must implement IStreamAdapter (ensureStream, touch, stop, isActive)`);
  }
}

/**
 * Create a no-op stream adapter
 * @returns {Object}
 */
export function createNoOpStreamAdapter() {
  return {
    ensureStream: async () => { throw new Error('Stream adapter not configured'); },
    touch: () => {},
    stop: () => {},
    stopAll: () => {},
    isActive: () => false,
  };
}
```

- [ ] **Step 3: Create ports index**

```javascript
// backend/src/3_applications/camera/ports/index.mjs
/**
 * Camera Capability Ports
 * @module applications/camera/ports
 */

export {
  isCameraGateway,
  assertCameraGateway,
  createNoOpCameraGateway,
} from './ICameraGateway.mjs';

export {
  isStreamAdapter,
  assertStreamAdapter,
  createNoOpStreamAdapter,
} from './IStreamAdapter.mjs';
```

- [ ] **Step 4: Commit**

```bash
git add backend/src/3_applications/camera/ports/
git commit -m "feat(camera): add ICameraGateway and IStreamAdapter port interfaces"
```

---

### Task 2: ReolinkCameraAdapter — implements ICameraGateway

**Files:**
- Create: `backend/src/1_adapters/camera/ReolinkCameraAdapter.mjs`
- Create: `backend/src/1_adapters/camera/index.mjs`

The adapter discovers `type: ip-camera` devices from config, resolves credentials via `auth_ref`, interpolates stream URLs, and fetches snapshots over HTTPS.

- [ ] **Step 1: Create ReolinkCameraAdapter**

```javascript
// backend/src/1_adapters/camera/ReolinkCameraAdapter.mjs
/**
 * ReolinkCameraAdapter — Reolink IP camera gateway
 *
 * Implements ICameraGateway for Reolink cameras.
 * Discovers cameras from devices.yml, resolves auth,
 * fetches JPEG snapshots, provides RTSP stream URLs.
 *
 * @module adapters/camera
 */
import https from 'https';

export class ReolinkCameraAdapter {
  #cameras = new Map();
  #logger;

  /**
   * @param {Object} options
   * @param {Object} options.devicesConfig - devices object from devices.yml
   * @param {Function} options.getAuth - (authRef) => { username, password }
   * @param {Object} [options.logger]
   */
  constructor({ devicesConfig, getAuth, logger = console }) {
    this.#logger = logger;
    this.#discover(devicesConfig, getAuth);
  }

  #discover(devicesConfig, getAuth) {
    for (const [id, device] of Object.entries(devicesConfig)) {
      if (device.type !== 'ip-camera') continue;

      const auth = device.auth_ref ? getAuth(device.auth_ref) : {};
      if (!auth) {
        this.#logger.warn?.('camera.discovery.noAuth', { id, auth_ref: device.auth_ref });
        continue;
      }

      const camera = {
        id,
        host: device.host,
        manufacturer: device.manufacturer || 'unknown',
        model: device.model || 'unknown',
        username: auth.username,
        password: auth.password,
        streams: {},
        homeassistant: device.homeassistant || {},
      };

      if (device.streams) {
        for (const [name, stream] of Object.entries(device.streams)) {
          camera.streams[name] = {
            ...stream,
            url: stream.url
              .replace('{username}', auth.username)
              .replace('{password}', auth.password),
          };
        }
      }

      this.#cameras.set(id, camera);
      this.#logger.info?.('camera.discovered', { id, host: device.host, model: device.model });
    }
  }

  /** List all discovered cameras (safe for API — no credentials exposed) */
  listCameras() {
    return Array.from(this.#cameras.values()).map(cam => ({
      id: cam.id,
      host: cam.host,
      manufacturer: cam.manufacturer,
      model: cam.model,
      capabilities: ['snapshot', ...(Object.keys(cam.streams).length > 0 ? ['live'] : [])],
      streams: Object.keys(cam.streams),
      homeassistant: cam.homeassistant,
    }));
  }

  /** Get a camera by ID (internal — includes credentials for adapter use) */
  getCamera(id) {
    return this.#cameras.get(id) || null;
  }

  /** Get the RTSP URL for a camera stream */
  getStreamUrl(id, streamName = 'sub') {
    const cam = this.#cameras.get(id);
    return cam?.streams[streamName]?.url || null;
  }

  /**
   * Fetch a live snapshot JPEG from the camera.
   * Reolink uses self-signed TLS certs — rejectUnauthorized: false.
   * @returns {Promise<{buffer: Buffer, contentType: string} | null>}
   */
  async fetchSnapshot(id) {
    const cam = this.#cameras.get(id);
    if (!cam) return null;

    const snapUrl = `https://${cam.host}/cgi-bin/api.cgi?` +
      new URLSearchParams({ cmd: 'Snap', channel: '0', user: cam.username, password: cam.password });

    try {
      const buffer = await new Promise((resolve, reject) => {
        const req = https.get(snapUrl, { rejectUnauthorized: false, timeout: 10000 }, (res) => {
          if (res.statusCode !== 200) {
            res.resume();
            reject(new Error(`HTTP ${res.statusCode}`));
            return;
          }
          const chunks = [];
          res.on('data', chunk => chunks.push(chunk));
          res.on('end', () => resolve(Buffer.concat(chunks)));
        });
        req.on('error', reject);
        req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
      });

      return { buffer, contentType: 'image/jpeg' };
    } catch (err) {
      this.#logger.error?.('camera.snapshot.error', { id, error: err.message });
      return null;
    }
  }
}
```

- [ ] **Step 2: Create adapter index**

```javascript
// backend/src/1_adapters/camera/index.mjs
/**
 * Camera Adapters
 * @module adapters/camera
 */
export { ReolinkCameraAdapter } from './ReolinkCameraAdapter.mjs';
export { HlsStreamManager } from './HlsStreamManager.mjs';
```

Note: `HlsStreamManager` doesn't exist yet — the export will be added in Task 3. For now, only export `ReolinkCameraAdapter`. The HLS export line should be added in Task 3.

Actual content for this step:

```javascript
// backend/src/1_adapters/camera/index.mjs
/**
 * Camera Adapters
 * @module adapters/camera
 */
export { ReolinkCameraAdapter } from './ReolinkCameraAdapter.mjs';
```

- [ ] **Step 3: Commit**

```bash
git add backend/src/1_adapters/camera/
git commit -m "feat(camera): add ReolinkCameraAdapter implementing ICameraGateway"
```

---

### Task 3: HlsStreamManager — implements IStreamAdapter

**Files:**
- Create: `backend/src/1_adapters/camera/HlsStreamManager.mjs`
- Modify: `backend/src/1_adapters/camera/index.mjs` (add export)

Generic ffmpeg lifecycle manager. Takes an RTSP URL, produces HLS segments. No vendor knowledge.

- [ ] **Step 1: Create HlsStreamManager**

```javascript
// backend/src/1_adapters/camera/HlsStreamManager.mjs
/**
 * HlsStreamManager — on-demand RTSP→HLS transcoding via ffmpeg
 *
 * Implements IStreamAdapter. Spawns ffmpeg when a client requests
 * a live stream, kills it after inactivity. No vendor knowledge —
 * receives RTSP URLs from the application layer.
 *
 * @module adapters/camera
 */
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';

const INACTIVITY_TIMEOUT_MS = 30_000;

export class HlsStreamManager {
  /** @type {Map<string, { proc: ChildProcess, dir: string, timer: NodeJS.Timeout }>} */
  #streams = new Map();
  #logger;

  /**
   * @param {Object} options
   * @param {Object} [options.logger]
   */
  constructor({ logger = console } = {}) {
    this.#logger = logger;
  }

  /**
   * Ensure an HLS stream is running for a given key.
   * Starts ffmpeg if not already running. Returns the temp directory
   * containing stream.m3u8 and .ts segments.
   * @param {string} streamId - Unique stream identifier (e.g. camera ID)
   * @param {string} rtspUrl - Source RTSP URL
   * @returns {Promise<string>} Path to the HLS output directory
   */
  async ensureStream(streamId, rtspUrl) {
    const existing = this.#streams.get(streamId);
    if (existing) {
      this.#resetInactivityTimer(streamId);
      return existing.dir;
    }

    const dir = path.join(os.tmpdir(), 'camera', streamId);
    await fs.promises.mkdir(dir, { recursive: true });

    const outputPath = path.join(dir, 'stream.m3u8');

    const proc = spawn('ffmpeg', [
      '-rtsp_transport', 'tcp',
      '-i', rtspUrl,
      '-c:v', 'copy',
      '-c:a', 'aac',
      '-f', 'hls',
      '-hls_time', '2',
      '-hls_list_size', '3',
      '-hls_flags', 'delete_segments+append_list',
      outputPath,
    ], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    proc.stderr.on('data', (data) => {
      this.#logger.debug?.('camera.hls.ffmpeg', { streamId, stderr: data.toString().trim() });
    });

    proc.on('exit', (code, signal) => {
      this.#logger.info?.('camera.hls.exit', { streamId, code, signal });
      this.#cleanup(streamId);
    });

    const entry = { proc, dir, timer: null };
    this.#streams.set(streamId, entry);
    this.#resetInactivityTimer(streamId);

    this.#logger.info?.('camera.hls.started', { streamId, dir });

    // Wait for the first .m3u8 to appear before returning
    await this.#waitForPlaylist(outputPath, 10_000);

    return dir;
  }

  /** Record a segment access — resets inactivity timer. */
  touch(streamId) {
    this.#resetInactivityTimer(streamId);
  }

  /** Stop a specific stream. */
  stop(streamId) {
    const entry = this.#streams.get(streamId);
    if (!entry) return;
    this.#logger.info?.('camera.hls.stopping', { streamId });
    this.#killAndClean(streamId, entry);
  }

  /** Stop all streams (for graceful shutdown). */
  stopAll() {
    for (const streamId of this.#streams.keys()) {
      this.stop(streamId);
    }
  }

  /** Check if a stream is active. */
  isActive(streamId) {
    return this.#streams.has(streamId);
  }

  // ── Private ──

  #resetInactivityTimer(streamId) {
    const entry = this.#streams.get(streamId);
    if (!entry) return;
    if (entry.timer) clearTimeout(entry.timer);
    entry.timer = setTimeout(() => {
      this.#logger.info?.('camera.hls.inactivityTimeout', { streamId });
      this.#killAndClean(streamId, entry);
    }, INACTIVITY_TIMEOUT_MS);
  }

  #killAndClean(streamId, entry) {
    if (entry.timer) clearTimeout(entry.timer);
    if (entry.proc && !entry.proc.killed) {
      entry.proc.kill('SIGTERM');
    }
    this.#cleanup(streamId);
  }

  #cleanup(streamId) {
    const entry = this.#streams.get(streamId);
    if (!entry) return;
    if (entry.timer) clearTimeout(entry.timer);
    this.#streams.delete(streamId);

    fs.rm(entry.dir, { recursive: true, force: true }, (err) => {
      if (err) this.#logger.warn?.('camera.hls.cleanupError', { streamId, error: err.message });
    });
  }

  async #waitForPlaylist(playlistPath, timeoutMs) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      if (fs.existsSync(playlistPath)) return;
      await new Promise(r => setTimeout(r, 500));
    }
    throw new Error(`Timed out waiting for HLS playlist: ${playlistPath}`);
  }
}
```

Key difference from original plan: `ensureStream(streamId, rtspUrl)` takes the RTSP URL as a parameter from the application layer. The adapter has zero knowledge of cameras or how to look up URLs — that's the application layer's job.

- [ ] **Step 2: Update adapter index**

```javascript
// backend/src/1_adapters/camera/index.mjs
/**
 * Camera Adapters
 * @module adapters/camera
 */
export { ReolinkCameraAdapter } from './ReolinkCameraAdapter.mjs';
export { HlsStreamManager } from './HlsStreamManager.mjs';
```

- [ ] **Step 3: Commit**

```bash
git add backend/src/1_adapters/camera/
git commit -m "feat(camera): add HlsStreamManager implementing IStreamAdapter"
```

---

### Task 4: CameraService — application layer orchestration

**Files:**
- Create: `backend/src/3_applications/camera/CameraService.mjs`
- Create: `backend/src/3_applications/camera/index.mjs`

The application service wires the gateway and stream adapter. The router only talks to this service.

- [ ] **Step 1: Create CameraService**

```javascript
// backend/src/3_applications/camera/CameraService.mjs
/**
 * CameraService — application service for camera operations
 *
 * Orchestrates ICameraGateway (discovery, snapshots) and
 * IStreamAdapter (live HLS streams). The API router delegates
 * all camera operations to this service.
 *
 * @module applications/camera
 */
import { assertCameraGateway } from './ports/ICameraGateway.mjs';
import { assertStreamAdapter } from './ports/IStreamAdapter.mjs';

export class CameraService {
  #gateway;
  #streamAdapter;
  #logger;

  /**
   * @param {Object} options
   * @param {import('./ports/ICameraGateway.mjs').ICameraGateway} options.gateway
   * @param {import('./ports/IStreamAdapter.mjs').IStreamAdapter} options.streamAdapter
   * @param {Object} [options.logger]
   */
  constructor({ gateway, streamAdapter, logger = console }) {
    assertCameraGateway(gateway, 'CameraService.gateway');
    assertStreamAdapter(streamAdapter, 'CameraService.streamAdapter');
    this.#gateway = gateway;
    this.#streamAdapter = streamAdapter;
    this.#logger = logger;
  }

  /** List all discovered cameras (credentials stripped) */
  listCameras() {
    return this.#gateway.listCameras();
  }

  /** Check if a camera exists */
  hasCamera(cameraId) {
    return this.#gateway.getCamera(cameraId) !== null;
  }

  /**
   * Fetch a live JPEG snapshot from a camera.
   * @param {string} cameraId
   * @returns {Promise<{buffer: Buffer, contentType: string} | null>}
   */
  async getSnapshot(cameraId) {
    return this.#gateway.fetchSnapshot(cameraId);
  }

  /**
   * Ensure an HLS live stream is running for a camera.
   * Starts ffmpeg if not already running.
   * @param {string} cameraId
   * @returns {Promise<string>} Path to HLS output directory
   */
  async startStream(cameraId) {
    const rtspUrl = this.#gateway.getStreamUrl(cameraId, 'sub');
    if (!rtspUrl) {
      throw new Error(`No stream URL for camera: ${cameraId}`);
    }
    return this.#streamAdapter.ensureStream(cameraId, rtspUrl);
  }

  /** Record a segment access — resets inactivity timer. */
  touchStream(cameraId) {
    this.#streamAdapter.touch(cameraId);
  }

  /** Stop a live stream for a camera. */
  stopStream(cameraId) {
    this.#streamAdapter.stop(cameraId);
  }

  /** Check if a camera has an active live stream. */
  isStreamActive(cameraId) {
    return this.#streamAdapter.isActive(cameraId);
  }

  /** Stop all active streams (graceful shutdown). */
  stopAllStreams() {
    this.#streamAdapter.stopAll();
  }
}
```

- [ ] **Step 2: Create application index with factory**

```javascript
// backend/src/3_applications/camera/index.mjs
/**
 * Camera Application Services
 * @module applications/camera
 */
export { CameraService } from './CameraService.mjs';
export * from './ports/index.mjs';

import { configService } from '#system/config/index.mjs';
import { ReolinkCameraAdapter } from '#adapters/camera/ReolinkCameraAdapter.mjs';
import { HlsStreamManager } from '#adapters/camera/HlsStreamManager.mjs';
import { CameraService } from './CameraService.mjs';

/**
 * Create camera application services.
 * Wires adapters and returns the CameraService.
 *
 * @param {Object} options
 * @param {string} [options.householdId]
 * @param {Object} [options.logger]
 * @returns {{ cameraService: CameraService }}
 */
export function createCameraServices({ householdId, logger = console } = {}) {
  const devicesConfig = configService.getHouseholdDevices(householdId)?.devices || {};
  const getAuth = (authRef) => configService.getHouseholdAuth(authRef, householdId);

  const gateway = new ReolinkCameraAdapter({ devicesConfig, getAuth, logger });
  const streamAdapter = new HlsStreamManager({ logger });

  const cameraService = new CameraService({ gateway, streamAdapter, logger });

  return { cameraService };
}
```

- [ ] **Step 3: Commit**

```bash
git add backend/src/3_applications/camera/
git commit -m "feat(camera): add CameraService application layer with factory"
```

---

### Task 5: Camera API router + wiring

**Files:**
- Create: `backend/src/4_api/v1/routers/camera.mjs`
- Modify: `backend/src/app.mjs` (import + wire)
- Modify: `backend/src/4_api/v1/routers/api.mjs` (add to routeMap)
- Create: `tests/live/api/camera/camera-api.test.mjs`

The router talks only to `CameraService` — no direct adapter access.

- [ ] **Step 1: Create camera router**

```javascript
// backend/src/4_api/v1/routers/camera.mjs
/**
 * Camera API Router
 *
 * Serves camera snapshots and live HLS streams.
 * Delegates all operations to CameraService (application layer).
 *
 * @module api/v1/routers/camera
 */
import express from 'express';
import fs from 'fs';
import { asyncHandler } from '#system/http/middleware/index.mjs';

/**
 * @param {Object} config
 * @param {import('../../../3_applications/camera/CameraService.mjs').CameraService} config.cameraService
 * @param {Object} [config.logger]
 * @returns {express.Router}
 */
export function createCameraRouter({ cameraService, logger = console }) {
  const router = express.Router();

  /** GET /api/v1/camera — list available cameras */
  router.get('/', (req, res) => {
    const cameras = cameraService.listCameras();
    res.json({ cameras });
  });

  /** GET /api/v1/camera/:id/snap — proxy a live JPEG snapshot */
  router.get('/:id/snap', asyncHandler(async (req, res) => {
    const { id } = req.params;
    if (!cameraService.hasCamera(id)) {
      return res.status(404).json({ error: 'Camera not found', cameraId: id });
    }

    const snapshot = await cameraService.getSnapshot(id);
    if (!snapshot) {
      return res.status(502).json({ error: 'Camera unreachable', cameraId: id });
    }

    res.set({
      'Content-Type': snapshot.contentType,
      'Content-Length': snapshot.buffer.length,
      'Cache-Control': 'no-cache',
    });
    res.send(snapshot.buffer);
  }));

  /** GET /api/v1/camera/:id/live/stream.m3u8 — HLS playlist (starts ffmpeg if needed) */
  router.get('/:id/live/stream.m3u8', asyncHandler(async (req, res) => {
    const { id } = req.params;
    if (!cameraService.hasCamera(id)) {
      return res.status(404).json({ error: 'Camera not found', cameraId: id });
    }

    try {
      const dir = await cameraService.startStream(id);
      const playlistPath = `${dir}/stream.m3u8`;

      res.set({
        'Content-Type': 'application/vnd.apple.mpegurl',
        'Cache-Control': 'no-cache',
      });
      res.sendFile(playlistPath);
    } catch (err) {
      logger.error?.('camera.live.playlistError', { cameraId: id, error: err.message });
      if (!res.headersSent) {
        res.status(502).json({ error: 'Failed to start stream', cameraId: id, details: err.message });
      }
    }
  }));

  /** GET /api/v1/camera/:id/live/:segment — serve HLS .ts segment */
  router.get('/:id/live/:segment', asyncHandler(async (req, res) => {
    const { id, segment } = req.params;

    if (!cameraService.isStreamActive(id)) {
      return res.status(404).json({ error: 'Stream not active', cameraId: id });
    }

    // Security: only allow .ts files, no path traversal
    if (!segment.endsWith('.ts') || segment.includes('..') || segment.includes('/')) {
      return res.status(400).json({ error: 'Invalid segment name' });
    }

    cameraService.touchStream(id);

    const dir = await cameraService.startStream(id);
    const segmentPath = `${dir}/${segment}`;

    try {
      await fs.promises.access(segmentPath);
    } catch {
      return res.status(404).json({ error: 'Segment not found', segment });
    }

    res.set({
      'Content-Type': 'video/mp2t',
      'Cache-Control': 'public, max-age=60',
    });
    res.sendFile(segmentPath);
  }));

  /** DELETE /api/v1/camera/:id/live — stop a live stream */
  router.delete('/:id/live', (req, res) => {
    const { id } = req.params;
    cameraService.stopStream(id);
    res.json({ stopped: true, cameraId: id });
  });

  return router;
}

export default createCameraRouter;
```

- [ ] **Step 2: Wire in app.mjs**

Add import near other router imports (around line 98):

```javascript
import { createCameraRouter } from './4_api/v1/routers/camera.mjs';
```

Add service creation + router wiring after the devices section (after ~line 1588 where `deviceServices` is created):

```javascript
  // Camera feeds
  const { createCameraServices } = await import('#apps/camera/index.mjs');
  const { cameraService } = createCameraServices({
    householdId,
    logger: rootLogger.child({ module: 'camera' }),
  });

  v1Routers.camera = createCameraRouter({
    cameraService,
    logger: rootLogger.child({ module: 'camera-api' }),
  });
```

- [ ] **Step 3: Add route to api.mjs routeMap**

In `backend/src/4_api/v1/routers/api.mjs`, add to the `routeMap` object (after `/livestream` around line 108):

```javascript
    '/camera': 'camera',
```

- [ ] **Step 4: Create tests**

```javascript
// tests/live/api/camera/camera-api.test.mjs
import { getAppPort } from '../../../_lib/configHelper.mjs';

const APP_PORT = getAppPort();
const BASE_URL = `http://localhost:${APP_PORT}`;

describe('Camera API', () => {
  test('GET /api/v1/camera returns list of cameras', async () => {
    const res = await fetch(`${BASE_URL}/api/v1/camera`);
    expect(res.ok).toBe(true);

    const body = await res.json();
    expect(body).toHaveProperty('cameras');
    expect(Array.isArray(body.cameras)).toBe(true);
    expect(body.cameras.length).toBeGreaterThan(0);

    const cam = body.cameras[0];
    expect(cam).toHaveProperty('id');
    expect(cam).toHaveProperty('host');
    expect(cam).toHaveProperty('capabilities');
    expect(cam.capabilities).toContain('snapshot');
    // Should NOT expose credentials
    expect(cam).not.toHaveProperty('username');
    expect(cam).not.toHaveProperty('password');
    expect(JSON.stringify(cam)).not.toContain('DAP9');
  });

  test('GET /api/v1/camera/driveway-camera/snap returns JPEG', async () => {
    const res = await fetch(`${BASE_URL}/api/v1/camera/driveway-camera/snap`);
    expect(res.ok).toBe(true);
    expect(res.headers.get('content-type')).toBe('image/jpeg');
    expect(res.headers.get('cache-control')).toBe('no-cache');

    const buf = await res.arrayBuffer();
    expect(buf.byteLength).toBeGreaterThan(1000);
  });

  test('GET /api/v1/camera/nonexistent/snap returns 404', async () => {
    const res = await fetch(`${BASE_URL}/api/v1/camera/nonexistent/snap`);
    expect(res.status).toBe(404);
  });
});

describe('Camera Live Stream API', () => {
  const CAMERA_ID = 'driveway-camera';

  afterAll(async () => {
    await fetch(`${BASE_URL}/api/v1/camera/${CAMERA_ID}/live`, { method: 'DELETE' });
  });

  test('GET /api/v1/camera/:id/live/stream.m3u8 starts stream and returns playlist', async () => {
    const res = await fetch(`${BASE_URL}/api/v1/camera/${CAMERA_ID}/live/stream.m3u8`);
    expect(res.ok).toBe(true);
    expect(res.headers.get('content-type')).toMatch(/mpegurl/);
    expect(res.headers.get('cache-control')).toBe('no-cache');

    const body = await res.text();
    expect(body).toContain('#EXTM3U');
  }, 15000);

  test('GET /api/v1/camera/:id/live/:segment.ts returns video segment', async () => {
    const playlistRes = await fetch(`${BASE_URL}/api/v1/camera/${CAMERA_ID}/live/stream.m3u8`);
    const playlist = await playlistRes.text();
    const segmentMatch = playlist.match(/^(stream\d+\.ts)$/m);
    expect(segmentMatch).not.toBeNull();

    const segmentName = segmentMatch[1];
    const segRes = await fetch(`${BASE_URL}/api/v1/camera/${CAMERA_ID}/live/${segmentName}`);
    expect(segRes.ok).toBe(true);
    expect(segRes.headers.get('content-type')).toMatch(/mp2t/);
  }, 10000);

  test('DELETE /api/v1/camera/:id/live stops the stream', async () => {
    const res = await fetch(`${BASE_URL}/api/v1/camera/${CAMERA_ID}/live`, { method: 'DELETE' });
    expect(res.ok).toBe(true);

    const body = await res.json();
    expect(body).toHaveProperty('stopped', true);
  });

  test('GET /api/v1/camera/nonexistent/live/stream.m3u8 returns 404', async () => {
    const res = await fetch(`${BASE_URL}/api/v1/camera/nonexistent/live/stream.m3u8`);
    expect(res.status).toBe(404);
  });
});
```

- [ ] **Step 5: Run tests**

Run: `npx jest tests/live/api/camera/camera-api.test.mjs --verbose`
Expected: All tests PASS

- [ ] **Step 6: Commit**

```bash
git add backend/src/4_api/v1/routers/camera.mjs backend/src/app.mjs backend/src/4_api/v1/routers/api.mjs tests/live/api/camera/camera-api.test.mjs
git commit -m "feat(camera): add camera API router and wire into app"
```

---

### Task 6: Install hls.js and create CameraFeed module

**Files:**
- Modify: `package.json` (add hls.js)
- Create: `frontend/src/modules/CameraFeed/CameraFeed.jsx`
- Create: `frontend/src/modules/CameraFeed/CameraFeed.scss`

- [ ] **Step 1: Install hls.js**

```bash
npm install hls.js
```

- [ ] **Step 2: Create CameraFeed component**

```jsx
// frontend/src/modules/CameraFeed/CameraFeed.jsx
import { useState, useEffect, useRef, useMemo } from 'react';
import Hls from 'hls.js';
import { getChildLogger } from '../../lib/logging/singleton.js';
import './CameraFeed.scss';

/**
 * CameraFeed — reusable camera viewer with snapshot and live HLS modes.
 *
 * @param {Object} props
 * @param {string} props.cameraId - Device ID from devices.yml
 * @param {'snapshot'|'live'} [props.mode='snapshot']
 * @param {number} [props.interval=3000] - Snapshot polling interval (ms)
 * @param {Function} [props.onError] - Error callback
 */
export default function CameraFeed({ cameraId, mode = 'snapshot', interval = 3000, onError }) {
  const logger = useMemo(() => getChildLogger({ component: 'CameraFeed', cameraId }), [cameraId]);

  if (mode === 'live') {
    return <HlsPlayer cameraId={cameraId} logger={logger} onError={onError} />;
  }
  return <SnapshotPoller cameraId={cameraId} interval={interval} logger={logger} onError={onError} />;
}

function SnapshotPoller({ cameraId, interval, logger, onError }) {
  const [src, setSrc] = useState(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let active = true;
    logger.info('snapshot.start', { interval });

    const poll = async () => {
      try {
        const url = `/api/v1/camera/${cameraId}/snap?t=${Date.now()}`;
        const res = await fetch(url);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const blob = await res.blob();
        if (!active) return;
        const objectUrl = URL.createObjectURL(blob);
        setSrc(prev => {
          if (prev) URL.revokeObjectURL(prev);
          return objectUrl;
        });
        setError(false);
      } catch (err) {
        logger.warn('snapshot.error', { error: err.message });
        setError(true);
        onError?.(err);
      }
    };

    poll();
    const timer = setInterval(poll, interval);

    return () => {
      active = false;
      clearInterval(timer);
      setSrc(prev => {
        if (prev) URL.revokeObjectURL(prev);
        return null;
      });
      logger.info('snapshot.stop');
    };
  }, [cameraId, interval, logger, onError]);

  return (
    <div className="camera-feed camera-feed--snapshot">
      {src && <img src={src} alt={`${cameraId} snapshot`} />}
      {error && !src && <div className="camera-feed__error">Camera unavailable</div>}
    </div>
  );
}

function HlsPlayer({ cameraId, logger, onError }) {
  const videoRef = useRef(null);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const playlistUrl = `/api/v1/camera/${cameraId}/live/stream.m3u8`;
    logger.info('hls.start', { url: playlistUrl });

    // Safari supports HLS natively
    if (video.canPlayType('application/vnd.apple.mpegurl')) {
      video.src = playlistUrl;
      video.play().catch(() => {});
      return () => {
        video.src = '';
        fetch(`/api/v1/camera/${cameraId}/live`, { method: 'DELETE' }).catch(() => {});
        logger.info('hls.stop');
      };
    }

    if (!Hls.isSupported()) {
      logger.error('hls.unsupported');
      onError?.(new Error('HLS not supported in this browser'));
      return;
    }

    const hls = new Hls({
      enableWorker: true,
      liveSyncDurationCount: 1,
      liveMaxLatencyDurationCount: 3,
    });

    hls.loadSource(playlistUrl);
    hls.attachMedia(video);
    hls.on(Hls.Events.MANIFEST_PARSED, () => {
      video.play().catch(() => {});
    });
    hls.on(Hls.Events.ERROR, (event, data) => {
      logger.warn('hls.error', { type: data.type, details: data.details, fatal: data.fatal });
      if (data.fatal) onError?.(new Error(data.details));
    });

    return () => {
      hls.destroy();
      fetch(`/api/v1/camera/${cameraId}/live`, { method: 'DELETE' }).catch(() => {});
      logger.info('hls.stop');
    };
  }, [cameraId, logger, onError]);

  return (
    <div className="camera-feed camera-feed--live">
      <video ref={videoRef} muted autoPlay playsInline />
    </div>
  );
}
```

- [ ] **Step 3: Create styles**

```scss
// frontend/src/modules/CameraFeed/CameraFeed.scss
.camera-feed {
  position: relative;
  width: 100%;
  aspect-ratio: 16 / 9;
  background: #111;
  border-radius: 8px;
  overflow: hidden;

  img, video {
    width: 100%;
    height: 100%;
    object-fit: contain;
    display: block;
  }

  &__error {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    color: #666;
    font-size: 0.9rem;
  }
}
```

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json frontend/src/modules/CameraFeed/
git commit -m "feat(camera): add CameraFeed module with snapshot polling and HLS live view"
```

---

### Task 7: Integrate CameraFeed into HomeApp

**Files:**
- Modify: `frontend/src/Apps/HomeApp.jsx`
- Modify: `frontend/src/Apps/HomeApp.scss`

- [ ] **Step 1: Update HomeApp**

```jsx
// frontend/src/Apps/HomeApp.jsx
import { useMemo, useState, useEffect } from 'react';
import './HomeApp.scss';
import { getChildLogger } from '../lib/logging/singleton.js';
import CameraFeed from '../modules/CameraFeed/CameraFeed.jsx';

function HomeApp() {
  const logger = useMemo(() => getChildLogger({ app: 'home' }), []);
  const [cameras, setCameras] = useState([]);
  const [liveCameras, setLiveCameras] = useState(new Set());

  useEffect(() => {
    fetch('/api/v1/camera')
      .then(r => r.json())
      .then(data => {
        setCameras(data.cameras || []);
        logger.info('home.cameras.loaded', { count: data.cameras?.length });
      })
      .catch(err => logger.error('home.cameras.fetchError', { error: err.message }));
  }, [logger]);

  const toggleLive = (id) => {
    setLiveCameras(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <div className="App home-app">
      <div className="home-container">
        <h1>Home</h1>
        <div className="home-cameras">
          {cameras.map(cam => (
            <div key={cam.id} className="home-cameras__card">
              <div className="home-cameras__header">
                <span className="home-cameras__label">{cam.id}</span>
                {cam.capabilities.includes('live') && (
                  <button
                    className={`home-cameras__toggle ${liveCameras.has(cam.id) ? 'active' : ''}`}
                    onClick={() => toggleLive(cam.id)}
                  >
                    {liveCameras.has(cam.id) ? 'Stop' : 'Live'}
                  </button>
                )}
              </div>
              <CameraFeed
                cameraId={cam.id}
                mode={liveCameras.has(cam.id) ? 'live' : 'snapshot'}
              />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export default HomeApp;
```

- [ ] **Step 2: Update HomeApp styles**

```scss
// frontend/src/Apps/HomeApp.scss
.home-app {
  .home-container {
    padding: 1rem;
    max-width: 1200px;
    margin: 0 auto;
  }

  .home-cameras {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(400px, 1fr));
    gap: 1rem;

    &__card {
      background: #1a1a1a;
      border-radius: 10px;
      overflow: hidden;
    }

    &__header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 0.5rem 0.75rem;
    }

    &__label {
      font-size: 0.85rem;
      color: #aaa;
      text-transform: capitalize;
    }

    &__toggle {
      background: #333;
      color: #ccc;
      border: none;
      border-radius: 4px;
      padding: 0.25rem 0.75rem;
      cursor: pointer;
      font-size: 0.8rem;

      &.active {
        background: #c0392b;
        color: #fff;
      }
    }
  }
}
```

- [ ] **Step 3: Start dev server and verify in browser**

```bash
npm run dev
```

Open `http://localhost:{app_port}/home`. Verify:
- Camera list loads
- Snapshot images appear and refresh every 3s
- "Live" button toggles to HLS stream
- Stopping live returns to snapshot mode

- [ ] **Step 4: Commit**

```bash
git add frontend/src/Apps/HomeApp.jsx frontend/src/Apps/HomeApp.scss
git commit -m "feat(home): integrate CameraFeed into HomeApp with snapshot + live toggle"
```
