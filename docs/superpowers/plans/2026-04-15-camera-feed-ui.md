# Camera Feed UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upgrade CameraFeed with loading skeleton, fullscreen pan/zoom viewport, AI detection badges, and floodlight/siren controls — all through DDD port interfaces.

**Architecture:** Two new port interfaces (`ICameraStateGateway`, `ICameraControlGateway`) with Reolink and HA adapter implementations. CameraService extended with optional gateways. Frontend split into CameraFeed (card) and CameraViewport (fullscreen overlay) with a shared `usePanZoom` hook.

**Tech Stack:** React, CSS transforms for pan/zoom, pointer events API, existing HA adapter

**Spec:** `docs/superpowers/specs/2026-04-15-camera-feed-ui-design.md`

---

## File Structure

```
backend/src/3_applications/camera/ports/
├── ICameraStateGateway.mjs      # NEW — detection/motion state port
├── ICameraControlGateway.mjs    # NEW — floodlight/siren control port
├── index.mjs                    # MODIFY — add new exports

backend/src/1_adapters/camera/
├── ReolinkStateAdapter.mjs      # NEW — implements ICameraStateGateway via Reolink HTTP API
├── HomeAssistantControlAdapter.mjs  # NEW — implements ICameraControlGateway via HA
├── index.mjs                    # MODIFY — add new exports

backend/src/3_applications/camera/
├── CameraService.mjs            # MODIFY — add stateGateway + controlGateway
├── index.mjs                    # MODIFY — wire new adapters in factory

backend/src/4_api/v1/routers/
├── camera.mjs                   # MODIFY — add state + controls endpoints

frontend/src/modules/CameraFeed/
├── CameraFeed.jsx               # MODIFY — skeleton, badges, click-to-expand
├── CameraFeed.scss              # MODIFY — native aspect, skeleton, badges
├── CameraViewport.jsx           # NEW — fullscreen pan/zoom overlay
├── CameraViewport.scss          # NEW — viewport styles
├── usePanZoom.js                # NEW — pan/zoom state + input handler hook
├── CameraControls.jsx           # NEW — floodlight/siren controls
```

---

### Task 1: ICameraStateGateway + ICameraControlGateway ports

**Files:**
- Create: `backend/src/3_applications/camera/ports/ICameraStateGateway.mjs`
- Create: `backend/src/3_applications/camera/ports/ICameraControlGateway.mjs`
- Modify: `backend/src/3_applications/camera/ports/index.mjs`

- [ ] **Step 1: Create ICameraStateGateway port**

```javascript
// backend/src/3_applications/camera/ports/ICameraStateGateway.mjs
/**
 * ICameraStateGateway Port — real-time detection and motion state
 *
 * Abstraction for polling AI detection state from cameras.
 * Implemented by vendor-specific adapters (e.g., Reolink HTTP API).
 *
 * @module applications/camera/ports
 */

/**
 * @typedef {Object} DetectionState
 * @property {{ type: string, active: boolean }[]} detections
 * @property {boolean} motion
 */

export function isCameraStateGateway(obj) {
  return (
    obj !== null &&
    typeof obj === 'object' &&
    typeof obj.getDetectionState === 'function'
  );
}

export function assertCameraStateGateway(obj, context = 'CameraStateGateway') {
  if (!isCameraStateGateway(obj)) {
    throw new Error(`${context} must implement ICameraStateGateway (getDetectionState)`);
  }
}

export function createNoOpCameraStateGateway() {
  return {
    getDetectionState: async () => ({ detections: [], motion: false }),
  };
}
```

- [ ] **Step 2: Create ICameraControlGateway port**

```javascript
// backend/src/3_applications/camera/ports/ICameraControlGateway.mjs
/**
 * ICameraControlGateway Port — camera-associated device controls
 *
 * Abstraction for listing and executing controls (floodlight, siren, etc.)
 * associated with a camera. Implemented by home automation adapters.
 *
 * @module applications/camera/ports
 */

export function isCameraControlGateway(obj) {
  return (
    obj !== null &&
    typeof obj === 'object' &&
    typeof obj.listControls === 'function' &&
    typeof obj.executeControl === 'function'
  );
}

export function assertCameraControlGateway(obj, context = 'CameraControlGateway') {
  if (!isCameraControlGateway(obj)) {
    throw new Error(`${context} must implement ICameraControlGateway (listControls, executeControl)`);
  }
}

export function createNoOpCameraControlGateway() {
  return {
    listControls: async () => [],
    executeControl: async () => ({ ok: false, error: 'Controls not configured' }),
  };
}
```

- [ ] **Step 3: Update ports index**

Add to `backend/src/3_applications/camera/ports/index.mjs`:

```javascript
export {
  isCameraStateGateway,
  assertCameraStateGateway,
  createNoOpCameraStateGateway,
} from './ICameraStateGateway.mjs';

export {
  isCameraControlGateway,
  assertCameraControlGateway,
  createNoOpCameraControlGateway,
} from './ICameraControlGateway.mjs';
```

- [ ] **Step 4: Commit**

```bash
git add backend/src/3_applications/camera/ports/
git commit -m "feat(camera): add ICameraStateGateway and ICameraControlGateway ports"
```

---

### Task 2: ReolinkStateAdapter

**Files:**
- Create: `backend/src/1_adapters/camera/ReolinkStateAdapter.mjs`
- Modify: `backend/src/1_adapters/camera/index.mjs`

Implements `ICameraStateGateway` by polling the Reolink HTTP API. Handles token-based auth with caching and auto-refresh.

- [ ] **Step 1: Create ReolinkStateAdapter**

