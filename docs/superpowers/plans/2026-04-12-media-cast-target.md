# Media Cast Target — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a device-first cast target system to the Media app — header chip, dropdown config panel, per-cast popover, and real-time wake-progress feedback.

**Architecture:** New `useCastTarget` context manages the selected device + settings + cast status. `CastTargetChip` in the header shows target state and progress. `CastTargetPanel` dropdown handles device selection and shader/volume config. Modified `CastButton` reads target from context and shows a per-cast popover instead of immediately opening DevicePicker.

**Tech Stack:** React (JSX), SCSS with BEM + responsive breakpoint mixins, WebSocket subscriptions via `wsService.subscribe()`, existing `/api/v1/device` REST API.

**Spec:** `docs/superpowers/specs/2026-04-12-media-cast-target-design.md`

---

## File Map

| File | Action | Responsibility |
|------|--------|---------------|
| `frontend/src/modules/Media/useCastTarget.js` | Create | Context + hook: device/settings/status state, WS subscription, castToTarget(), retry() |
| `frontend/src/modules/Media/CastTargetChip.jsx` | Create | Header chip: idle/sending/success/error states, step label, click to open panel |
| `frontend/src/modules/Media/CastTargetPanel.jsx` | Create | Dropdown: device list cards, shader selector, volume slider |
| `frontend/src/modules/Media/CastPopover.jsx` | Create | Per-cast popover: device summary, shuffle/repeat toggles, "Cast Now" button |
| `frontend/src/modules/Media/CastButton.jsx` | Modify | Target-aware: show CastPopover when target set, fall back to DevicePicker when not |
| `frontend/src/Apps/MediaApp.jsx` | Modify | Wrap in CastTargetProvider, add CastTargetChip to header area |
| `frontend/src/Apps/MediaApp.scss` | Modify | Styles for chip, panel, popover |

---

### Task 1: useCastTarget Hook

**Files:**
- Create: `frontend/src/modules/Media/useCastTarget.js`

This is the central state manager. It provides device selection, settings, cast execution, and WS-driven progress tracking via React context.

- [ ] **Step 1: Create the context and provider**

