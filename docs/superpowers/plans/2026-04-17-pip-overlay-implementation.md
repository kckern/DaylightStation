# PIP Overlay Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a generic PIP overlay system to the screen framework, with doorbell camera feed as the primary use case.

**Architecture:** New `PipManager` provider between `ScreenOverlayProvider` and `ScreenProvider` owns PIP state machine (idle/visible/fullscreen). Subscriptions route `mode: pip` to PipManager. Backend webhook endpoint broadcasts doorbell events to WebSocket clients.

**Tech Stack:** React context/provider, CSS transitions, Express router, WebSocket event bus

**Spec:** `docs/superpowers/specs/2026-04-17-pip-overlay-design.md`

---

### Task 1: PipManager Provider — State Machine and Context

**Files:**
- Create: `frontend/src/screen-framework/pip/PipManager.jsx`

This is the core of the feature. PipManager provides `usePip()` context with `show()`, `dismiss()`, `promote()`, `state`, and `hasPip`. It manages the IDLE → VISIBLE → FULLSCREEN state machine with a dismiss timer.

- [ ] **Step 1: Create PipManager.jsx with provider, context, and state machine**

```jsx
// frontend/src/screen-framework/pip/PipManager.jsx
import React, { createContext, useContext, useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { useScreenOverlay } from '../overlays/ScreenOverlayProvider.jsx';
import getLogger from '../../lib/logging/Logger.js';
import './PipManager.css';

let _logger;
function logger() {
  if (!_logger) _logger = getLogger().child({ component: 'PipManager' });
  return _logger;
}

const PipContext = createContext(null);

const DEFAULTS = {
  position: 'bottom-right',
  size: 25,
  margin: 16,
  timeout: 30,
};

export function PipManager({ config: screenPipConfig, children }) {
  const { showOverlay, dismissOverlay } = useScreenOverlay();

  const [state, setState] = useState('idle'); // idle | visible | fullscreen
  const [content, setContent] = useState(null); // { Component, props, config }
  const [animating, setAnimating] = useState(false); // for slide-in/out
  const timerRef = useRef(null);
  const contentRef = useRef(null); // for promote() to access current content

  // Merge screen-level defaults with per-call config
  const mergeConfig = useCallback((callConfig = {}) => {
    return { ...DEFAULTS, ...screenPipConfig, ...callConfig };
  }, [screenPipConfig]);

  const dismissRef = useRef(null); // stable ref for timer callback

  const clearTimer = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const startTimer = useCallback((timeoutSec) => {
    clearTimer();
    if (timeoutSec > 0) {
      timerRef.current = setTimeout(() => {
        logger().info('pip.timeout', { timeoutSec });
        dismissRef.current?.();
      }, timeoutSec * 1000);
    }
  }, [clearTimer]);

  const show = useCallback((Component, props = {}, callConfig = {}) => {
    const merged = mergeConfig(callConfig);
    const newContent = { Component, props, config: merged };
    contentRef.current = newContent;
    setContent(newContent);

    if (state === 'visible') {
      // Already showing — reset timer, update content
      logger().debug('pip.refresh', { position: merged.position });
      startTimer(merged.timeout);
    } else {
      logger().info('pip.show', { position: merged.position, size: merged.size, timeout: merged.timeout });
      setAnimating(true);
      setState('visible');
      startTimer(merged.timeout);
      // Animation class triggers slide-in via CSS; after transition, clear animating flag
      requestAnimationFrame(() => {
        requestAnimationFrame(() => setAnimating(false));
      });
    }
  }, [state, mergeConfig, startTimer]);

  const dismiss = useCallback(() => {
    if (state === 'idle') return;
    clearTimer();

    if (state === 'fullscreen') {
      logger().info('pip.dismiss-fullscreen');
      dismissOverlay('fullscreen');
      setState('idle');
      setContent(null);
      contentRef.current = null;
      return;
    }

    logger().info('pip.dismiss');
    setAnimating(true);
    // Let CSS slide-out transition play, then clean up
    setTimeout(() => {
      setState('idle');
      setContent(null);
      contentRef.current = null;
      setAnimating(false);
    }, 300); // match CSS transition duration
  }, [state, clearTimer, dismissOverlay]);

  // Keep ref in sync for timer callback
  dismissRef.current = dismiss;

  const promote = useCallback(() => {
    if (state !== 'visible') return;
    clearTimer();

    const cur = contentRef.current;
    if (!cur) return;

    logger().info('pip.promote', { component: cur.Component?.name });
    setState('fullscreen');
    setContent(null);

    // Show the content's fullscreen counterpart via overlay provider
    // Pass cameraId if present so CameraViewport gets it
    const fullscreenProps = { ...cur.props, dismiss: () => dismiss() };
    showOverlay(cur.Component, fullscreenProps, { mode: 'fullscreen', priority: 'high' });
  }, [state, clearTimer, showOverlay, dismiss]);

  // Clean up timer on unmount
  useEffect(() => {
    return () => clearTimer();
  }, [clearTimer]);

  const hasPip = state !== 'idle';

  const ctx = useMemo(() => ({
    show, dismiss, promote, state, hasPip,
  }), [show, dismiss, promote, state, hasPip]);

  // Compute position/size styles
  const pipStyle = useMemo(() => {
    if (!content || state !== 'visible') return {};
    const { position, size, margin } = content.config;
    const style = {
      position: 'absolute',
      zIndex: 1001,
      width: `${size}vw`,
      aspectRatio: '16 / 9',
      overflow: 'hidden',
      borderRadius: '8px',
      boxShadow: '0 4px 24px rgba(0,0,0,0.5)',
    };
    // Position
    if (position.includes('top')) style.top = `${margin}px`;
    if (position.includes('bottom')) style.bottom = `${margin}px`;
    if (position.includes('right')) style.right = `${margin}px`;
    if (position.includes('left')) style.left = `${margin}px`;
    return style;
  }, [content, state]);

  // Determine animation class
  const animClass = useMemo(() => {
    if (state !== 'visible') return '';
    const pos = content?.config?.position || 'bottom-right';
    if (animating) return `pip-container--entering pip-container--from-${pos}`;
    return 'pip-container--visible';
  }, [state, content, animating]);

  return (
    <PipContext.Provider value={ctx}>
      {children}
      {state === 'visible' && content && (
        <div className={`pip-container ${animClass}`} style={pipStyle}>
          <content.Component {...content.props} dismiss={dismiss} />
        </div>
      )}
    </PipContext.Provider>
  );
}

export function usePip() {
  const ctx = useContext(PipContext);
  if (!ctx) {
    return { show: () => {}, dismiss: () => {}, promote: () => {}, state: 'idle', hasPip: false };
  }
  return ctx;
}
```