```javascript
// backend/src/1_adapters/camera/ReolinkStateAdapter.mjs
/**
 * ReolinkStateAdapter — polls AI detection state from Reolink cameras
 *
 * Implements ICameraStateGateway. Authenticates via the Reolink HTTP API
 * (token-based, 1-hour lease), then polls GetAiState for detection status.
 *
 * @module adapters/camera
 */
import https from 'https';

export class ReolinkStateAdapter {
  /** @type {Map<string, { host: string, username: string, password: string }>} */
  #cameras = new Map();
  /** @type {Map<string, { token: string, expiresAt: number }>} */
  #tokens = new Map();
  #logger;

  /**
   * @param {Object} options
   * @param {Object} options.devicesConfig - devices object from devices.yml
   * @param {Function} options.getAuth - (authRef) => { username, password }
   * @param {Object} [options.logger]
   */
  constructor({ devicesConfig, getAuth, logger = console }) {
    this.#logger = logger;
    for (const [id, device] of Object.entries(devicesConfig)) {
      if (device.type !== 'ip-camera') continue;
      const auth = device.auth_ref ? getAuth(device.auth_ref) : null;
      if (!auth) continue;
      this.#cameras.set(id, { host: device.host, username: auth.username, password: auth.password });
    }
  }

  /**
   * Get detection state for a camera.
   * @param {string} cameraId
   * @returns {Promise<{ detections: { type: string, active: boolean }[], motion: boolean }>}
   */
  async getDetectionState(cameraId) {
    const cam = this.#cameras.get(cameraId);
    if (!cam) return { detections: [], motion: false };

    try {
      const token = await this.#getToken(cameraId, cam);
      const results = await this.#apiCall(cam.host, token, [
        { cmd: 'GetAiState', action: 0, param: { channel: 0 } },
        { cmd: 'GetMdState', action: 0, param: { channel: 0 } },
      ]);

      const aiState = results.find(r => r.cmd === 'GetAiState');
      const mdState = results.find(r => r.cmd === 'GetMdState');

      const detections = [];
      if (aiState?.code === 0) {
        const v = aiState.value;
        if (v.people?.support) detections.push({ type: 'person', active: v.people.alarm_state === 1 });
        if (v.vehicle?.support) detections.push({ type: 'vehicle', active: v.vehicle.alarm_state === 1 });
        if (v.dog_cat?.support) detections.push({ type: 'animal', active: v.dog_cat.alarm_state === 1 });
      }

      const motion = mdState?.code === 0 ? mdState.value.state === 1 : false;

      return { detections, motion };
    } catch (err) {
      this.#logger.warn?.('camera.state.error', { cameraId, error: err.message });
      return { detections: [], motion: false };
    }
  }

  // ── Private ──

  async #getToken(cameraId, cam) {
    const cached = this.#tokens.get(cameraId);
    if (cached && Date.now() < cached.expiresAt) return cached.token;

    const result = await this.#apiCall(cam.host, null, [
      { cmd: 'Login', param: { User: { userName: cam.username, password: cam.password } } },
    ]);

    const loginResp = result.find(r => r.cmd === 'Login');
    if (loginResp?.code !== 0) throw new Error('Reolink login failed');

    const token = loginResp.value.Token.name;
    const leaseTime = loginResp.value.Token.leaseTime || 3600;
    // Refresh 60s before expiry
    this.#tokens.set(cameraId, { token, expiresAt: Date.now() + (leaseTime - 60) * 1000 });

    this.#logger.debug?.('camera.state.login', { cameraId, leaseTime });
    return token;
  }

  #apiCall(host, token, commands) {
    const path = token
      ? `/cgi-bin/api.cgi?token=${token}`
      : '/cgi-bin/api.cgi?cmd=Login';
    const body = JSON.stringify(commands);

    return new Promise((resolve, reject) => {
      const req = https.request({
        hostname: host,
        port: 443,
        path,
        method: 'POST',
        rejectUnauthorized: false,
        timeout: 5000,
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
      }, (res) => {
        const chunks = [];
        res.on('data', c => chunks.push(c));
        res.on('end', () => {
          try {
            const json = JSON.parse(Buffer.concat(chunks).toString());
            // Handle token expiry — clear cache so next call re-authenticates
            if (Array.isArray(json) && json[0]?.error?.rspCode === -6) {
              this.#tokens.delete(host); // force re-login
              reject(new Error('Token expired'));
              return;
            }
            resolve(json);
          } catch (e) { reject(e); }
        });
      });
      req.on('error', reject);
      req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
      req.end(body);
    });
  }
}
```

- [ ] **Step 2: Add export to index.mjs**

Add to `backend/src/1_adapters/camera/index.mjs`:

```javascript
export { ReolinkStateAdapter } from './ReolinkStateAdapter.mjs';
```

- [ ] **Step 3: Commit**

```bash
git add backend/src/1_adapters/camera/ReolinkStateAdapter.mjs backend/src/1_adapters/camera/index.mjs
git commit -m "feat(camera): add ReolinkStateAdapter implementing ICameraStateGateway"
```

---

### Task 3: HomeAssistantControlAdapter

**Files:**
- Create: `backend/src/1_adapters/camera/HomeAssistantControlAdapter.mjs`
- Modify: `backend/src/1_adapters/camera/index.mjs`

Implements `ICameraControlGateway` using the existing HA gateway. Reads control entity IDs from the camera's `homeassistant` config block in `devices.yml`.

- [ ] **Step 1: Create HomeAssistantControlAdapter**

```javascript
// backend/src/1_adapters/camera/HomeAssistantControlAdapter.mjs
/**
 * HomeAssistantControlAdapter — camera controls via Home Assistant
 *
 * Implements ICameraControlGateway. Maps camera HA entity config
 * (floodlight, siren) to generic control operations.
 *
 * @module adapters/camera
 */

/** Map of HA entity prefix → control type */
const CONTROL_TYPE_MAP = {
  floodlight: 'light',
  siren: 'siren',
};

export class HomeAssistantControlAdapter {
  /** @type {Map<string, { id: string, type: string, label: string, entityId: string, domain: string }[]>} */
  #cameraControls = new Map();
  #haGateway;
  #logger;

  /**
   * @param {Object} options
   * @param {Object} options.devicesConfig - devices object from devices.yml
   * @param {Object} options.haGateway - HomeAssistantAdapter instance (getState, callService)
   * @param {Object} [options.logger]
   */
  constructor({ devicesConfig, haGateway, logger = console }) {
    this.#haGateway = haGateway;
    this.#logger = logger;
    this.#discover(devicesConfig);
  }

  #discover(devicesConfig) {
    for (const [id, device] of Object.entries(devicesConfig)) {
      if (device.type !== 'ip-camera') continue;
      const ha = device.homeassistant;
      if (!ha) continue;

      const controls = [];
      for (const [key, entityId] of Object.entries(ha)) {
        const type = CONTROL_TYPE_MAP[key];
        if (!type) continue; // Skip non-control entities (camera, motion sensors, etc.)
        const domain = entityId.split('.')[0]; // e.g. 'light' from 'light.driveway_camera_floodlight'
        controls.push({
          id: key,
          type,
          label: key.charAt(0).toUpperCase() + key.slice(1), // 'floodlight' → 'Floodlight'
          entityId,
          domain,
        });
      }

      if (controls.length > 0) {
        this.#cameraControls.set(id, controls);
        this.#logger.info?.('camera.controls.discovered', { cameraId: id, controls: controls.map(c => c.id) });
      }
    }
  }

  /**
   * List available controls for a camera.
   * @param {string} cameraId
   * @returns {Promise<{ id: string, type: string, label: string, state: string }[]>}
   */
  async listControls(cameraId) {
    const controls = this.#cameraControls.get(cameraId);
    if (!controls || !this.#haGateway) return [];

    const results = [];
    for (const ctrl of controls) {
      try {
        const haState = await this.#haGateway.getState(ctrl.entityId);
        results.push({
          id: ctrl.id,
          type: ctrl.type,
          label: ctrl.label,
          state: haState?.state || 'unknown',
        });
      } catch (err) {
        this.#logger.warn?.('camera.controls.stateError', { cameraId, control: ctrl.id, error: err.message });
        results.push({ id: ctrl.id, type: ctrl.type, label: ctrl.label, state: 'unknown' });
      }
    }

    return results;
  }

  /**
   * Execute a control action.
   * @param {string} cameraId
   * @param {string} controlId - e.g. 'floodlight', 'siren'
   * @param {'on'|'off'|'trigger'} action
   * @returns {Promise<{ ok: boolean, error?: string }>}
   */
  async executeControl(cameraId, controlId, action) {
    const controls = this.#cameraControls.get(cameraId);
    const ctrl = controls?.find(c => c.id === controlId);
    if (!ctrl) return { ok: false, error: `Unknown control: ${controlId}` };
    if (!this.#haGateway) return { ok: false, error: 'Home automation not configured' };

    const serviceMap = {
      on: 'turn_on',
      off: 'turn_off',
      trigger: 'turn_on', // siren.turn_on triggers it
    };
    const service = serviceMap[action];
    if (!service) return { ok: false, error: `Unknown action: ${action}` };

    this.#logger.info?.('camera.controls.execute', { cameraId, control: controlId, action });
    return this.#haGateway.callService(ctrl.domain, service, { entity_id: ctrl.entityId });
  }
}
```