```javascript
// frontend/src/modules/Media/useCastTarget.js
import React, { createContext, useContext, useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { wsService } from '../../services/WebSocketService';
import getLogger from '../../lib/logging/Logger.js';

const CastTargetContext = createContext(null);

const STEP_LABELS = {
  power: 'Powering on...',
  verify: 'Connecting...',
  volume: 'Setting volume...',
  prepare: 'Preparing...',
  prewarm: 'Warming up...',
  load: 'Loading...',
};

export function CastTargetProvider({ children }) {
  const logger = useMemo(() => getLogger().child({ component: 'CastTarget' }), []);

  // Target device + settings
  const [device, setDevice] = useState(null);
  const [settings, setSettings] = useState({ shader: null, volume: null });

  // Cast status
  const [status, setStatus] = useState('idle'); // idle | sending | success | error
  const [currentStep, setCurrentStep] = useState(null);
  const [error, setError] = useState(null);

  // Last cast for retry
  const lastCastRef = useRef(null);
  const revertTimerRef = useRef(null);

  // Subscribe to wake-progress events for the targeted device
  useEffect(() => {
    if (!device) return;
    const topic = `homeline:${device.id}`;

    const unsubscribe = wsService.subscribe(
      (msg) => msg.topic === topic && msg.type === 'wake-progress',
      (msg) => {
        logger.debug('cast-target.progress', { step: msg.step, status: msg.status });
        if (msg.status === 'running') {
          setCurrentStep(msg.step);
        }
        if (msg.status === 'failed') {
          setStatus('error');
          setError(msg.error || `Failed at ${msg.step}`);
          setCurrentStep(null);
        }
      }
    );

    return unsubscribe;
  }, [device?.id, logger]);

  // Clean up revert timer on unmount
  useEffect(() => {
    return () => clearTimeout(revertTimerRef.current);
  }, []);

  const selectDevice = useCallback((dev, initialSettings = {}) => {
    logger.info('cast-target.select', { id: dev.id, name: dev.name });
    setDevice(dev);
    setSettings(prev => ({
      shader: initialSettings.shader ?? prev.shader,
      volume: initialSettings.volume ?? prev.volume,
    }));
    setStatus('idle');
    setCurrentStep(null);
    setError(null);
  }, [logger]);

  const updateSettings = useCallback((patch) => {
    setSettings(prev => ({ ...prev, ...patch }));
  }, []);

  const clearTarget = useCallback(() => {
    logger.info('cast-target.clear');
    setDevice(null);
    setSettings({ shader: null, volume: null });
    setStatus('idle');
    setCurrentStep(null);
    setError(null);
  }, [logger]);

  const castToTarget = useCallback(async (contentId, perCastOptions = {}) => {
    if (!device) return;
    const castParams = { contentId, perCastOptions };
    lastCastRef.current = castParams;

    logger.info('cast-target.cast', { deviceId: device.id, contentId, ...perCastOptions });
    setStatus('sending');
    setCurrentStep('power');
    setError(null);
    clearTimeout(revertTimerRef.current);

    try {
      const params = new URLSearchParams();
      params.set('queue', contentId);
      if (settings.shader) params.set('shader', settings.shader);
      if (settings.volume != null) params.set('volume', String(settings.volume));
      if (perCastOptions.shuffle) params.set('shuffle', '1');
      if (perCastOptions.repeat) params.set('repeat', '1');

      const res = await fetch(`/api/v1/device/${device.id}/load?${params}`);
      const result = await res.json();

      if (result.ok) {
        logger.info('cast-target.cast.success', { deviceId: device.id, totalElapsedMs: result.totalElapsedMs });
        setStatus('success');
        setCurrentStep(null);
        revertTimerRef.current = setTimeout(() => setStatus('idle'), 5000);
      } else {
        logger.warn('cast-target.cast.failed', { deviceId: device.id, error: result.error, failedStep: result.failedStep });
        setStatus('error');
        setError(result.error || 'Cast failed');
        setCurrentStep(null);
      }
      return result;
    } catch (err) {
      logger.error('cast-target.cast.error', { deviceId: device.id, error: err.message });
      setStatus('error');
      setError(err.message);
      setCurrentStep(null);
      return { ok: false, error: err.message };
    }
  }, [device, settings, logger]);

  const retry = useCallback(() => {
    if (!lastCastRef.current) return;
    const { contentId, perCastOptions } = lastCastRef.current;
    castToTarget(contentId, perCastOptions);
  }, [castToTarget]);

  const value = useMemo(() => ({
    device,
    settings,
    status,
    currentStep,
    stepLabel: currentStep ? STEP_LABELS[currentStep] || currentStep : null,
    error,
    selectDevice,
    updateSettings,
    clearTarget,
    castToTarget,
    retry,
  }), [device, settings, status, currentStep, error, selectDevice, updateSettings, clearTarget, castToTarget, retry]);

  return (
    <CastTargetContext.Provider value={value}>
      {children}
    </CastTargetContext.Provider>
  );
}

export function useCastTarget() {
  const ctx = useContext(CastTargetContext);
  if (!ctx) throw new Error('useCastTarget must be used within CastTargetProvider');
  return ctx;
}
```

- [ ] **Step 2: Verify the module imports cleanly**

Run:
```bash
cd /opt/Code/DaylightStation && node -e "
  // Quick syntax check - parse the module
  const fs = require('fs');
  const code = fs.readFileSync('frontend/src/modules/Media/useCastTarget.js', 'utf8');
  console.log('File size:', code.length, 'bytes');
  console.log('Exports CastTargetProvider:', code.includes('export function CastTargetProvider'));
  console.log('Exports useCastTarget:', code.includes('export function useCastTarget'));
"
```
Expected: Both exports present, no syntax errors.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/modules/Media/useCastTarget.js
git commit -m "feat(media): add useCastTarget hook and context for device targeting"
```

---

### Task 2: CastTargetChip

**Files:**
- Create: `frontend/src/modules/Media/CastTargetChip.jsx`

The header chip showing current target state. Four visual states: no-target, idle, sending (with step labels), success, error.

- [ ] **Step 1: Create the chip component**

```jsx
// frontend/src/modules/Media/CastTargetChip.jsx
import React, { useMemo } from 'react';
import { useCastTarget } from './useCastTarget.js';
import getLogger from '../../lib/logging/Logger.js';