- [ ] **Step 2: Verify file created correctly**

Run: `head -5 frontend/src/screen-framework/pip/PipManager.jsx`
Expected: First 5 lines of the file showing the import block.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/screen-framework/pip/PipManager.jsx
git commit -m "feat(pip): add PipManager provider with state machine and context"
```

---

### Task 2: PipManager CSS — Positioning and Animations

**Files:**
- Create: `frontend/src/screen-framework/pip/PipManager.css`
- Modify: `frontend/src/screen-framework/overlays/ScreenOverlayProvider.css` (remove hardcoded pip styles)

- [ ] **Step 1: Create PipManager.css with slide-in/out animations**

```css
/* frontend/src/screen-framework/pip/PipManager.css */

/* Base container — always has position set via inline styles from PipManager */
.pip-container {
  transition: transform 0.3s ease-out, opacity 0.3s ease-out;
  transform: translate(0, 0);
  opacity: 1;
}

/* Visible state (resting position) */
.pip-container--visible {
  transform: translate(0, 0);
  opacity: 1;
}

/* Entering from each edge */
.pip-container--entering.pip-container--from-bottom-right {
  transform: translate(100%, 0);
  opacity: 0;
}

.pip-container--entering.pip-container--from-bottom-left {
  transform: translate(-100%, 0);
  opacity: 0;
}

.pip-container--entering.pip-container--from-top-right {
  transform: translate(100%, 0);
  opacity: 0;
}