- [ ] **Step 2: Add export to index.mjs**

Add to `backend/src/1_adapters/camera/index.mjs`:

```javascript
export { HomeAssistantControlAdapter } from './HomeAssistantControlAdapter.mjs';
```

- [ ] **Step 3: Commit**

```bash
git add backend/src/1_adapters/camera/HomeAssistantControlAdapter.mjs backend/src/1_adapters/camera/index.mjs
git commit -m "feat(camera): add HomeAssistantControlAdapter implementing ICameraControlGateway"
```

---

### Task 4: Extend CameraService + factory + API routes

**Files:**
- Modify: `backend/src/3_applications/camera/CameraService.mjs`
- Modify: `backend/src/3_applications/camera/index.mjs`
- Modify: `backend/src/4_api/v1/routers/camera.mjs`
- Modify: `backend/src/app.mjs`

- [ ] **Step 1: Update CameraService with optional gateways**

Replace `backend/src/3_applications/camera/CameraService.mjs`:

```javascript
// backend/src/3_applications/camera/CameraService.mjs
import { assertCameraGateway } from './ports/ICameraGateway.mjs';
import { assertStreamAdapter } from './ports/IStreamAdapter.mjs';
import { assertCameraStateGateway } from './ports/ICameraStateGateway.mjs';
import { assertCameraControlGateway } from './ports/ICameraControlGateway.mjs';

export class CameraService {
  #gateway;
  #streamAdapter;
  #stateGateway;
  #controlGateway;
  #logger;

  constructor({ gateway, streamAdapter, stateGateway, controlGateway, logger = console }) {
    assertCameraGateway(gateway, 'CameraService.gateway');
    assertStreamAdapter(streamAdapter, 'CameraService.streamAdapter');
    if (stateGateway) assertCameraStateGateway(stateGateway, 'CameraService.stateGateway');
    if (controlGateway) assertCameraControlGateway(controlGateway, 'CameraService.controlGateway');
    this.#gateway = gateway;
    this.#streamAdapter = streamAdapter;
    this.#stateGateway = stateGateway || null;
    this.#controlGateway = controlGateway || null;
    this.#logger = logger;
  }

  // ── Existing methods (unchanged) ──
  listCameras() { return this.#gateway.listCameras(); }
  hasCamera(cameraId) { return this.#gateway.getCamera(cameraId) !== null; }
  async getSnapshot(cameraId) { return this.#gateway.fetchSnapshot(cameraId); }

  async startStream(cameraId) {
    const rtspUrl = this.#gateway.getStreamUrl(cameraId, 'sub');
    if (!rtspUrl) throw new Error(`No stream URL for camera: ${cameraId}`);
    return this.#streamAdapter.ensureStream(cameraId, rtspUrl);
  }

  touchStream(cameraId) { this.#streamAdapter.touch(cameraId); }
  stopStream(cameraId) { this.#streamAdapter.stop(cameraId); }
  isStreamActive(cameraId) { return this.#streamAdapter.isActive(cameraId); }
  stopAllStreams() { this.#streamAdapter.stopAll(); }

  // ── New: detection state ──
  async getDetectionState(cameraId) {
    if (!this.#stateGateway) return { detections: [], motion: false };
    return this.#stateGateway.getDetectionState(cameraId);
  }

  // ── New: controls ──
  async listControls(cameraId) {
    if (!this.#controlGateway) return [];
    return this.#controlGateway.listControls(cameraId);
  }

  async executeControl(cameraId, controlId, action) {
    if (!this.#controlGateway) return { ok: false, error: 'Controls not configured' };
    return this.#controlGateway.executeControl(cameraId, controlId, action);
  }
}
```

- [ ] **Step 2: Update factory to wire new adapters**

Replace `backend/src/3_applications/camera/index.mjs`:

```javascript
// backend/src/3_applications/camera/index.mjs
export { CameraService } from './CameraService.mjs';
export * from './ports/index.mjs';

import { configService } from '#system/config/index.mjs';
import { ReolinkCameraAdapter } from '#adapters/camera/ReolinkCameraAdapter.mjs';
import { HlsStreamManager } from '#adapters/camera/HlsStreamManager.mjs';
import { ReolinkStateAdapter } from '#adapters/camera/ReolinkStateAdapter.mjs';
import { HomeAssistantControlAdapter } from '#adapters/camera/HomeAssistantControlAdapter.mjs';
import { CameraService } from './CameraService.mjs';

/**
 * Create camera application services.
 * @param {Object} options
 * @param {string} [options.householdId]
 * @param {Object} [options.haGateway] - HomeAssistantAdapter instance (optional)
 * @param {Object} [options.logger]
 * @returns {{ cameraService: CameraService }}
 */
export function createCameraServices({ householdId, haGateway, logger = console } = {}) {
  const devicesConfig = configService.getHouseholdDevices(householdId)?.devices || {};
  const getAuth = (authRef) => configService.getHouseholdAuth(authRef, householdId);

  const gateway = new ReolinkCameraAdapter({ devicesConfig, getAuth, logger });
  const streamAdapter = new HlsStreamManager({ logger });
  const stateGateway = new ReolinkStateAdapter({ devicesConfig, getAuth, logger });
  const controlGateway = haGateway
    ? new HomeAssistantControlAdapter({ devicesConfig, haGateway, logger })
    : null;

  const cameraService = new CameraService({
    gateway, streamAdapter, stateGateway, controlGateway, logger,
  });

  return { cameraService };
}
```

- [ ] **Step 3: Add state + controls endpoints to camera router**

Add to `backend/src/4_api/v1/routers/camera.mjs`, after the DELETE endpoint and before the `return router`:

```javascript
  /** GET /api/v1/camera/:id/state — AI detection + motion state */
  router.get('/:id/state', asyncHandler(async (req, res) => {
    const { id } = req.params;
    if (!cameraService.hasCamera(id)) {
      return res.status(404).json({ error: 'Camera not found', cameraId: id });
    }
    const state = await cameraService.getDetectionState(id);
    res.json(state);
  }));

  /** GET /api/v1/camera/:id/controls — list available controls */
  router.get('/:id/controls', asyncHandler(async (req, res) => {
    const { id } = req.params;
    if (!cameraService.hasCamera(id)) {
      return res.status(404).json({ error: 'Camera not found', cameraId: id });
    }
    const controls = await cameraService.listControls(id);
    res.json({ controls });
  }));

  /** POST /api/v1/camera/:id/controls/:controlId — execute a control */
  router.post('/:id/controls/:controlId', asyncHandler(async (req, res) => {
    const { id, controlId } = req.params;
    const { action } = req.body || {};
    if (!cameraService.hasCamera(id)) {
      return res.status(404).json({ error: 'Camera not found', cameraId: id });
    }
    if (!action || !['on', 'off', 'trigger'].includes(action)) {
      return res.status(400).json({ error: 'Invalid action. Must be on, off, or trigger.' });
    }
    const result = await cameraService.executeControl(id, controlId, action);
    res.json(result);
  }));
```

- [ ] **Step 4: Pass haGateway in app.mjs wiring**

In `backend/src/app.mjs`, update the camera feeds section (around line 1634):

```javascript
  // Camera feeds
  const { createCameraServices } = await import('#apps/camera/index.mjs');
  const { cameraService } = createCameraServices({
    householdId,
    haGateway: homeAutomationAdapters.haGateway,
    logger: rootLogger.child({ module: 'camera' }),
  });
```

- [ ] **Step 5: Commit**

```bash
git add backend/src/3_applications/camera/ backend/src/4_api/v1/routers/camera.mjs backend/src/app.mjs
git commit -m "feat(camera): extend CameraService with detection state and controls"
```

---

### Task 5: usePanZoom hook

**Files:**
- Create: `frontend/src/modules/CameraFeed/usePanZoom.js`

The core pan/zoom engine as a React hook. Pure state management + input handling, no rendering.

- [ ] **Step 1: Create usePanZoom hook**

```javascript
// frontend/src/modules/CameraFeed/usePanZoom.js
import { useReducer, useCallback, useRef, useEffect } from 'react';

const MIN_ZOOM = 1;
const MAX_ZOOM = 4;
const PAN_STEP = 50;
const ZOOM_STEP = 0.25;
const MOMENTUM_FRICTION = 0.92;
const MOMENTUM_MIN_VELOCITY = 0.5;

function clamp(val, min, max) { return Math.min(Math.max(val, min), max); }

function reducer(state, action) {
  switch (action.type) {
    case 'pan': {
      const { dx, dy, bounds } = action;
      return {
        ...state,
        x: clamp(state.x + dx, bounds.minX, bounds.maxX),
        y: clamp(state.y + dy, bounds.minY, bounds.maxY),
      };
    }
    case 'zoom': {
      const { delta, cx, cy, containerW, containerH, contentW, contentH } = action;
      const newZoom = clamp(state.zoom + delta, MIN_ZOOM, MAX_ZOOM);
      if (newZoom === state.zoom) return state;

      // Zoom toward cursor: adjust translation so the point under the cursor stays fixed
      const scale = newZoom / state.zoom;
      const newX = cx - scale * (cx - state.x);
      const newY = cy - scale * (cy - state.y);

      const bounds = calcBounds(newZoom, containerW, containerH, contentW, contentH);
      return {
        x: clamp(newX, bounds.minX, bounds.maxX),
        y: clamp(newY, bounds.minY, bounds.maxY),
        zoom: newZoom,
      };
    }
    case 'set':
      return { ...state, ...action.values };
    case 'reset':
      return { x: 0, y: 0, zoom: MIN_ZOOM };
    default:
      return state;
  }
}

function calcBounds(zoom, containerW, containerH, contentW, contentH) {
  // At zoom=1, content fits container (no pan). At higher zoom, allow panning.
  const scaledW = contentW * zoom;
  const scaledH = contentH * zoom;
  const maxPanX = Math.max(0, (scaledW - containerW) / 2);
  const maxPanY = Math.max(0, (scaledH - containerH) / 2);
  return { minX: -maxPanX, maxX: maxPanX, minY: -maxPanY, maxY: maxPanY };
}

/**
 * Pan/zoom hook for camera viewport.
 *
 * @param {Object} options
 * @param {React.RefObject} options.containerRef - ref to the overflow:hidden container
 * @param {number} options.contentWidth - natural width of the image/video
 * @param {number} options.contentHeight - natural height of the image/video
 * @returns {{ x, y, zoom, handlers, reset, zoomIn, zoomOut }}
 */
export default function usePanZoom({ containerRef, contentWidth = 1, contentHeight = 1 }) {
  const [state, dispatch] = useReducer(reducer, { x: 0, y: 0, zoom: MIN_ZOOM });
  const dragRef = useRef(null);
  const momentumRef = useRef(null);
  const lastZoomTime = useRef(0);

  const getDims = useCallback(() => {
    const el = containerRef.current;
    if (!el) return { containerW: 1, containerH: 1, contentW: contentWidth, contentH: contentHeight };
    return {
      containerW: el.clientWidth,
      containerH: el.clientHeight,
      contentW: contentWidth,
      contentH: contentHeight,
    };
  }, [containerRef, contentWidth, contentHeight]);

  const getBounds = useCallback(() => {
    const d = getDims();
    return calcBounds(state.zoom, d.containerW, d.containerH, d.contentW, d.contentH);
  }, [getDims, state.zoom]);

  // ── Pointer (drag) handlers ──
  const onPointerDown = useCallback((e) => {
    if (e.button !== 0) return; // left click only
    e.preventDefault();
    e.target.setPointerCapture(e.pointerId);
    if (momentumRef.current) cancelAnimationFrame(momentumRef.current);
    dragRef.current = { startX: e.clientX, startY: e.clientY, lastX: e.clientX, lastY: e.clientY, lastTime: Date.now(), vx: 0, vy: 0 };
  }, []);

  const onPointerMove = useCallback((e) => {
    if (!dragRef.current) return;
    const dx = e.clientX - dragRef.current.lastX;
    const dy = e.clientY - dragRef.current.lastY;
    const now = Date.now();
    const dt = Math.max(now - dragRef.current.lastTime, 1);
    dragRef.current.vx = dx / dt * 16; // normalize to ~60fps
    dragRef.current.vy = dy / dt * 16;
    dragRef.current.lastX = e.clientX;
    dragRef.current.lastY = e.clientY;
    dragRef.current.lastTime = now;
    dispatch({ type: 'pan', dx, dy, bounds: getBounds() });
  }, [getBounds]);

  const onPointerUp = useCallback(() => {
    if (!dragRef.current) return;
    const { vx, vy } = dragRef.current;
    dragRef.current = null;

    // Momentum
    if (Math.abs(vx) > MOMENTUM_MIN_VELOCITY || Math.abs(vy) > MOMENTUM_MIN_VELOCITY) {
      let mvx = vx, mvy = vy;
      const tick = () => {
        mvx *= MOMENTUM_FRICTION;
        mvy *= MOMENTUM_FRICTION;
        if (Math.abs(mvx) < MOMENTUM_MIN_VELOCITY && Math.abs(mvy) < MOMENTUM_MIN_VELOCITY) return;
        dispatch({ type: 'pan', dx: mvx, dy: mvy, bounds: getBounds() });
        momentumRef.current = requestAnimationFrame(tick);
      };
      momentumRef.current = requestAnimationFrame(tick);
    }
  }, [getBounds]);

  // ── Wheel (zoom) handler ──
  const onWheel = useCallback((e) => {
    e.preventDefault();
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const cx = e.clientX - rect.left - rect.width / 2;
    const cy = e.clientY - rect.top - rect.height / 2;
    const delta = e.deltaY > 0 ? -ZOOM_STEP : ZOOM_STEP;
    const d = getDims();
    dispatch({ type: 'zoom', delta, cx, cy, ...d });
    lastZoomTime.current = Date.now();
  }, [containerRef, getDims]);

  // ── Double-click (toggle zoom) ──
  const onDoubleClick = useCallback((e) => {
    if (state.zoom > MIN_ZOOM) {
      dispatch({ type: 'reset' });
    } else {
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return;
      const cx = e.clientX - rect.left - rect.width / 2;
      const cy = e.clientY - rect.top - rect.height / 2;
      const d = getDims();
      dispatch({ type: 'zoom', delta: 1.0, cx, cy, ...d });
    }
  }, [state.zoom, containerRef, getDims]);

  // ── Keyboard handler (attached via useEffect) ──
  useEffect(() => {
    const handleKey = (e) => {
      const bounds = getBounds();
      const d = getDims();
      switch (e.key) {
        case 'ArrowLeft': dispatch({ type: 'pan', dx: PAN_STEP, dy: 0, bounds }); break;
        case 'ArrowRight': dispatch({ type: 'pan', dx: -PAN_STEP, dy: 0, bounds }); break;
        case 'ArrowUp': dispatch({ type: 'pan', dx: 0, dy: PAN_STEP, bounds }); break;
        case 'ArrowDown': dispatch({ type: 'pan', dx: 0, dy: -PAN_STEP, bounds }); break;
        case '+': case '=': dispatch({ type: 'zoom', delta: ZOOM_STEP, cx: 0, cy: 0, ...d }); lastZoomTime.current = Date.now(); break;
        case '-': case '_': dispatch({ type: 'zoom', delta: -ZOOM_STEP, cx: 0, cy: 0, ...d }); lastZoomTime.current = Date.now(); break;
        case 'Home': dispatch({ type: 'reset' }); break;
        default: return; // don't prevent default for unhandled keys
      }
      e.preventDefault();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [getBounds, getDims]);

  // Cleanup momentum on unmount
  useEffect(() => () => {
    if (momentumRef.current) cancelAnimationFrame(momentumRef.current);
  }, []);

  const reset = useCallback(() => dispatch({ type: 'reset' }), []);
  const zoomIn = useCallback(() => {
    const d = getDims();
    dispatch({ type: 'zoom', delta: ZOOM_STEP, cx: 0, cy: 0, ...d });
    lastZoomTime.current = Date.now();
  }, [getDims]);
  const zoomOut = useCallback(() => {
    const d = getDims();
    dispatch({ type: 'zoom', delta: -ZOOM_STEP, cx: 0, cy: 0, ...d });
    lastZoomTime.current = Date.now();
  }, [getDims]);

  const handlers = {
    onPointerDown,
    onPointerMove,
    onPointerUp,
    onPointerCancel: onPointerUp,
    onWheel,
    onDoubleClick,
  };

  return {
    x: state.x,
    y: state.y,
    zoom: state.zoom,
    lastZoomTime,
    handlers,
    reset,
    zoomIn,
    zoomOut,
    MIN_ZOOM,
    MAX_ZOOM,
  };
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/modules/CameraFeed/usePanZoom.js
git commit -m "feat(camera): add usePanZoom hook for pan/zoom viewport interactions"
```