const CastTargetChip = ({ onClick }) => {
  const logger = useMemo(() => getLogger().child({ component: 'CastTargetChip' }), []);
  const { device, status, stepLabel, error, retry } = useCastTarget();

  const handleClick = (e) => {
    e.stopPropagation();
    if (status === 'error') {
      logger.info('cast-chip.retry');
      retry();
      return;
    }
    onClick?.();
  };

  // No target set
  if (!device) {
    return (
      <button
        className="cast-target-chip cast-target-chip--empty"
        onClick={handleClick}
        aria-label="Set cast target"
        title="Cast to a device"
      >
        <span className="cast-target-chip__icon">&#x1F4E1;</span>
      </button>
    );
  }

  const stateClass = `cast-target-chip--${status}`;

  return (
    <button
      className={`cast-target-chip ${stateClass}`}
      onClick={handleClick}
      aria-label={status === 'error' ? 'Cast failed — tap to retry' : `Casting to ${device.name}`}
      title={status === 'error' ? 'Tap to retry' : device.name}
    >
      {status === 'idle' && (
        <>
          <span className="cast-target-chip__dot" />
          <span className="cast-target-chip__name">{device.name}</span>
          <span className="cast-target-chip__arrow">&#x25BE;</span>
        </>
      )}
      {status === 'sending' && (
        <>
          <span className="cast-target-chip__pulse">&#x26A1;</span>
          <span className="cast-target-chip__step">{stepLabel}</span>
        </>
      )}
      {status === 'success' && (
        <>
          <span className="cast-target-chip__check">&#x2713;</span>
          <span className="cast-target-chip__name">Playing on {device.name}</span>
        </>
      )}
      {status === 'error' && (
        <>
          <span className="cast-target-chip__warn">&#x26A0;</span>
          <span className="cast-target-chip__error">Failed — tap to retry</span>
        </>
      )}
    </button>
  );
};

export default CastTargetChip;
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/modules/Media/CastTargetChip.jsx
git commit -m "feat(media): add CastTargetChip header component"
```

---

### Task 3: CastTargetPanel

**Files:**
- Create: `frontend/src/modules/Media/CastTargetPanel.jsx`

Dropdown panel with device cards and capability-aware settings (shader pills, volume slider).

- [ ] **Step 1: Create the panel component**

```jsx
// frontend/src/modules/Media/CastTargetPanel.jsx
import React, { useMemo, useEffect, useRef } from 'react';
import { useDeviceMonitor } from '../../hooks/media/useDeviceMonitor.js';
import { useCastTarget } from './useCastTarget.js';
import getLogger from '../../lib/logging/Logger.js';

const SHADER_OPTIONS = [
  { value: null, label: 'off' },
  { value: 'focused', label: 'focused' },
  { value: 'night', label: 'night' },
  { value: 'dark', label: 'dark' },
];

/**
 * Determine which settings a device supports based on its type and capabilities.
 */
function getDeviceFeatures(dev) {
  if (!dev) return { hasShader: false, hasVolume: false };
  const type = dev.type || '';
  const caps = dev.capabilities || {};

  // Screen-type devices support shader
  const screenTypes = ['shield-tv', 'linux-pc', 'kiosk', 'tablet'];
  const hasShader = caps.contentControl && screenTypes.some(t => type.includes(t));

  // Volume needs device or OS control
  const hasVolume = !!(caps.deviceControl || caps.osControl);

  return { hasShader, hasVolume };
}