.pip-container--entering.pip-container--from-top-left {
  transform: translate(-100%, 0);
  opacity: 0;
}
```

- [ ] **Step 2: Remove hardcoded pip styles from ScreenOverlayProvider.css**

In `frontend/src/screen-framework/overlays/ScreenOverlayProvider.css`, remove lines 23–48 (the `.screen-overlay--pip` and `.screen-overlay--pip-*` rules). Keep the fullscreen and toast styles untouched.

After removal, the file should contain:
- `.screen-overlay-layer` (legacy)
- `.screen-overlay--fullscreen`
- `.screen-overlay--toast-stack`
- `.screen-overlay--toast`

- [ ] **Step 3: Commit**

```bash
git add frontend/src/screen-framework/pip/PipManager.css frontend/src/screen-framework/overlays/ScreenOverlayProvider.css
git commit -m "feat(pip): add PipManager CSS animations, remove hardcoded pip styles from overlay provider"
```

---

### Task 3: Wire PipManager into ScreenRenderer

**Files:**
- Modify: `frontend/src/screen-framework/ScreenRenderer.jsx`

Insert PipManager between `ScreenOverlayProvider` and `ScreenProvider` in the provider hierarchy. Pass the screen-level `pip` config from the YAML config.

- [ ] **Step 1: Add PipManager import**

At the top of `ScreenRenderer.jsx`, add after the existing imports (around line 12):

```javascript
import { PipManager } from './pip/PipManager.jsx';
```

- [ ] **Step 2: Insert PipManager into the provider hierarchy**

In the render tree (around line 268), wrap the content between `ScreenOverlayProvider` and `ScreenProvider` with `PipManager`:

Replace:
```jsx
            <ScreenOverlayProvider>
              <ScreenAutoplay routes={config.routes} />
              <ScreenActionHandler actions={config.actions} />
              <ScreenCommandHandler wsConfig={config.websocket} screenId={screenId} />
              <ScreenSubscriptionHandler subscriptions={config.subscriptions} />
              <ScreenProvider config={config.layout}>
                <PanelRenderer />
              </ScreenProvider>
            </ScreenOverlayProvider>
```

With:
```jsx
            <ScreenOverlayProvider>
              <PipManager config={config.pip}>
                <ScreenAutoplay routes={config.routes} />
                <ScreenActionHandler actions={config.actions} />
                <ScreenCommandHandler wsConfig={config.websocket} screenId={screenId} />
                <ScreenSubscriptionHandler subscriptions={config.subscriptions} />
                <ScreenProvider config={config.layout}>
                  <PanelRenderer />
                </ScreenProvider>
              </PipManager>
            </ScreenOverlayProvider>
```

- [ ] **Step 3: Commit**

```bash
git add frontend/src/screen-framework/ScreenRenderer.jsx
git commit -m "feat(pip): wire PipManager into ScreenRenderer provider hierarchy"
```

---

### Task 4: Route Subscriptions Through PipManager

**Files:**
- Modify: `frontend/src/screen-framework/subscriptions/useScreenSubscriptions.js`
- Modify: `frontend/src/screen-framework/ScreenRenderer.jsx` (pass pip context to handler)

The subscription handler needs to call `pip.show()` when `mode: pip` instead of `showOverlay()`, and `pip.dismiss()` on dismiss events. It should also parse the `response.pip` config block.

- [ ] **Step 1: Add pip config parsing to the entries normalization**

In `useScreenSubscriptions.js`, update the `useMemo` block (around line 43) to parse the `response.pip` block:

Replace:
```javascript
    return Object.entries(subscriptions).map(([topic, cfg]) => ({
      topic,
      onEvent: cfg?.on?.event ?? null,
      overlay: cfg?.response?.overlay ?? null,
      mode: cfg?.response?.mode ?? 'fullscreen',
      priority: cfg?.response?.priority ?? undefined,
      timeout: cfg?.response?.timeout ?? undefined,
      dismissEvent: cfg?.dismiss?.event ?? null,
      dismissInactivity: cfg?.dismiss?.inactivity ?? null,
      guard: cfg?.guard ?? null,
      alsoOnEvent: cfg?.also_on?.event ?? null,
      alsoOnCondition: cfg?.also_on?.condition ?? null,
    }));