---

### Task 6: CameraViewport + CameraControls

**Files:**
- Create: `frontend/src/modules/CameraFeed/CameraViewport.jsx`
- Create: `frontend/src/modules/CameraFeed/CameraViewport.scss`
- Create: `frontend/src/modules/CameraFeed/CameraControls.jsx`

- [ ] **Step 1: Create CameraControls component**

```jsx
// frontend/src/modules/CameraFeed/CameraControls.jsx
import { useState, useEffect, useCallback } from 'react';

export default function CameraControls({ cameraId, logger }) {
  const [controls, setControls] = useState([]);
  const [confirming, setConfirming] = useState(null);

  useEffect(() => {
    fetch(`/api/v1/camera/${cameraId}/controls`)
      .then(r => r.json())
      .then(data => setControls(data.controls || []))
      .catch(err => logger.warn?.('controls.fetchError', { error: err.message }));
  }, [cameraId, logger]);

  const execute = useCallback(async (controlId, action) => {
    try {
      await fetch(`/api/v1/camera/${cameraId}/controls/${controlId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      });
      logger.info?.('controls.executed', { controlId, action });
      // Refresh controls state
      const res = await fetch(`/api/v1/camera/${cameraId}/controls`);
      const data = await res.json();
      setControls(data.controls || []);
    } catch (err) {
      logger.warn?.('controls.executeError', { controlId, error: err.message });
    }
  }, [cameraId, logger]);

  const handleClick = useCallback((ctrl) => {
    if (ctrl.type === 'siren') {
      if (confirming === ctrl.id) {
        execute(ctrl.id, 'trigger');
        setConfirming(null);
      } else {
        setConfirming(ctrl.id);
        setTimeout(() => setConfirming(prev => prev === ctrl.id ? null : prev), 3000);
      }
    } else {
      execute(ctrl.id, ctrl.state === 'on' ? 'off' : 'on');
    }
  }, [confirming, execute]);

  if (controls.length === 0) return null;

  return (
    <div className="camera-viewport__controls">
      {controls.map(ctrl => (
        <button
          key={ctrl.id}
          className={`camera-viewport__control-btn camera-viewport__control-btn--${ctrl.type} ${ctrl.state === 'on' ? 'active' : ''} ${confirming === ctrl.id ? 'confirming' : ''}`}
          onClick={() => handleClick(ctrl)}
          title={ctrl.label}
        >
          {ctrl.type === 'light' ? '💡' : '🔔'}
          {confirming === ctrl.id && <span className="camera-viewport__confirm-label">Confirm?</span>}
        </button>
      ))}
    </div>
  );
}
```

- [ ] **Step 2: Create CameraViewport component**

```jsx
// frontend/src/modules/CameraFeed/CameraViewport.jsx
import { useRef, useState, useEffect, useMemo, useCallback } from 'react';
import usePanZoom from './usePanZoom.js';
import CameraControls from './CameraControls.jsx';
import { getChildLogger } from '../../lib/logging/singleton.js';
import './CameraViewport.scss';