const CastTargetPanel = ({ open, onClose }) => {
  const logger = useMemo(() => getLogger().child({ component: 'CastTargetPanel' }), []);
  const { devices } = useDeviceMonitor();
  const { device: selectedDevice, settings, selectDevice, updateSettings, clearTarget } = useCastTarget();
  const panelRef = useRef(null);

  const castableDevices = useMemo(
    () => devices.filter(d => d.capabilities?.contentControl),
    [devices]
  );

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handleClickOutside = (e) => {
      if (panelRef.current && !panelRef.current.contains(e.target)) {
        onClose();
      }
    };
    // Delay to avoid catching the opening click
    const timer = setTimeout(() => {
      document.addEventListener('mousedown', handleClickOutside);
    }, 0);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [open, onClose]);

  if (!open) return null;

  const features = getDeviceFeatures(selectedDevice);
  const hasSettings = features.hasShader || features.hasVolume;

  return (
    <div className="cast-target-panel" ref={panelRef}>
      {/* Device List */}
      <div className="cast-target-panel__section-label">Devices</div>
      <div className="cast-target-panel__devices">
        {castableDevices.map(dev => {
          const isSelected = selectedDevice?.id === dev.id;
          return (
            <button
              key={dev.id}
              className={`cast-target-panel__device ${isSelected ? 'cast-target-panel__device--selected' : ''}`}
              onClick={() => {
                logger.info('cast-panel.select-device', { id: dev.id });
                selectDevice(dev);
              }}
            >
              <span className="cast-target-panel__device-icon">
                {dev.type?.includes('shield') || dev.type?.includes('tv') ? '📺' :
                 dev.type?.includes('pc') || dev.type?.includes('linux') ? '🖥️' :
                 dev.type?.includes('audio') ? '🔊' :
                 dev.type?.includes('mobile') ? '📱' : '📡'}
              </span>
              <div className="cast-target-panel__device-info">
                <div className="cast-target-panel__device-name">{dev.name || dev.id}</div>
                <div className="cast-target-panel__device-type">{dev.type || 'device'}</div>
              </div>
            </button>
          );
        })}
        {castableDevices.length === 0 && (
          <div className="cast-target-panel__empty">No castable devices found</div>
        )}
      </div>

      {/* Settings for selected device */}
      {selectedDevice && hasSettings && (
        <>
          <div className="cast-target-panel__section-label">
            Settings for {selectedDevice.name || selectedDevice.id}
          </div>
          <div className="cast-target-panel__settings">
            {features.hasShader && (
              <div className="cast-target-panel__setting">
                <span className="cast-target-panel__setting-label">Shader</span>
                <div className="cast-target-panel__shader-pills">
                  {SHADER_OPTIONS.map(opt => (
                    <button
                      key={opt.label}
                      className={`cast-target-panel__pill ${settings.shader === opt.value ? 'cast-target-panel__pill--active' : ''}`}
                      onClick={() => updateSettings({ shader: opt.value })}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {features.hasVolume && (
              <div className="cast-target-panel__setting">
                <span className="cast-target-panel__setting-label">Vol</span>
                <input
                  type="range"
                  className="cast-target-panel__volume"
                  min="0"
                  max="100"
                  value={settings.volume ?? 50}
                  onChange={(e) => updateSettings({ volume: Number(e.target.value) })}
                />
                <span className="cast-target-panel__volume-value">{settings.volume ?? 50}</span>
              </div>
            )}
          </div>
        </>
      )}

      {/* Clear target */}
      {selectedDevice && (
        <button className="cast-target-panel__clear" onClick={() => { clearTarget(); onClose(); }}>
          Clear target
        </button>
      )}
    </div>
  );
};

export default CastTargetPanel;
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/modules/Media/CastTargetPanel.jsx
git commit -m "feat(media): add CastTargetPanel dropdown with device picker and settings"
```

---

### Task 4: CastPopover

**Files:**
- Create: `frontend/src/modules/Media/CastPopover.jsx`

Small per-cast popover shown when casting with an active target. Shows device summary, shuffle/repeat toggles for collections, and "Cast Now" button.

- [ ] **Step 1: Create the popover component**

```jsx
// frontend/src/modules/Media/CastPopover.jsx
import React, { useState, useEffect, useRef } from 'react';
import { useCastTarget } from './useCastTarget.js';

const CastPopover = ({ contentId, isCollection, open, onClose, anchorRef }) => {
  const { device, settings, castToTarget } = useCastTarget();
  const [shuffle, setShuffle] = useState(false);
  const [repeat, setRepeat] = useState(false);
  const popoverRef = useRef(null);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handleClickOutside = (e) => {
      if (
        popoverRef.current && !popoverRef.current.contains(e.target) &&
        anchorRef?.current && !anchorRef.current.contains(e.target)
      ) {
        onClose();
      }
    };
    const timer = setTimeout(() => {
      document.addEventListener('mousedown', handleClickOutside);
    }, 0);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [open, onClose, anchorRef]);

  if (!open || !device) return null;

  const handleCast = () => {
    castToTarget(contentId, { shuffle, repeat });
    onClose();
  };

  const settingsSummary = [
    settings.shader ? `${settings.shader}` : null,
    settings.volume != null ? `vol ${settings.volume}` : null,
  ].filter(Boolean).join(' · ');

  return (
    <div className="cast-popover" ref={popoverRef}>
      <div className="cast-popover__header">
        <span className="cast-popover__label">Sending to</span>
        <span className="cast-popover__device">{device.name}</span>
        {settingsSummary && (
          <span className="cast-popover__settings">{settingsSummary}</span>
        )}
      </div>

      {isCollection && (
        <div className="cast-popover__toggles">
          <label className="cast-popover__toggle">
            <span
              className={`cast-popover__switch ${shuffle ? 'cast-popover__switch--on' : ''}`}
              onClick={() => setShuffle(s => !s)}
              role="switch"
              aria-checked={shuffle}
            />
            <span className="cast-popover__toggle-label">Shuffle</span>
          </label>
          <label className="cast-popover__toggle">
            <span
              className={`cast-popover__switch ${repeat ? 'cast-popover__switch--on' : ''}`}
              onClick={() => setRepeat(r => !r)}
              role="switch"
              aria-checked={repeat}
            />
            <span className="cast-popover__toggle-label">Repeat</span>
          </label>
        </div>
      )}

      <button className="cast-popover__cast-btn" onClick={handleCast}>
        &#x25B6; Cast Now
      </button>
    </div>
  );
};

export default CastPopover;
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/modules/Media/CastPopover.jsx
git commit -m "feat(media): add CastPopover for per-cast options"
```

---

### Task 5: Modify CastButton to be Target-Aware

**Files:**
- Modify: `frontend/src/modules/Media/CastButton.jsx`

When a cast target is set, tapping the cast button opens `CastPopover` instead of `DevicePicker`. When no target, falls back to DevicePicker and sets the chosen device as the sticky target.

- [ ] **Step 1: Update CastButton**

Replace the full contents of `frontend/src/modules/Media/CastButton.jsx`:

```jsx
// frontend/src/modules/Media/CastButton.jsx
import React, { useState, useCallback, useMemo, useRef } from 'react';
import getLogger from '../../lib/logging/Logger.js';
import { useCastTarget } from './useCastTarget.js';
import DevicePicker from './DevicePicker.jsx';
import CastPopover from './CastPopover.jsx';

const CastButton = ({ contentId, isCollection = false, className = '' }) => {
  const logger = useMemo(() => getLogger().child({ component: 'CastButton' }), []);
  const { device: targetDevice, selectDevice } = useCastTarget();
  const [pickerOpen, setPickerOpen] = useState(false);
  const [popoverOpen, setPopoverOpen] = useState(false);
  const btnRef = useRef(null);

  const handleToggle = useCallback((e) => {
    e.stopPropagation();
    if (targetDevice) {
      // Target set — toggle the per-cast popover
      logger.debug('cast-button.popover-toggle', { contentId });
      setPopoverOpen(o => !o);
    } else {
      // No target — open device picker to set one
      logger.debug('cast-button.picker-toggle', { contentId });
      setPickerOpen(o => !o);
    }
  }, [targetDevice, contentId, logger]);

  const handleDevicePicked = useCallback((deviceId, deviceObj) => {
    // Set the picked device as the sticky target
    if (deviceObj) {
      logger.info('cast-button.target-set-from-picker', { deviceId });
      selectDevice(deviceObj);
    }
    setPickerOpen(false);
    // Open the popover now that we have a target
    setPopoverOpen(true);
  }, [selectDevice, logger]);

  if (!contentId) return null;

  return (
    <span className="cast-btn-wrapper" style={{ position: 'relative' }}>
      <button
        ref={btnRef}
        className={`cast-btn ${className}`}
        onClick={handleToggle}
        aria-label="Cast to device"
        title={targetDevice ? `Cast to ${targetDevice.name}` : 'Cast to device'}
      >
        &#x1F4E1;
      </button>
      <DevicePicker
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        contentId={contentId}
        onDevicePicked={handleDevicePicked}
      />
      <CastPopover
        contentId={contentId}
        isCollection={isCollection}
        open={popoverOpen}
        onClose={() => setPopoverOpen(false)}
        anchorRef={btnRef}
      />
    </span>
  );
};

export default CastButton;
```

- [ ] **Step 2: Update DevicePicker to support onDevicePicked callback**

In `frontend/src/modules/Media/DevicePicker.jsx`, modify the `handleCast` function to call `onDevicePicked` when provided, instead of immediately firing the load API. The full updated file:

```jsx
// frontend/src/modules/Media/DevicePicker.jsx
import React, { useMemo } from 'react';
import { useDeviceMonitor } from '../../hooks/media/useDeviceMonitor.js';
import getLogger from '../../lib/logging/Logger.js';

const DevicePicker = ({ open, onClose, contentId, onCastStarted, onDevicePicked }) => {
  const logger = useMemo(() => getLogger().child({ component: 'DevicePicker' }), []);
  const { devices, playbackStates } = useDeviceMonitor();

  const castableDevices = useMemo(
    () => devices.filter(d => d.capabilities?.contentControl),
    [devices]
  );

  const handleCast = async (deviceId) => {
    const deviceObj = castableDevices.find(d => d.id === deviceId);

    // If onDevicePicked is provided, delegate to it (target-aware flow)
    if (onDevicePicked) {
      onDevicePicked(deviceId, deviceObj);
      return;
    }

    // Legacy flow — direct cast
    logger.info('cast.start', { deviceId, contentId });
    onCastStarted?.(deviceId);
    try {
      const params = new URLSearchParams({ open: '/media', play: contentId });
      const res = await fetch(`/api/v1/device/${deviceId}/load?${params}`);
      const result = await res.json();
      if (result.ok) {
        logger.info('cast.success', { deviceId, totalElapsedMs: result.totalElapsedMs });
      } else {
        logger.warn('cast.failed', { deviceId, error: result.error, failedStep: result.failedStep });
      }
    } catch (err) {
      logger.error('cast.error', { deviceId, error: err.message });
    }
    onClose();
  };

  if (!open) return null;

  return (
    <div className="device-picker-overlay" onClick={onClose}>
      <div className="device-picker" onClick={e => e.stopPropagation()}>
        <div className="device-picker-header">
          <h3>Cast to device</h3>
        </div>
        <div className="device-picker-list">
          {castableDevices.map(device => {
            const state = playbackStates.get(device.id);
            const isOnline = playbackStates.has(device.id);
            return (
              <button
                key={device.id}
                className={`device-picker-item ${!isOnline ? 'device-picker-item--offline' : ''}`}
                onClick={() => handleCast(device.id)}
              >
                <span className={`device-card-status ${isOnline ? 'online' : 'offline'}`} />
                <span className="device-picker-name">{device.name || device.id}</span>
                {state && state.state !== 'stopped' && (
                  <span className="device-picker-playing">{state.title}</span>
                )}
              </button>
            );
          })}
          {castableDevices.length === 0 && (
            <div className="device-picker-empty">No castable devices found</div>
          )}
        </div>
      </div>
    </div>
  );
};

export default DevicePicker;
```

- [ ] **Step 3: Commit**

```bash
git add frontend/src/modules/Media/CastButton.jsx frontend/src/modules/Media/DevicePicker.jsx
git commit -m "feat(media): make CastButton target-aware with popover and DevicePicker fallback"
```

---

### Task 6: Wire Into MediaApp

**Files:**
- Modify: `frontend/src/Apps/MediaApp.jsx`

Wrap the app in `CastTargetProvider` and add the `CastTargetChip` + `CastTargetPanel` to the header area. The chip goes inside each panel's header (search-home and browser), positioned alongside the existing search input.

- [ ] **Step 1: Add CastTargetProvider and chip to MediaApp**

In `frontend/src/Apps/MediaApp.jsx`, add imports at the top (after the existing imports):

```javascript
import { CastTargetProvider } from '../modules/Media/useCastTarget.js';
import CastTargetChip from '../modules/Media/CastTargetChip.jsx';
import CastTargetPanel from '../modules/Media/CastTargetPanel.jsx';
```

Replace the `MediaApp` component (lines 16-22) to wrap with `CastTargetProvider`:

```jsx
const MediaApp = () => {
  return (
    <MediaAppProvider>
      <CastTargetProvider>
        <MediaAppInner />
      </CastTargetProvider>
    </MediaAppProvider>
  );
};
```

Inside `MediaAppInner`, add state for the panel toggle. Add this after the existing `const [playbackState, setPlaybackState] = useState(...)` block (around line 38):

```javascript
  // Cast target panel
  const [castPanelOpen, setCastPanelOpen] = useState(false);
```

Add the cast target UI inside the JSX. Replace the `media-panels` div (lines 235-257) with:

```jsx
      <div className={`media-panels media-panels--active-${activePanel}`}>
        {/* Cast Target (floats over panels) */}
        <div className="media-cast-target-bar">
          <CastTargetChip onClick={() => setCastPanelOpen(o => !o)} />
          <CastTargetPanel open={castPanelOpen} onClose={() => setCastPanelOpen(false)} />
        </div>

        {/* Panel 1: Search/Home (left) */}
        <div className={`media-panel media-panel--search ${activePanel === 'search' ? 'media-panel--active' : ''}`}>
          <SearchHomePanel />
        </div>

        {/* Panel 2: Content Browser (center) */}
        <div className={`media-panel media-panel--browser ${activePanel === 'browser' ? 'media-panel--active' : ''}`}>
          <ContentBrowserPanel contentId={detailContentId} />
        </div>

        {/* Panel 3: Player (right) */}
        <div className={`media-panel media-panel--player ${activePanel === 'player' ? 'media-panel--active' : ''}`}>
          <PlayerPanel
            currentItem={queue.currentItem}
            onItemEnd={handleItemEnd}
            onNext={handleNext}
            onPrev={handlePrev}
            onPlaybackState={setPlaybackState}
            playerRef={playerRef}
          />
        </div>
      </div>
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/Apps/MediaApp.jsx
git commit -m "feat(media): wire CastTargetProvider, chip, and panel into MediaApp"
```

---

### Task 7: SCSS Styles

**Files:**
- Modify: `frontend/src/Apps/MediaApp.scss`

Add styles for the cast target chip, panel, and popover. Uses existing BEM + breakpoint mixin patterns.

- [ ] **Step 1: Add cast target styles**

Append the following to the end of `frontend/src/Apps/MediaApp.scss`:

```scss
// ── Cast Target Bar ───────────────────────────────────────────
.media-cast-target-bar {
  position: absolute;
  top: 8px;
  right: 12px;
  z-index: 20;
  display: flex;
  align-items: center;
}

// ── Cast Target Chip ──────────────────────────────────────────
.cast-target-chip {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  border-radius: 20px;
  border: none;
  cursor: pointer;
  font-size: 12px;
  font-weight: 500;
  white-space: nowrap;
  transition: background 0.2s, border-color 0.2s;

  &--empty {
    background: transparent;
    border: 1px dashed #444;
    color: #555;
    padding: 6px 10px;
    &:hover { border-color: #666; color: #888; }
  }

  &--idle {
    background: #2a1f4e;
    border: 1px solid rgba(124, 111, 224, 0.33);
    color: #c4bbf0;
    &:hover { background: #352a5e; }
  }

  &--sending {
    background: #2a1f4e;
    border: 1px solid #7c6fe0;
    color: #c4bbf0;
    overflow: hidden;
    position: relative;
  }

  &--success {
    background: #1a3a1a;
    border: 1px solid rgba(76, 175, 80, 0.33);
    color: #81c784;
  }

  &--error {
    background: #3a1a1a;
    border: 1px solid rgba(244, 67, 54, 0.33);
    color: #ef9a9a;
    &:hover { background: #4a2020; }
  }
}

.cast-target-chip__icon { font-size: 16px; }

.cast-target-chip__dot {
  width: 8px;
  height: 8px;
  background: #4caf50;
  border-radius: 50%;
  flex-shrink: 0;
}

.cast-target-chip__name { max-width: 120px; overflow: hidden; text-overflow: ellipsis; }
.cast-target-chip__arrow { color: #666; font-size: 10px; }

.cast-target-chip__pulse {
  animation: chip-pulse 1.2s ease-in-out infinite;
}

.cast-target-chip__step { font-size: 11px; }
.cast-target-chip__check { font-size: 14px; }
.cast-target-chip__warn { font-size: 14px; }
.cast-target-chip__error { font-size: 11px; }

@keyframes chip-pulse {
  0%, 100% { opacity: 0.6; }
  50% { opacity: 1; }
}

// Sweep animation for sending state
.cast-target-chip--sending::after {
  content: '';
  position: absolute;
  top: 0;
  left: -100%;
  width: 100%;
  height: 100%;
  background: linear-gradient(90deg, transparent, rgba(124, 111, 224, 0.15), transparent);
  animation: chip-sweep 1.5s ease-in-out infinite;
}

@keyframes chip-sweep {
  0% { left: -100%; }
  100% { left: 100%; }
}

// ── Cast Target Panel ─────────────────────────────────────────
.cast-target-panel {
  position: absolute;
  top: 100%;
  right: 0;
  margin-top: 8px;
  width: 320px;
  max-width: 90vw;
  background: #1a1a30;
  border: 1px solid #2a2a45;
  border-radius: 12px;
  padding: 16px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.5);
  z-index: 30;

  @include mobile-only {
    width: calc(100vw - 24px);
    right: -4px;
  }
}

.cast-target-panel__section-label {
  font-size: 11px;
  color: #666;
  text-transform: uppercase;
  letter-spacing: 1px;
  margin-bottom: 8px;
}

.cast-target-panel__devices {
  display: flex;
  gap: 8px;
  overflow-x: auto;
  padding-bottom: 4px;
  margin-bottom: 16px;
  -webkit-overflow-scrolling: touch;
}

.cast-target-panel__device {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 14px;
  background: #1e1e35;
  border: 1px solid #2a2a45;
  border-radius: 8px;
  cursor: pointer;
  flex-shrink: 0;
  color: #999;
  transition: background 0.15s, border-color 0.15s;

  &:hover { background: #252545; }

  &--selected {
    background: #2a1f4e;
    border-color: #7c6fe0;
    color: #e0dbff;
  }
}

.cast-target-panel__device-icon { font-size: 16px; }
.cast-target-panel__device-name { font-size: 13px; font-weight: 500; }
.cast-target-panel__device-type { font-size: 10px; color: #555; }
.cast-target-panel__empty { color: #555; font-size: 13px; padding: 8px 0; }

.cast-target-panel__settings {
  display: flex;
  flex-direction: column;
  gap: 12px;
  margin-bottom: 12px;
}

.cast-target-panel__setting {
  display: flex;
  align-items: center;
  gap: 8px;
}

.cast-target-panel__setting-label {
  color: #888;
  font-size: 12px;
  min-width: 44px;
}

.cast-target-panel__shader-pills {
  display: flex;
  gap: 4px;
}

.cast-target-panel__pill {
  padding: 4px 10px;
  border-radius: 4px;
  font-size: 11px;
  background: #1e1e35;
  border: 1px solid transparent;
  color: #666;
  cursor: pointer;
  transition: all 0.15s;

  &:hover { color: #999; }

  &--active {
    background: #2a1f4e;
    border-color: rgba(124, 111, 224, 0.33);
    color: #c4bbf0;
  }
}

.cast-target-panel__volume {
  flex: 1;
  accent-color: #7c6fe0;
  height: 4px;
}

.cast-target-panel__volume-value {
  color: #888;
  font-size: 11px;
  min-width: 24px;
  text-align: right;
}

.cast-target-panel__clear {
  display: block;
  width: 100%;
  padding: 8px;
  background: none;
  border: 1px solid #333;
  border-radius: 6px;
  color: #666;
  font-size: 12px;
  cursor: pointer;
  margin-top: 4px;
  transition: color 0.15s, border-color 0.15s;

  &:hover { color: #999; border-color: #555; }
}

// ── Cast Popover ──────────────────────────────────────────────
.cast-btn-wrapper {
  position: relative;
  display: inline-flex;
}

.cast-popover {
  position: absolute;
  bottom: calc(100% + 8px);
  right: 0;
  width: 240px;
  background: #252540;
  border: 1px solid #3a3a5a;
  border-radius: 10px;
  padding: 14px;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.4);
  z-index: 25;
}

.cast-popover__header {
  display: flex;
  align-items: baseline;
  gap: 6px;
  flex-wrap: wrap;
  margin-bottom: 12px;
}

.cast-popover__label { color: #888; font-size: 11px; }
.cast-popover__device { color: #c4bbf0; font-size: 12px; font-weight: 500; }
.cast-popover__settings { color: #555; font-size: 11px; }

.cast-popover__toggles {
  display: flex;
  gap: 16px;
  margin-bottom: 14px;
}

.cast-popover__toggle {
  display: flex;
  align-items: center;
  gap: 6px;
  cursor: pointer;
}

.cast-popover__switch {
  display: inline-block;
  width: 36px;
  height: 20px;
  background: #333;
  border-radius: 10px;
  position: relative;
  cursor: pointer;
  transition: background 0.2s;

  &::after {
    content: '';
    width: 16px;
    height: 16px;
    background: #666;
    border-radius: 50%;
    position: absolute;
    top: 2px;
    left: 2px;
    transition: transform 0.2s, background 0.2s;
  }

  &--on {
    background: #7c6fe0;
    &::after {
      transform: translateX(16px);
      background: #fff;
    }
  }
}

.cast-popover__toggle-label {
  font-size: 12px;
  color: #888;
  .cast-popover__switch--on + & { color: #ccc; }
}

.cast-popover__cast-btn {
  width: 100%;
  padding: 10px;
  background: #7c6fe0;
  color: #fff;
  border: none;
  border-radius: 8px;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  letter-spacing: 0.5px;
  transition: background 0.15s;

  &:hover { background: #6b5fcc; }
  &:active { background: #5a4fbb; }
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/Apps/MediaApp.scss
git commit -m "feat(media): add SCSS styles for cast target chip, panel, and popover"
```

---

### Task 8: Pass isCollection to CastButton

**Files:**
- Modify: `frontend/src/modules/Media/ContentDetailView.jsx`
- Modify: `frontend/src/modules/Media/ContentBrowser.jsx`

CastButton needs to know if the content is a collection (to show shuffle/repeat toggles in the popover). Pass `isCollection` from parent components.

- [ ] **Step 1: Update ContentDetailView**

In `frontend/src/modules/Media/ContentDetailView.jsx`, find the CastButton at line 206:

```jsx
            <CastButton contentId={contentId} className="action-btn" />
```

Replace with:

```jsx
            <CastButton contentId={contentId} isCollection={isContainer} className="action-btn" />
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/modules/Media/ContentDetailView.jsx
git commit -m "feat(media): pass isCollection to CastButton in ContentDetailView"
```

---

### Task 9: Smoke Test

**Files:** None (manual verification)

- [ ] **Step 1: Check that the dev server builds without errors**

Run:
```bash
cd /opt/Code/DaylightStation && npx vite build 2>&1 | tail -20
```

Expected: Build succeeds with no import/syntax errors. If there are errors, fix them before proceeding.

- [ ] **Step 2: If dev server is running, check browser console for runtime errors**

Run:
```bash
lsof -i :3112 | head -5
```

If the dev server is running, open the Media app in a browser and check:
1. Cast icon appears in the header (top-right area)
2. Tapping it opens the device picker panel
3. No console errors on load

- [ ] **Step 3: Final commit if any fixes were needed**

```bash
git add -u
git commit -m "fix(media): address build/runtime issues from cast target integration"
```