```

With:
```javascript
    return Object.entries(subscriptions).map(([topic, cfg]) => ({
      topic,
      onEvent: cfg?.on?.event ?? null,
      overlay: cfg?.response?.overlay ?? null,
      mode: cfg?.response?.mode ?? 'fullscreen',
      priority: cfg?.response?.priority ?? undefined,
      timeout: cfg?.response?.timeout ?? undefined,
      pipConfig: cfg?.response?.pip ?? null,
      dismissEvent: cfg?.dismiss?.event ?? null,
      dismissInactivity: cfg?.dismiss?.inactivity ?? null,
      guard: cfg?.guard ?? null,
      alsoOnEvent: cfg?.also_on?.event ?? null,
      alsoOnCondition: cfg?.also_on?.condition ?? null,
    }));
```

- [ ] **Step 2: Add pip parameter to the hook signature**

Update the function signature to accept a `pip` object:

Replace:
```javascript
export function useScreenSubscriptions(subscriptions, showOverlay, dismissOverlay, widgetRegistry, { hasOverlay = false } = {}) {
```

With:
```javascript
export function useScreenSubscriptions(subscriptions, showOverlay, dismissOverlay, widgetRegistry, { hasOverlay = false, pip = null } = {}) {
```

Store the pip ref for use in the callback:

After `hasOverlayRef.current = hasOverlay;` (line 41), add:
```javascript
  const pipRef = useRef(pip);
  pipRef.current = pip;
```

- [ ] **Step 3: Route pip-mode overlays to PipManager in handleMessage**

In the `handleMessage` callback, find the dismiss event check (around line 90). Update it to handle pip dismissals:

Replace:
```javascript
      // Check dismiss event first
      if (entry.dismissEvent && eventName === entry.dismissEvent) {
        logger().debug('subscription.dismiss', { topic: entry.topic, dismissEvent: eventName });
        dismissOverlay(entry.mode);
```

With:
```javascript
      // Check dismiss event first
      if (entry.dismissEvent && eventName === entry.dismissEvent) {
        logger().debug('subscription.dismiss', { topic: entry.topic, dismissEvent: eventName, mode: entry.mode });
        if (entry.mode === 'pip' && pipRef.current) {
          pipRef.current.dismiss();
        } else {
          dismissOverlay(entry.mode);
        }
```

Then find the `showOverlay` call (around line 142). Update it to route pip-mode to PipManager:

Replace:
```javascript
      logger().info('subscription.show-overlay', { topic: entry.topic, overlay: entry.overlay, mode: entry.mode, event: eventName });
      showOverlay(Component, { ...data, onClose: dismissFn, onSessionEnd: dismissFn }, {
        mode: entry.mode,
        priority: entry.priority,
        timeout: entry.timeout,
      });

      // Start inactivity timer if configured
      if (entry.dismissInactivity != null && entry.dismissInactivity > 0) {
        // Clear any existing timer for this topic
        if (inactivityTimers.current[entry.topic]) {
          clearTimeout(inactivityTimers.current[entry.topic]);
        }
        inactivityTimers.current[entry.topic] = setTimeout(() => {
          dismissOverlay(entry.mode);
          delete inactivityTimers.current[entry.topic];
        }, entry.dismissInactivity * 1000);
      }
```

With:
```javascript
      if (entry.mode === 'pip' && pipRef.current) {
        // Route to PipManager — it owns the dismiss timer
        const pipDismissFn = () => pipRef.current?.dismiss();
        logger().info('subscription.show-pip', { topic: entry.topic, overlay: entry.overlay, event: eventName });
        pipRef.current.show(Component, { ...data, onClose: pipDismissFn, onSessionEnd: pipDismissFn }, entry.pipConfig || {});
        // PipManager owns the timeout — skip subscription-level inactivity timer
      } else {
        logger().info('subscription.show-overlay', { topic: entry.topic, overlay: entry.overlay, mode: entry.mode, event: eventName });
        showOverlay(Component, { ...data, onClose: dismissFn, onSessionEnd: dismissFn }, {
          mode: entry.mode,
          priority: entry.priority,
          timeout: entry.timeout,
        });

        // Start inactivity timer if configured
        if (entry.dismissInactivity != null && entry.dismissInactivity > 0) {
          // Clear any existing timer for this topic
          if (inactivityTimers.current[entry.topic]) {
            clearTimeout(inactivityTimers.current[entry.topic]);
          }
          inactivityTimers.current[entry.topic] = setTimeout(() => {
            dismissOverlay(entry.mode);
            delete inactivityTimers.current[entry.topic];
          }, entry.dismissInactivity * 1000);
        }
      }
```

- [ ] **Step 4: Pass pip context to ScreenSubscriptionHandler**

In `ScreenRenderer.jsx`, update `ScreenSubscriptionHandler` to pass pip context:

Replace:
```jsx
function ScreenSubscriptionHandler({ subscriptions }) {
  const { showOverlay, dismissOverlay, hasOverlay } = useScreenOverlay();
  const registry = useMemo(() => getWidgetRegistry(), []);
  useScreenSubscriptions(subscriptions, showOverlay, dismissOverlay, registry, { hasOverlay });
  return null;
}
```

With:
```jsx
function ScreenSubscriptionHandler({ subscriptions }) {
  const { showOverlay, dismissOverlay, hasOverlay } = useScreenOverlay();
  const pip = usePip();
  const registry = useMemo(() => getWidgetRegistry(), []);
  useScreenSubscriptions(subscriptions, showOverlay, dismissOverlay, registry, { hasOverlay, pip });
  return null;
}
```

Add the `usePip` import at the top of `ScreenRenderer.jsx` (update the existing PipManager import):

```javascript
import { PipManager, usePip } from './pip/PipManager.jsx';
```

- [ ] **Step 5: Commit**

```bash
git add frontend/src/screen-framework/subscriptions/useScreenSubscriptions.js frontend/src/screen-framework/ScreenRenderer.jsx
git commit -m "feat(pip): route mode:pip subscriptions through PipManager"
```

---

### Task 5: PIP Actions and Escape Chain

**Files:**
- Modify: `frontend/src/screen-framework/actions/ScreenActionHandler.jsx`

Add `pip:promote` and `pip:dismiss` action handlers, and insert PIP dismissal as the first step in the escape chain.

- [ ] **Step 1: Add usePip import**

At the top of `ScreenActionHandler.jsx`, add:

```javascript
import { usePip } from '../pip/PipManager.jsx';
```

- [ ] **Step 2: Get pip context inside the component**

Inside the `ScreenActionHandler` function (after line 38), add:

```javascript
  const pip = usePip();
```

- [ ] **Step 3: Add pip:promote handler**

After the `handleDisplayOverlay` callback (around line 304), add:

```javascript
  // --- PIP promote ---
  const handlePipPromote = useCallback(() => {
    if (pip.state !== 'visible') return;
    logger().info('pip.action.promote');
    pip.promote();
  }, [pip]);

  // --- PIP dismiss ---
  const handlePipDismiss = useCallback(() => {
    if (!pip.hasPip) return;
    logger().info('pip.action.dismiss');
    pip.dismiss();
  }, [pip]);
```

- [ ] **Step 4: Register the new action handlers**

After the existing `useScreenAction` calls (around line 315), add:

```javascript
  useScreenAction('pip:promote', handlePipPromote);
  useScreenAction('pip:dismiss', handlePipDismiss);
```

- [ ] **Step 5: Update the escape handler to check PIP first**

In the `handleEscape` callback, add PIP check as the first action after the escape interceptor check.

Find this block (around line 237):
```javascript
  const handleEscape = useCallback(() => {
    // First priority: let any registered interceptor handle escape
    // (e.g., MenuStack pops its navigation stack before the framework acts)
    if (escapeInterceptorRef?.current) {
      const handled = escapeInterceptorRef.current();
      if (handled) {
        logger().debug('escape.intercepted', {});
        return;
      }
    }

    const shaderActive = shaderRef.current && parseFloat(shaderRef.current.style.opacity) > 0;
```

Replace with:
```javascript
  const handleEscape = useCallback(() => {
    // First priority: let any registered interceptor handle escape
    // (e.g., MenuStack pops its navigation stack before the framework acts)
    if (escapeInterceptorRef?.current) {
      const handled = escapeInterceptorRef.current();
      if (handled) {
        logger().debug('escape.intercepted', {});
        return;
      }
    }

    // Second priority: dismiss PIP if visible
    if (pip.hasPip) {
      logger().debug('escape.pip-dismiss', {});
      pip.dismiss();
      return;
    }

    const shaderActive = shaderRef.current && parseFloat(shaderRef.current.style.opacity) > 0;
```

Update the `handleEscape` dependency array to include `pip`:

Find:
```javascript
  }, [dismissOverlay, hasOverlay, actions]);
```

Replace with:
```javascript
  }, [dismissOverlay, hasOverlay, actions, pip]);
```

- [ ] **Step 6: Commit**

```bash
git add frontend/src/screen-framework/actions/ScreenActionHandler.jsx
git commit -m "feat(pip): add pip:promote/dismiss actions and escape chain integration"
```

---

### Task 6: CameraOverlay — Accept cameraId Prop

**Files:**
- Modify: `frontend/src/modules/CameraFeed/CameraOverlay.jsx`

When a `cameraId` prop is passed (from the doorbell subscription data), skip the camera list fetch and use it directly.

- [ ] **Step 1: Update CameraOverlay to accept cameraId prop**

Replace the entire `CameraOverlay` component:

```jsx
export default function CameraOverlay({ dismiss, crop = true, cameraId: propCameraId }) {
  const logger = useMemo(() => getChildLogger({ component: 'CameraOverlay' }), []);
  const [camera, setCamera] = useState(propCameraId ? { id: propCameraId } : null);
  const [error, setError] = useState(null);

  useEffect(() => {
    // If cameraId was passed as prop, skip fetch
    if (propCameraId) {
      logger.info('cameraOverlay.direct', { cameraId: propCameraId });
      return;
    }

    fetch('/api/v1/camera')
      .then(r => r.json())
      .then(data => {
        const cameras = data.cameras || [];
        if (cameras.length === 0) {
          setError('No cameras available');
          logger.warn('cameraOverlay.noCameras');
          return;
        }
        setCamera(cameras[0]);
        logger.info('cameraOverlay.loaded', { cameraId: cameras[0].id });
      })
      .catch(err => {
        setError('Failed to load cameras');
        logger.error('cameraOverlay.fetchError', { error: err.message });
      });
  }, [logger, propCameraId]);

  if (error) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#666' }}>
        {error}
      </div>
    );
  }

  if (!camera) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#555' }}>
        Loading camera...
      </div>
    );
  }

  return <CameraRenderer cameraId={camera.id} crop={crop} />;
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/modules/CameraFeed/CameraOverlay.jsx
git commit -m "feat(camera): accept optional cameraId prop in CameraOverlay"
```

---

### Task 7: Backend Webhook Endpoint

**Files:**
- Modify: `backend/src/4_api/v1/routers/camera.mjs`
- Modify: `backend/src/app.mjs` (pass `broadcastEvent` to camera router)

Add a `POST /:id/event` endpoint that validates the camera exists and broadcasts the event to WebSocket clients.

- [ ] **Step 1: Pass broadcastEvent to the camera router**

In `backend/src/app.mjs`, find the `createCameraRouter` call (around line 1642):

```javascript
  v1Routers.camera = createCameraRouter({
    cameraService,
    logger: rootLogger.child({ module: 'camera-api' }),
  });
```

Replace with:
```javascript
  v1Routers.camera = createCameraRouter({
    cameraService,
    broadcastEvent,
    logger: rootLogger.child({ module: 'camera-api' }),
  });
```

- [ ] **Step 2: Update createCameraRouter signature and add webhook endpoint**

In `backend/src/4_api/v1/routers/camera.mjs`, update the function signature:

Replace:
```javascript
export function createCameraRouter({ cameraService, logger = console }) {
```

With:
```javascript
export function createCameraRouter({ cameraService, broadcastEvent, logger = console }) {
```

Then, before the `return router;` line (line 134), add the new endpoint:

```javascript
  // POST /:id/event — webhook for external events (e.g., HA doorbell ring)
  router.post('/:id/event', (req, res) => {
    const { id } = req.params;
    if (!cameraService.hasCamera(id)) {
      return res.status(404).json({ error: 'Camera not found', cameraId: id });
    }

    const { event } = req.body || {};
    if (!event) {
      return res.status(400).json({ error: 'Missing event field' });
    }

    const topic = req.body.topic || 'doorbell';
    logger.info?.('camera.event', { cameraId: id, event, topic });
    broadcastEvent({ topic, event, cameraId: id });
    res.json({ broadcast: true, topic, event, cameraId: id });
  });
```

- [ ] **Step 3: Test the endpoint manually**

Run (with dev server running):
```bash
curl -s -X POST http://localhost:3112/api/v1/camera/driveway-camera/event \
  -H "Content-Type: application/json" \
  -d '{"event": "ring"}'
```

Expected: `{"broadcast":true,"topic":"doorbell","event":"ring","cameraId":"driveway-camera"}`

If camera doesn't exist in dev: `{"error":"Camera not found","cameraId":"driveway-camera"}` (404 is fine — confirms routing works).

- [ ] **Step 4: Commit**

```bash
git add backend/src/4_api/v1/routers/camera.mjs backend/src/app.mjs
git commit -m "feat(camera): add POST /:id/event webhook for doorbell broadcasts"
```

---

### Task 8: Remove Unused PIP State from ScreenOverlayProvider

**Files:**
- Modify: `frontend/src/screen-framework/overlays/ScreenOverlayProvider.jsx`

PipManager now owns PIP rendering. Remove the `pip` state and rendering from the overlay provider to avoid two PIP rendering paths.

- [ ] **Step 1: Remove pip state and rendering**

In `ScreenOverlayProvider.jsx`:

Remove the pip state declaration (line 33):
```javascript
  const [pip, setPip] = useState(null);
```

Remove the pip branch from `showOverlay` (lines 55-56):
```javascript
    } else if (mode === 'pip') {
      setPip({ Component, props, position });
```

Remove the pip branch from `dismissOverlay` (lines 67-68):
```javascript
    } else if (mode === 'pip') {
      setPip(null);
```

Remove the pip position class computation (line 79):
```javascript
  const pipPositionClass = pip ? `screen-overlay--pip-${pip.position || 'top-right'}` : '';
```

Remove the pip rendering block (lines 89-93):
```jsx
      {pip && (
        <div className={`screen-overlay--pip ${pipPositionClass}`}>
          <pip.Component {...pip.props} dismiss={() => dismissOverlay('pip')} />
        </div>
      )}
```

- [ ] **Step 2: Verify the provider still renders fullscreen and toast overlays correctly**

Quick visual check: the provider should still have `fullscreen` and `toasts` state, rendering, and the context value unchanged except for the removed pip references.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/screen-framework/overlays/ScreenOverlayProvider.jsx
git commit -m "refactor(overlay): remove pip state from ScreenOverlayProvider, now owned by PipManager"
```

---

### Task 9: Integration Test — End-to-End Doorbell PIP

**Files:**
- Verify: screen YAML config, WebSocket subscription, PIP rendering

This is a manual integration test to verify the full flow works end-to-end.

- [ ] **Step 1: Add doorbell subscription to a test screen config**

Read the office screen config to see its current structure:
```bash
sudo docker exec daylight-station sh -c 'cat data/household/screens/office.yml'
```

Add a `pip` and `subscriptions.doorbell` block to the screen YAML (via docker exec). The exact content depends on what cameras are available — use the camera ID from `devices.yml`.

Example addition:
```yaml
pip:
  position: bottom-right
  size: 25
  margin: 16

subscriptions:
  doorbell:
    on:
      event: ring
    response:
      overlay: camera
      mode: pip
      pip:
        timeout: 30
    dismiss:
      inactivity: 30
```

- [ ] **Step 2: Reload the screen and trigger the webhook**

Reload the screen in the browser, then fire the webhook:
```bash
curl -s -X POST http://localhost:3112/api/v1/camera/driveway-camera/event \
  -H "Content-Type: application/json" \
  -d '{"event": "ring"}'
```

Verify: PIP appears in the bottom-right corner showing the camera feed.

- [ ] **Step 3: Test dismiss behavior**

- Wait 30 seconds — PIP should auto-dismiss
- Fire the webhook again, then press Escape — PIP should dismiss immediately
- Fire the webhook twice — second ring should reset the timer, not spawn a second PIP

- [ ] **Step 4: Test promote (if input bindings configured)**

If `actions.pip.promote` is configured in the screen YAML, press the promote key while PIP is visible. Verify CameraViewport opens fullscreen. Press Escape to dismiss.

- [ ] **Step 5: Commit test config (if applicable)**

If the screen config was updated and should persist, commit the config changes. Otherwise, revert.