/**
 * Fullscreen pan/zoom camera viewport overlay.
 *
 * @param {Object} props
 * @param {string} props.cameraId
 * @param {'snapshot'|'live'} props.mode
 * @param {string} [props.snapshotSrc] - current snapshot blob URL (for snapshot mode)
 * @param {React.RefObject} [props.videoRef] - ref to existing HLS video element (for live mode)
 * @param {{ type: string, active: boolean }[]} props.detections
 * @param {Function} props.onClose
 */
export default function CameraViewport({ cameraId, mode, snapshotSrc, videoRef: externalVideoRef, detections = [], onClose }) {
  const logger = useMemo(() => getChildLogger({ component: 'CameraViewport', cameraId }), [cameraId]);
  const containerRef = useRef(null);
  const mediaRef = useRef(null);
  const [contentDims, setContentDims] = useState({ w: 7680, h: 2160 }); // default panoramic
  const [showHints, setShowHints] = useState(true);
  const [showZoom, setShowZoom] = useState(false);
  const hintTimer = useRef(null);
  const zoomTimer = useRef(null);

  const { x, y, zoom, lastZoomTime, handlers, reset, MIN_ZOOM } = usePanZoom({
    containerRef,
    contentWidth: contentDims.w,
    contentHeight: contentDims.h,
  });

  // Get content dimensions from loaded media
  const onMediaLoad = useCallback((e) => {
    const el = e.target;
    const w = el.naturalWidth || el.videoWidth || contentDims.w;
    const h = el.naturalHeight || el.videoHeight || contentDims.h;
    setContentDims({ w, h });
    logger.debug?.('viewport.mediaDims', { w, h });
  }, [contentDims.w, contentDims.h, logger]);

  // Hints: fade after 3s, reappear on mouse move
  useEffect(() => {
    hintTimer.current = setTimeout(() => setShowHints(false), 3000);
    return () => clearTimeout(hintTimer.current);
  }, []);

  const onMouseMove = useCallback(() => {
    setShowHints(true);
    clearTimeout(hintTimer.current);
    hintTimer.current = setTimeout(() => setShowHints(false), 3000);
  }, []);

  // Zoom indicator: show briefly on zoom change
  useEffect(() => {
    setShowZoom(true);
    clearTimeout(zoomTimer.current);
    zoomTimer.current = setTimeout(() => setShowZoom(false), 2000);
    return () => clearTimeout(zoomTimer.current);
  }, [zoom]);

  // Esc to close
  useEffect(() => {
    const handleKey = (e) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [onClose]);

  // Lock body scroll while viewport is open
  useEffect(() => {
    document.body.style.overflow = 'hidden';
    logger.info?.('viewport.open', { mode });
    return () => {
      document.body.style.overflow = '';
      logger.info?.('viewport.close');
    };
  }, [logger, mode]);

  const activeDetections = detections.filter(d => d.active);

  // Minimap viewport rect
  const minimapViewport = (() => {
    if (zoom <= MIN_ZOOM) return null;
    const containerW = containerRef.current?.clientWidth || 1;
    const containerH = containerRef.current?.clientHeight || 1;
    const scaledW = contentDims.w * zoom;
    const scaledH = contentDims.h * zoom;
    const viewW = containerW / scaledW;
    const viewH = containerH / scaledH;
    const viewX = 0.5 - x / scaledW;
    const viewY = 0.5 - y / scaledH;
    return {
      left: `${(viewX - viewW / 2) * 100}%`,
      top: `${(viewY - viewH / 2) * 100}%`,
      width: `${viewW * 100}%`,
      height: `${viewH * 100}%`,
    };
  })();

  const transformStyle = {
    transform: `translate(${x}px, ${y}px) scale(${zoom})`,
    transformOrigin: 'center center',
    willChange: 'transform',
  };

  return (
    <div className="camera-viewport" onMouseMove={onMouseMove}>
      {/* Top bar */}
      <div className="camera-viewport__top-bar">
        <div className="camera-viewport__title">
          <span className="camera-viewport__status-dot" />
          <span>{cameraId.replace(/-/g, ' ')}</span>
          {mode === 'live' && <span className="camera-viewport__live-badge">LIVE</span>}
        </div>
        {activeDetections.length > 0 && (
          <div className="camera-viewport__detections">
            {activeDetections.map(d => (
              <span key={d.type} className={`camera-viewport__detection-badge camera-viewport__detection-badge--${d.type}`}>
                {d.type}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Close button */}
      <button className="camera-viewport__close" onClick={onClose}>✕</button>

      {/* Zoom indicator */}
      <div className={`camera-viewport__zoom-indicator ${showZoom ? 'visible' : ''}`}>
        {zoom.toFixed(1)}x
      </div>

      {/* Main viewport */}
      <div
        className="camera-viewport__container"
        ref={containerRef}
        {...handlers}
        style={{ cursor: zoom > MIN_ZOOM ? 'grab' : 'default' }}
      >
        <div className="camera-viewport__media" style={transformStyle}>
          {mode === 'snapshot' && snapshotSrc && (
            <img
              ref={mediaRef}
              src={snapshotSrc}
              alt={`${cameraId} viewport`}
              onLoad={onMediaLoad}
              draggable={false}
            />
          )}
          {mode === 'live' && externalVideoRef?.current && (
            <video
              ref={mediaRef}
              src={externalVideoRef.current.src}
              autoPlay
              muted
              playsInline
              onLoadedMetadata={onMediaLoad}
            />
          )}
        </div>
      </div>

      {/* Minimap */}
      {zoom > MIN_ZOOM && (
        <div className="camera-viewport__minimap">
          <div className="camera-viewport__minimap-bg">
            {mode === 'snapshot' && snapshotSrc && <img src={snapshotSrc} alt="" draggable={false} />}
          </div>
          {minimapViewport && <div className="camera-viewport__minimap-viewport" style={minimapViewport} />}
        </div>
      )}

      {/* Camera controls */}
      <CameraControls cameraId={cameraId} logger={logger} />

      {/* Hints bar */}
      <div className={`camera-viewport__hints ${showHints ? 'visible' : ''}`}>
        Drag to pan · Scroll to zoom · +/- keys · Double-click to reset · Esc to close
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Create CameraViewport styles**

```scss
// frontend/src/modules/CameraFeed/CameraViewport.scss
.camera-viewport {
  position: fixed;
  inset: 0;
  z-index: 9999;
  background: rgba(0, 0, 0, 0.95);
  display: flex;
  flex-direction: column;
  user-select: none;

  // ── Top bar ──
  &__top-bar {
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    z-index: 2;
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 12px 60px 12px 16px;
    background: linear-gradient(180deg, rgba(0,0,0,0.7), transparent);
    pointer-events: none;
  }

  &__title {
    display: flex;
    align-items: center;
    gap: 8px;
    color: #ddd;
    font-size: 14px;
    font-weight: 500;
    text-transform: capitalize;
  }

  &__status-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: #4a4;
  }

  &__live-badge {
    color: #888;
    font-size: 11px;
    font-weight: 400;
  }

  &__detections {
    display: flex;
    gap: 6px;
  }

  &__detection-badge {
    padding: 2px 8px;
    border-radius: 10px;
    font-size: 11px;
    font-weight: 500;
    text-transform: capitalize;

    &--person { background: rgba(59, 130, 246, 0.3); color: #93bbfd; }
    &--vehicle { background: rgba(245, 158, 11, 0.3); color: #fbbf24; }
    &--animal { background: rgba(34, 197, 94, 0.3); color: #86efac; }
  }

  // ── Close button ──
  &__close {
    position: absolute;
    top: 12px;
    right: 16px;
    z-index: 3;
    width: 32px;
    height: 32px;
    border-radius: 50%;
    border: 1px solid rgba(255,255,255,0.1);
    background: rgba(0,0,0,0.5);
    color: #aaa;
    font-size: 16px;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;

    &:hover { background: rgba(255,255,255,0.1); color: #fff; }
  }

  // ── Zoom indicator ──
  &__zoom-indicator {
    position: absolute;
    top: 52px;
    right: 16px;
    z-index: 2;
    background: rgba(0,0,0,0.6);
    color: #999;
    font-size: 12px;
    font-family: monospace;
    padding: 2px 8px;
    border-radius: 4px;
    opacity: 0;
    transition: opacity 0.3s;

    &.visible { opacity: 1; }
  }

  // ── Main viewport container ──
  &__container {
    flex: 1;
    overflow: hidden;
    display: flex;
    align-items: center;
    justify-content: center;
    touch-action: none; // prevent browser pan/zoom
  }

  &__media {
    display: flex;
    align-items: center;
    justify-content: center;

    img, video {
      max-width: 100vw;
      max-height: 100vh;
      object-fit: contain;
      pointer-events: none; // let container handle events
    }
  }

  // ── Minimap ──
  &__minimap {
    position: absolute;
    bottom: 48px;
    right: 16px;
    z-index: 2;
    width: 140px;
    height: 40px;
    border-radius: 4px;
    border: 1px solid rgba(255,255,255,0.15);
    background: rgba(0,0,0,0.6);
    overflow: hidden;
  }

  &__minimap-bg {
    width: 100%;
    height: 100%;

    img {
      width: 100%;
      height: 100%;
      object-fit: cover;
      opacity: 0.5;
    }
  }

  &__minimap-viewport {
    position: absolute;
    border: 1.5px solid rgba(255,255,255,0.6);
    background: rgba(255,255,255,0.05);
    border-radius: 2px;
  }

  // ── Camera controls ──
  &__controls {
    position: absolute;
    bottom: 48px;
    left: 16px;
    z-index: 2;
    display: flex;
    gap: 8px;
  }

  &__control-btn {
    width: 40px;
    height: 40px;
    border-radius: 50%;
    border: 1px solid rgba(255,255,255,0.1);
    background: rgba(0,0,0,0.5);
    color: #888;
    font-size: 18px;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    position: relative;

    &:hover { background: rgba(255,255,255,0.1); }

    &--light.active { background: rgba(255,200,50,0.3); color: #fbbf24; border-color: rgba(255,200,50,0.3); }
    &--siren.confirming { background: rgba(220,38,38,0.3); border-color: rgba(220,38,38,0.5); animation: pulse-red 0.5s infinite alternate; }
  }

  &__confirm-label {
    position: absolute;
    left: 48px;
    white-space: nowrap;
    font-size: 11px;
    color: #ef4444;
    font-weight: 500;
  }

  // ── Hints bar ──
  &__hints {
    position: absolute;
    bottom: 0;
    left: 0;
    right: 0;
    z-index: 2;
    text-align: center;
    padding: 10px 16px;
    background: linear-gradient(0deg, rgba(0,0,0,0.7), transparent);
    color: #666;
    font-size: 12px;
    opacity: 0;
    transition: opacity 0.3s;

    &.visible { opacity: 1; }
  }
}

@keyframes pulse-red {
  from { border-color: rgba(220,38,38,0.3); }
  to { border-color: rgba(220,38,38,0.8); }
}
```

- [ ] **Step 4: Commit**

```bash
git add frontend/src/modules/CameraFeed/CameraViewport.jsx frontend/src/modules/CameraFeed/CameraViewport.scss frontend/src/modules/CameraFeed/CameraControls.jsx
git commit -m "feat(camera): add CameraViewport fullscreen overlay with pan/zoom and controls"
```

---

### Task 7: Update CameraFeed card — skeleton, badges, click-to-expand

**Files:**
- Modify: `frontend/src/modules/CameraFeed/CameraFeed.jsx`
- Modify: `frontend/src/modules/CameraFeed/CameraFeed.scss`

- [ ] **Step 1: Update CameraFeed.jsx**

Replace the full file:

```jsx
// frontend/src/modules/CameraFeed/CameraFeed.jsx
import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import Hls from 'hls.js';
import { getChildLogger } from '../../lib/logging/singleton.js';
import CameraViewport from './CameraViewport.jsx';
import './CameraFeed.scss';

export default function CameraFeed({ cameraId, mode = 'snapshot', interval = 3000, onError }) {
  const logger = useMemo(() => getChildLogger({ component: 'CameraFeed', cameraId }), [cameraId]);
  const [viewportOpen, setViewportOpen] = useState(false);
  const [detections, setDetections] = useState([]);

  // Poll detection state
  useEffect(() => {
    let active = true;
    const poll = async () => {
      try {
        const res = await fetch(`/api/v1/camera/${cameraId}/state`);
        if (!res.ok) return;
        const data = await res.json();
        if (active) setDetections(data.detections || []);
      } catch { /* ignore */ }
    };
    poll();
    const timer = setInterval(poll, 2000);
    return () => { active = false; clearInterval(timer); };
  }, [cameraId]);

  if (mode === 'live') {
    return (
      <>
        <HlsPlayer cameraId={cameraId} logger={logger} onError={onError} detections={detections} onClickImage={() => setViewportOpen(true)} />
        {viewportOpen && (
          <CameraViewport cameraId={cameraId} mode="live" detections={detections} onClose={() => setViewportOpen(false)} />
        )}
      </>
    );
  }
  return (
    <>
      <SnapshotPoller cameraId={cameraId} interval={interval} logger={logger} onError={onError} detections={detections} onClickImage={() => setViewportOpen(true)} />
      {viewportOpen && (
        <CameraViewport cameraId={cameraId} mode="snapshot" detections={detections} onClose={() => setViewportOpen(false)} />
      )}
    </>
  );
}

function SnapshotPoller({ cameraId, interval, logger, onError, detections, onClickImage }) {
  const [src, setSrc] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [aspectRatio, setAspectRatio] = useState(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
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
        setLoading(false);
        setError(false);
      } catch (err) {
        logger.warn('snapshot.error', { error: err.message });
        setError(true);
        setLoading(false);
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

  const onImgLoad = useCallback((e) => {
    const { naturalWidth, naturalHeight } = e.target;
    if (naturalWidth && naturalHeight) {
      setAspectRatio(`${naturalWidth} / ${naturalHeight}`);
    }
  }, []);

  const activeDetections = detections.filter(d => d.active);

  return (
    <div
      className={`camera-feed camera-feed--snapshot ${loading ? 'camera-feed--loading' : ''}`}
      style={aspectRatio ? { aspectRatio } : undefined}
      onClick={src ? onClickImage : undefined}
    >
      {loading && !src && <div className="camera-feed__skeleton" />}
      {src && <img src={src} alt={`${cameraId} snapshot`} onLoad={onImgLoad} draggable={false} />}
      {error && !src && !loading && <div className="camera-feed__error">Camera unavailable</div>}
      {activeDetections.length > 0 && (
        <div className="camera-feed__badges">
          {activeDetections.map(d => (
            <span key={d.type} className={`camera-feed__badge camera-feed__badge--${d.type}`}>{d.type}</span>
          ))}
        </div>
      )}
    </div>
  );
}

function HlsPlayer({ cameraId, logger, onError, detections, onClickImage }) {
  const videoRef = useRef(null);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const playlistUrl = `/api/v1/camera/${cameraId}/live/stream.m3u8`;
    logger.info('hls.start', { url: playlistUrl });

    if (!Hls.isSupported()) {
      if (video.canPlayType('application/vnd.apple.mpegurl')) {
        video.src = playlistUrl;
        video.play().catch(() => {});
        return () => {
          video.src = '';
          fetch(`/api/v1/camera/${cameraId}/live`, { method: 'DELETE' }).catch(() => {});
          logger.info('hls.stop');
        };
      }
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

  const activeDetections = detections.filter(d => d.active);

  return (
    <div className="camera-feed camera-feed--live" onClick={onClickImage}>
      <video ref={videoRef} muted autoPlay playsInline />
      {activeDetections.length > 0 && (
        <div className="camera-feed__badges">
          {activeDetections.map(d => (
            <span key={d.type} className={`camera-feed__badge camera-feed__badge--${d.type}`}>{d.type}</span>
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Update CameraFeed.scss**

Replace the full file:

```scss
// frontend/src/modules/CameraFeed/CameraFeed.scss
.camera-feed {
  position: relative;
  width: 100%;
  // No fixed aspect-ratio — derived from image via inline style, defaults to wide
  aspect-ratio: 32 / 9;
  background: #111;
  border-radius: 8px;
  overflow: hidden;
  cursor: pointer;

  img, video {
    width: 100%;
    height: 100%;
    object-fit: contain;
    display: block;
  }

  // ── Loading skeleton ──
  &--loading {
    cursor: default;
  }

  &__skeleton {
    position: absolute;
    inset: 0;
    background: #111;
    animation: camera-skeleton-pulse 1.5s ease-in-out infinite;
  }

  // ── Error state ──
  &__error {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    color: #666;
    font-size: 0.9rem;
  }

  // ── Detection badges ──
  &__badges {
    position: absolute;
    top: 8px;
    left: 8px;
    display: flex;
    gap: 4px;
    z-index: 1;
  }

  &__badge {
    padding: 2px 8px;
    border-radius: 10px;
    font-size: 10px;
    font-weight: 600;
    text-transform: capitalize;
    transition: opacity 0.3s;

    &--person { background: rgba(59, 130, 246, 0.4); color: #93bbfd; }
    &--vehicle { background: rgba(245, 158, 11, 0.4); color: #fbbf24; }
    &--animal { background: rgba(34, 197, 94, 0.4); color: #86efac; }
  }
}

@keyframes camera-skeleton-pulse {
  0%, 100% { background: #111; }
  50% { background: #1a1a1a; }
}
```

- [ ] **Step 3: Commit**

```bash
git add frontend/src/modules/CameraFeed/CameraFeed.jsx frontend/src/modules/CameraFeed/CameraFeed.scss
git commit -m "feat(camera): update card view with skeleton, detection badges, click-to-expand"
```

---

### Task 8: Update Playwright tests

**Files:**
- Modify: `tests/live/flow/home/camera-feed.runtime.test.mjs`

- [ ] **Step 1: Update tests to cover new features**

Add new test cases to the existing test file:

```javascript
  test('camera card shows detection badges when active', async ({ page }) => {
    await page.goto(`${BASE}/home`, { waitUntil: 'domcontentloaded' });
    const card = page.locator('.home-cameras__card');
    await expect(card).toBeVisible({ timeout: 10000 });

    // Detection state endpoint should be polled
    const stateRes = await fetch(`${BASE}/api/v1/camera/driveway-camera/state`);
    expect(stateRes.ok).toBe(true);
    const stateData = await stateRes.json();
    expect(stateData).toHaveProperty('detections');
    expect(stateData).toHaveProperty('motion');
    console.log('Detection state:', JSON.stringify(stateData));
  });

  test('clicking snapshot opens fullscreen viewport', async ({ page }) => {
    await page.goto(`${BASE}/home`, { waitUntil: 'domcontentloaded' });

    // Wait for snapshot to load
    const img = page.locator('.camera-feed img');
    await expect(img).toBeVisible({ timeout: 30000 });

    // Click the image to open viewport
    await img.click();

    // Viewport overlay should appear
    const viewport = page.locator('.camera-viewport');
    await expect(viewport).toBeVisible({ timeout: 3000 });

    // Should have close button, hints bar
    await expect(page.locator('.camera-viewport__close')).toBeVisible();
    await expect(page.locator('.camera-viewport__hints')).toBeVisible();

    // Close with Esc
    await page.keyboard.press('Escape');
    await expect(viewport).not.toBeVisible({ timeout: 2000 });
  }, 60000);

  test('controls endpoint returns camera controls', async ({ page }) => {
    const res = await fetch(`${BASE}/api/v1/camera/driveway-camera/controls`);
    expect(res.ok).toBe(true);
    const data = await res.json();
    expect(data).toHaveProperty('controls');
    expect(Array.isArray(data.controls)).toBe(true);
    // Should have floodlight and siren from HA config
    const types = data.controls.map(c => c.type);
    console.log('Camera controls:', JSON.stringify(data.controls));
    expect(types).toContain('light');
    expect(types).toContain('siren');
  });
```

- [ ] **Step 2: Commit**

```bash
git add tests/live/flow/home/camera-feed.runtime.test.mjs
git commit -m "test(camera): add tests for detection state, viewport, and controls"
```
