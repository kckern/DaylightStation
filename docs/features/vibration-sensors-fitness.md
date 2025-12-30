# Vibration Sensor Integration for Fitness Plugins

## Overview

This feature integrates Zigbee vibration sensors (Third Reality 3RVS01031Z) with the Fitness app to provide real-time feedback on punching bag hits and step platform activity. The data flows from MQTT → Backend WebSocket → FitnessContext → FitnessPlugin visualization.

> **Note**: The simulator lives in `_extentions/fitness/` (folder name is a legacy typo for "extensions" — not worth the migration hassle to rename).

## Sensors

| Sensor Name | IEEE Address | Location | Use Case |
|-------------|--------------|----------|----------|
| Garage Punching Bag Vibration Sensor | `0xffffb40e06039375` | Attached to punching bag | Detect punches/hits |
| Garage Step Vibration Sensor | `0xffffb40e0605feba` | Under step platform | Detect step-ups |

### Sensor Data Format (from MQTT)

```json
{
  "vibration": true,
  "battery_low": false,
  "battery": 95,
  "voltage": 3100,
  "x_axis": 12.5,
  "y_axis": -3.2,
  "z_axis": 8.1,
  "linkquality": 156
}
```

The MQTT topics follow Zigbee2MQTT convention:
- `zigbee2mqtt-usb/Garage Punching Bag Vibration Sensor`
- `zigbee2mqtt-usb/Garage Step Vibration Sensor`

### Accelerometer Axis Data

The Third Reality 3RVS01031Z sensor includes a 3-axis accelerometer that provides directional impact data:

| Axis | Description | Punching Bag | Step Platform |
|------|-------------|--------------|---------------|
| **X** | Left/Right | Hook direction | Lateral shift |
| **Y** | Forward/Back | Jab/cross force | Front/back tilt |
| **Z** | Up/Down | Uppercut force | Step-down impact |

**Intensity Calculation:**
```javascript
// Magnitude of the acceleration vector (g-force)
intensity = Math.sqrt(x² + y² + z²)
```

**Interpreting Values:**
- `0-5`: Light tap / no impact
- `5-15`: Moderate hit / normal step  
- `15-30`: Strong hit / heavy step
- `30+`: Very hard impact

**Use Cases for Axis Data:**
1. **Impact Direction**: Determine punch type (jab vs hook vs uppercut)
2. **Form Analysis**: Detect if steps are centered or off-balance
3. **Pattern Recognition**: Different exercises have distinct axis signatures
4. **Visualization**: 3D representation of impact direction

## Architecture

```
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────┐
│  Zigbee Sensor  │────▶│  MQTT Broker     │────▶│  Backend MQTT   │
│  (3RVS01031Z)   │     │  (Mosquitto)     │     │  Subscriber     │
└─────────────────┘     └──────────────────┘     └────────┬────────┘
                                                          │
                                                          ▼
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────┐
│ VibrationApp    │◀────│  FitnessContext  │◀────│  WebSocket      │
│ (FitnessPlugin) │     │  vibrationState  │     │  Broadcast      │
└─────────────────┘     └──────────────────┘     └─────────────────┘
```

## Constants & Configuration

All magic numbers are centralized for maintainability and tuning:

```javascript
// frontend/src/modules/Fitness/FitnessPlugins/plugins/VibrationApp/constants.js
export const VIBRATION_CONSTANTS = {
  // Timing
  VIBRATION_ACTIVE_DURATION_MS: 500,    // How long to show "active" state after hit
  DUPLICATE_EVENT_THRESHOLD_MS: 100,    // Ignore events within this window
  ACTIVITY_TIMELINE_MAX_EVENTS: 30,     // Max events to keep in timeline
  ACTIVITY_DOT_FADE_DURATION_MS: 30000, // How long before dots fully fade
  
  // Intensity thresholds (g-force magnitude)
  INTENSITY_THRESHOLDS: {
    NONE: 0,      // No impact
    LOW: 5,       // Light tap
    MEDIUM: 15,   // Moderate hit
    HIGH: 30,     // Strong impact
  },
  
  // Axis detection
  MIN_AXIS_THRESHOLD: 2,  // Minimum g-force to determine dominant axis
  
  // WebSocket throttling
  WS_BROADCAST_THROTTLE_MS: 50,  // Min time between broadcasts per equipment
};

// backend/lib/mqtt.constants.mjs
export const MQTT_CONSTANTS = {
  RECONNECT_INTERVAL_MS: 5000,      // Time between reconnection attempts
  MAX_RECONNECT_ATTEMPTS: 10,       // Give up after this many failures
  RECONNECT_BACKOFF_MULTIPLIER: 1.5, // Exponential backoff multiplier
  MAX_RECONNECT_INTERVAL_MS: 60000, // Cap backoff at 1 minute
  
  // Rate limiting
  BROADCAST_THROTTLE_MS: 50,        // Min time between WS broadcasts per topic
};
```

## Environment Architecture

### Container Networking

Both `daylight-station` and `mosquitto` containers run on the same Docker network (`{local-network}`), allowing direct container-to-container communication.

```
┌─────────────────────────────────────────────────────────────────┐
│  homeserver.local (Docker Host)                                 │
│                                                                 │
│  ┌─────────────────────── {local-network} ─────────────────────────┐ │
│  │                                                             │ │
│  │  ┌─────────────────┐         ┌─────────────────┐           │ │
│  │  │ daylight-station│         │    mosquitto    │           │ │
│  │  │   :3112/:3119   │◀───────▶│   :1883/:9001   │           │ │
│  │  └─────────────────┘         └─────────────────┘           │ │
│  │         │                            │                      │ │
│  └─────────┼────────────────────────────┼──────────────────────┘ │
│            │                            │                        │
│    ┌───────▼────────┐          ┌────────▼────────┐              │
│    │ :3113 → :3112  │          │ :1883 exposed   │              │
│    │ :3119 exposed  │          │ :9001 exposed   │              │
│    └────────────────┘          └─────────────────┘              │
└─────────────────────────────────────────────────────────────────┘
```

### Dev vs Prod Configuration

| Environment | MQTT Host | How it Works |
|-------------|-----------|--------------|
| **Production** | `mosquitto` | Container name resolution on `{local-network}` |
| **Development** | `homeserver.local` | External access via exposed port 1883 |

- **Production**: `daylight-station` connects to `mosquitto:1883` using Docker DNS
- **Development**: Local dev server connects to `homeserver.local:1883` (port exposed to host)

## Implementation Plan

### Phase 1: Backend MQTT Subscription

**File:** `backend/lib/mqtt.mjs` (new)

Create an MQTT client that subscribes to vibration sensor topics with proper error handling, reconnection logic, input validation, and broadcast throttling.

```javascript
// backend/lib/mqtt.mjs
import mqtt from 'mqtt';
import { broadcastToWebsockets } from '../routers/websocket.mjs';
import { createLogger } from './logging/logger.js';
import { MQTT_CONSTANTS } from './mqtt.constants.mjs';

const logger = createLogger({ source: 'backend', app: 'mqtt' });

let mqttClient = null;
let sensorTopicMap = new Map(); // mqtt_topic -> equipment config
let reconnectAttempts = 0;
let reconnectTimeout = null;
let isShuttingDown = false;

// Throttle tracking: topic -> last broadcast timestamp
const lastBroadcastTime = new Map();

/**
 * Validate vibration sensor payload against expected schema
 * @param {object} data - Parsed MQTT message payload
 * @returns {{ valid: boolean, errors: string[] }} - Validation result
 */
function validateVibrationPayload(data) {
  const errors = [];
  
  if (data === null || typeof data !== 'object') {
    return { valid: false, errors: ['Payload must be an object'] };
  }
  
  // Required field
  if (typeof data.vibration !== 'boolean') {
    errors.push('vibration must be a boolean');
  }
  
  // Optional numeric fields - validate type if present
  const numericFields = ['x_axis', 'y_axis', 'z_axis', 'battery', 'voltage', 'linkquality'];
  numericFields.forEach(field => {
    if (data[field] !== undefined && data[field] !== null && typeof data[field] !== 'number') {
      errors.push(`${field} must be a number if provided`);
    }
  });
  
  // Range validation for known fields
  if (typeof data.battery === 'number' && (data.battery < 0 || data.battery > 100)) {
    errors.push('battery must be between 0 and 100');
  }
  
  return { valid: errors.length === 0, errors };
}

/**
 * Check if broadcast should be throttled for this topic
 * @param {string} topic - MQTT topic
 * @returns {boolean} - True if should throttle (skip broadcast)
 */
function shouldThrottle(topic) {
  const now = Date.now();
  const lastTime = lastBroadcastTime.get(topic) || 0;
  
  if (now - lastTime < MQTT_CONSTANTS.BROADCAST_THROTTLE_MS) {
    return true;
  }
  
  lastBroadcastTime.set(topic, now);
  return false;
}

/**
 * Build sensor topic map from fitness equipment config
 * @param {Array} equipment - Equipment array from fitness config
 * @returns {Map<string, object>} - Map of mqtt_topic -> equipment metadata
 */
export function buildSensorTopicMap(equipment = []) {
  const map = new Map();
  
  if (!Array.isArray(equipment)) {
    logger.warn('mqtt.invalid_equipment', { message: 'Equipment config must be an array' });
    return map;
  }
  
  equipment.forEach(equip => {
    if (equip?.sensor?.type === 'vibration' && equip.sensor.mqtt_topic) {
      map.set(equip.sensor.mqtt_topic, {
        id: equip.id,
        name: equip.name,
        type: equip.type,
        thresholds: equip.thresholds || { low: 5, medium: 15, high: 30 }
      });
    }
  });
  
  return map;
}

/**
 * Schedule a reconnection attempt with exponential backoff
 * @param {string} brokerUrl - MQTT broker URL
 */
function scheduleReconnect(brokerUrl) {
  if (isShuttingDown) return;
  
  if (reconnectAttempts >= MQTT_CONSTANTS.MAX_RECONNECT_ATTEMPTS) {
    logger.error('mqtt.reconnect.exhausted', { 
      attempts: reconnectAttempts,
      message: 'Max reconnection attempts reached, giving up'
    });
    return;
  }
  
  const backoffMs = Math.min(
    MQTT_CONSTANTS.RECONNECT_INTERVAL_MS * Math.pow(MQTT_CONSTANTS.RECONNECT_BACKOFF_MULTIPLIER, reconnectAttempts),
    MQTT_CONSTANTS.MAX_RECONNECT_INTERVAL_MS
  );
  
  reconnectAttempts++;
  
  logger.info('mqtt.reconnect.scheduled', { 
    attempt: reconnectAttempts,
    backoffMs,
    nextAttemptIn: `${(backoffMs / 1000).toFixed(1)}s`
  });
  
  reconnectTimeout = setTimeout(() => {
    logger.info('mqtt.reconnect.attempting', { attempt: reconnectAttempts });
    connectToBroker(brokerUrl);
  }, backoffMs);
}

/**
 * Connect to MQTT broker and set up event handlers
 * @param {string} brokerUrl - MQTT broker URL
 */
function connectToBroker(brokerUrl) {
  if (isShuttingDown) return;
  
  mqttClient = mqtt.connect(brokerUrl, {
    reconnectPeriod: 0, // We handle reconnection manually for better control
    connectTimeout: 10000,
  });

  mqttClient.on('connect', () => {
    logger.info('mqtt.connected', { broker: brokerUrl });
    reconnectAttempts = 0; // Reset on successful connection
    
    // Subscribe to all vibration sensor topics from equipment config
    sensorTopicMap.forEach((equipConfig, topic) => {
      mqttClient.subscribe(topic, (err) => {
        if (err) {
          logger.error('mqtt.subscribe.failed', { topic, equipment: equipConfig.id, error: err.message });
        } else {
          logger.info('mqtt.subscribed', { topic, equipment: equipConfig.id });
        }
      });
    });
  });

  mqttClient.on('message', (topic, message) => {
    const equipConfig = sensorTopicMap.get(topic);
    if (!equipConfig) return;
    
    // Throttle high-frequency broadcasts
    if (shouldThrottle(topic)) {
      logger.debug('mqtt.throttled', { topic, equipment: equipConfig.id });
      return;
    }
    
    let data;
    try {
      data = JSON.parse(message.toString());
    } catch (parseErr) {
      logger.warn('mqtt.message.parse.failed', { 
        topic, 
        error: parseErr.message,
        rawMessage: message.toString().substring(0, 100) // Truncate for logging
      });
      return;
    }
    
    // Validate payload schema
    const validation = validateVibrationPayload(data);
    if (!validation.valid) {
      logger.warn('mqtt.message.validation.failed', {
        topic,
        equipment: equipConfig.id,
        errors: validation.errors
      });
      return;
    }
    
    try {

      const payload = {
        topic: 'vibration',
        source: 'mqtt',
        equipmentId: equipConfig.id,
        equipmentName: equipConfig.name,
        equipmentType: equipConfig.type,
        thresholds: equipConfig.thresholds,
        timestamp: Date.now(),
        data: {
          vibration: data.vibration || false,
          x_axis: data.x_axis ?? null,
          y_axis: data.y_axis ?? null,
          z_axis: data.z_axis ?? null,
          battery: data.battery ?? null,
          battery_low: data.battery_low ?? false,
          linkquality: data.linkquality ?? null
        }
      };

      // Broadcast to all connected WebSocket clients
      broadcastToWebsockets(payload);
      
      if (data.vibration) {
        logger.debug('mqtt.vibration.detected', {
          equipment: equipConfig.id,
          axes: { x: data.x_axis, y: data.y_axis, z: data.z_axis }
        });
      }
    } catch (err) {
      logger.error('mqtt.message.broadcast.failed', { 
        topic, 
        equipment: equipConfig.id,
        error: err.message 
      });
    }
  });

  mqttClient.on('error', (err) => {
    logger.error('mqtt.error', { error: err.message, code: err.code });
    // Don't reconnect on auth errors or other permanent failures
    if (err.code === 'ECONNREFUSED' || err.code === 'ENOTFOUND') {
      scheduleReconnect(brokerUrl);
    }
  });

  mqttClient.on('close', () => {
    if (isShuttingDown) {
      logger.info('mqtt.disconnected.shutdown');
      return;
    }
    logger.warn('mqtt.disconnected.unexpected');
    scheduleReconnect(brokerUrl);
  });

  mqttClient.on('offline', () => {
    logger.warn('mqtt.offline');
  });
}

/**
 * Initialize MQTT subscriber for vibration sensors
 * Reads broker config from process.env (loaded from config.app.yml)
 * @param {Array} equipment - Equipment array from fitness config
 * @returns {object|null} - MQTT client instance or null if not configured
 */
export function initMqttSubscriber(equipment = []) {
  // Read MQTT config from process.env (set by config loader from config.app.yml)
  const mqttConfig = process.env.mqtt || {};
  const { host, port = 1883 } = mqttConfig;
  
  if (!host) {
    logger.warn('mqtt.not_configured', { message: 'No mqtt.host in config.app.yml, skipping MQTT subscriber' });
    return null;
  }
  
  const brokerUrl = `mqtt://${host}:${port}`;
  
  sensorTopicMap = buildSensorTopicMap(equipment);
  
  if (sensorTopicMap.size === 0) {
    logger.info('mqtt.no_vibration_sensors', { message: 'No vibration sensors configured in equipment' });
    return null;
  }

  logger.info('mqtt.initializing', { broker: brokerUrl, sensorCount: sensorTopicMap.size });
  
  isShuttingDown = false;
  reconnectAttempts = 0;
  
  connectToBroker(brokerUrl);
  
  return mqttClient;
}

/**
 * Gracefully close MQTT connection and cleanup
 */
export function closeMqttConnection() {
  isShuttingDown = true;
  
  if (reconnectTimeout) {
    clearTimeout(reconnectTimeout);
    reconnectTimeout = null;
  }
  
  if (mqttClient) {
    mqttClient.end(true); // Force close
    mqttClient = null;
  }
  
  lastBroadcastTime.clear();
  logger.info('mqtt.closed');
}

/**
 * Get current MQTT connection status for health checks
 * @returns {{ connected: boolean, reconnectAttempts: number, sensorCount: number }}
 */
export function getMqttStatus() {
  return {
    connected: mqttClient?.connected || false,
    reconnectAttempts,
    sensorCount: sensorTopicMap.size,
    topics: Array.from(sensorTopicMap.keys())
  };
}
```

**File:** `backend/api.mjs` (modification)

Initialize MQTT subscriber using fitness equipment config (broker settings come from `process.env.mqtt`):

```javascript
import { initMqttSubscriber } from './lib/mqtt.mjs';
import { loadFile } from './lib/io.mjs';

// In server initialization, after config is loaded into process.env
const fitnessConfig = loadFile('config/apps/fitness') || {};
if (process.env.mqtt && fitnessConfig.equipment) {
  initMqttSubscriber(fitnessConfig.equipment);
}
```

### Phase 2: FitnessContext Integration

**File:** `frontend/src/context/FitnessContext.jsx` (modification)

Add vibration state handling to the WebSocket message processor. The state is keyed by `equipmentId` from the fitness config.

```javascript
import { VIBRATION_CONSTANTS } from '../modules/Fitness/FitnessPlugins/plugins/VibrationApp/constants';

// Add state for vibration sensors (keyed by equipment ID from config)
const [vibrationState, setVibrationState] = useState({});

// Track debounce tokens to cancel stale timeouts (prevents race condition)
const vibrationTimeoutRefs = useRef({});

// Cleanup timeouts on unmount
useEffect(() => {
  return () => {
    Object.values(vibrationTimeoutRefs.current).forEach(clearTimeout);
  };
}, []);

// In ws.onmessage handler, add vibration handling:
ws.onmessage = (event) => {
  try {
    const data = JSON.parse(event.data);
    
    if (data.topic === 'vibration') {
      handleVibrationEvent(data);
      return;
    }
    
    // ... existing fitness data handling
  } catch (e) {
    console.warn('FitnessContext: Failed to parse WebSocket message', e);
  }
};

/**
 * Calculate intensity (magnitude) from accelerometer axes
 * @param {number|null} x - X-axis acceleration
 * @param {number|null} y - Y-axis acceleration  
 * @param {number|null} z - Z-axis acceleration
 * @returns {number} - Magnitude (g-force)
 */
const calculateIntensity = (x, y, z) => {
  if (x == null || y == null || z == null) return 0;
  return Math.sqrt(x * x + y * y + z * z);
};

/**
 * Handle incoming vibration event from WebSocket
 * Uses debounce tokens to prevent race conditions when clearing state
 */
const handleVibrationEvent = React.useCallback((payload) => {
  const { equipmentId, equipmentName, equipmentType, thresholds, data, timestamp } = payload;
  
  if (!equipmentId) {
    console.warn('FitnessContext: Received vibration event without equipmentId');
    return;
  }
  
  // Cancel any pending clear timeout for this equipment
  if (vibrationTimeoutRefs.current[equipmentId]) {
    clearTimeout(vibrationTimeoutRefs.current[equipmentId]);
    vibrationTimeoutRefs.current[equipmentId] = null;
  }
  
  setVibrationState(prev => ({
    ...prev,
    [equipmentId]: {
      id: equipmentId,
      name: equipmentName,
      type: equipmentType,
      thresholds,
      vibration: data.vibration,
      lastEvent: timestamp,
      intensity: calculateIntensity(data.x_axis, data.y_axis, data.z_axis),
      axes: { x: data.x_axis, y: data.y_axis, z: data.z_axis },
      battery: data.battery,
      batteryLow: data.battery_low,
      linkquality: data.linkquality
    }
  }));
  
  // Auto-clear vibration state after duration (with cancellable token)
  if (data.vibration) {
    const timeoutId = setTimeout(() => {
      setVibrationState(prev => {
        // Only clear if this is still the same event (check timestamp)
        if (prev[equipmentId]?.lastEvent === timestamp) {
          return {
            ...prev,
            [equipmentId]: { ...prev[equipmentId], vibration: false }
          };
        }
        return prev;
      });
      vibrationTimeoutRefs.current[equipmentId] = null;
    }, VIBRATION_CONSTANTS.VIBRATION_ACTIVE_DURATION_MS);
    
    vibrationTimeoutRefs.current[equipmentId] = timeoutId;
  }
}, []);
```

Add to context value:
```javascript
const value = {
  // ... existing values
  vibrationState,
  // Helper to get vibration data for specific equipment
  getEquipmentVibration: (equipmentId) => vibrationState[equipmentId] || null
};
```

### Phase 3: VibrationApp FitnessPlugin

**File:** `frontend/src/modules/Fitness/FitnessPlugins/plugins/VibrationApp/manifest.js`

```javascript
export default {
  id: 'vibration_monitor',
  name: 'Vibration Monitor',
  version: '1.0.0',
  icon: '📳',
  description: 'Real-time vibration feedback for equipment with sensors',
  modes: { standalone: true, overlay: true, sidebar: true, mini: true },
  requires: { sessionActive: false, participants: false, heartRate: false, governance: false },
  pauseVideoOnLaunch: false
};
```

**File:** `frontend/src/modules/Fitness/FitnessPlugins/plugins/VibrationApp/VibrationApp.jsx`

```jsx
import React from 'react';
import { useFitnessContext } from '../../../../../context/FitnessContext';
import { VIBRATION_CONSTANTS } from './constants';
import './VibrationApp.scss';

/**
 * Equipment type to icon mapping
 * NOTE: Use snake_case consistently for equipment types across all config and code
 */
const EQUIPMENT_ICONS = {
  punching_bag: '🥊',
  step_platform: '🦶',  // Unified: use step_platform everywhere
  bike: '🚴',
  treadmill: '🏃',
  default: '📳'
};

/**
 * VibrationApp - Real-time vibration feedback for fitness equipment
 * @param {object} props - Component props
 * @param {'standalone'|'overlay'|'sidebar'|'mini'} props.mode - Display mode
 */
const VibrationApp = ({ mode = 'standalone' }) => {
  const { vibrationState, equipmentConfig, wsConnected } = useFitnessContext();
  
  // Get all equipment with vibration sensors
  const vibrationEquipment = React.useMemo(() => {
    return Object.values(vibrationState).filter(Boolean);
  }, [vibrationState]);
  
  // Loading state while WebSocket connects
  if (!wsConnected) {
    return (
      <div className={`vibration-app vibration-app--${mode} vibration-app--loading`}>
        <h2>📳 Equipment Activity</h2>
        <p className="vibration-app__loading">
          <span className="vibration-app__spinner" aria-hidden="true" />
          Connecting to sensor network...
        </p>
      </div>
    );
  }
  
  if (vibrationEquipment.length === 0) {
    return (
      <div className={`vibration-app vibration-app--${mode} vibration-app--empty`}>
        <h2>📳 Equipment Activity</h2>
        <p className="vibration-app__no-sensors">
          No vibration sensors configured. Add equipment with sensors to your fitness config.
        </p>
      </div>
    );
  }
  
  return (
    <div className={`vibration-app vibration-app--${mode}`}>
      <h2>📳 Equipment Activity</h2>
      
      <div className="vibration-sensors">
        {vibrationEquipment.map(equipment => (
          <VibrationCard
            key={equipment.id}
            equipment={equipment}
            icon={EQUIPMENT_ICONS[equipment.type] || EQUIPMENT_ICONS.default}
          />
        ))}
      </div>
      
      <div className="vibration-history">
        <h3>Recent Activity</h3>
        <ActivityTimeline equipment={vibrationEquipment} />
      </div>
    </div>
  );
};

const VibrationCard = ({ equipment, icon }) => {
  const { 
    id, name, type, vibration, intensity, axes, 
    battery, batteryLow, lastEvent, thresholds 
  } = equipment || {};
  
  const intensityLevel = React.useMemo(() => {
    if (!intensity || !thresholds) return 'none';
    if (intensity >= thresholds.high) return 'high';
    if (intensity >= thresholds.medium) return 'medium';
    if (intensity >= thresholds.low) return 'low';
    return 'none';
  }, [intensity, thresholds]);
  
  const timeSinceEvent = React.useMemo(() => {
    if (!lastEvent) return null;
    const seconds = Math.floor((Date.now() - lastEvent) / 1000);
    if (seconds < 60) return `${seconds}s ago`;
    return `${Math.floor(seconds / 60)}m ago`;
  }, [lastEvent]);
  
  // Calculate dominant axis for directional indicator
  const dominantAxis = React.useMemo(() => {
    if (!axes) return null;
    const absX = Math.abs(axes.x || 0);
    const absY = Math.abs(axes.y || 0);
    const absZ = Math.abs(axes.z || 0);
    const max = Math.max(absX, absY, absZ);
    if (max < 2) return null; // Too weak to determine
    if (absX === max) return axes.x > 0 ? 'right' : 'left';
    if (absY === max) return axes.y > 0 ? 'forward' : 'back';
    if (absZ === max) return axes.z > 0 ? 'up' : 'down';
    return null;
  }, [axes]);
  
  const maxIntensity = thresholds?.high || 30;
  
  return (
    <div className={`vibration-card vibration-card--${intensityLevel} ${vibration ? 'vibration-card--active' : ''}`}>
      <div className="vibration-card__header">
        <span className="vibration-card__icon">{icon}</span>
        <span className="vibration-card__title">{name}</span>
      </div>
      
      <div className="vibration-card__status">
        {vibration ? (
          <div className="vibration-card__pulse">
            <span className="vibration-card__pulse-ring" />
            <span className="vibration-card__pulse-dot" />
          </div>
        ) : (
          <div className="vibration-card__idle">Idle</div>
        )}
      </div>
      
      <div className="vibration-card__metrics">
        {intensity > 0 && (
          <div className="vibration-card__intensity">
            <label>Intensity</label>
            <div className="vibration-card__intensity-bar">
              <div 
                className="vibration-card__intensity-fill"
                style={{ width: `${Math.min(100, (intensity / maxIntensity) * 100)}%` }}
              />
            </div>
            <span>{intensity.toFixed(1)}</span>
          </div>
        )}
        
        {axes && (
          <div className="vibration-card__axes">
            <div className="vibration-card__axis-bars">
              <AxisBar label="X" value={axes.x} max={maxIntensity} color="#ef4444" />
              <AxisBar label="Y" value={axes.y} max={maxIntensity} color="#22c55e" />
              <AxisBar label="Z" value={axes.z} max={maxIntensity} color="#3b82f6" />
            </div>
            {dominantAxis && vibration && (
              <div className="vibration-card__direction">
                <DirectionIndicator direction={dominantAxis} />
              </div>
            )}
          </div>
        )}
      </div>
      
      <div className="vibration-card__footer">
        {timeSinceEvent && <span className="vibration-card__time">{timeSinceEvent}</span>}
        {battery != null && (
          <span className={`vibration-card__battery ${batteryLow ? 'vibration-card__battery--low' : ''}`}>
            🔋 {battery}%
          </span>
        )}
      </div>
    </div>
  );
};

// Axis bar component for visualizing individual axis values
const AxisBar = ({ label, value, max, color }) => {
  const absValue = Math.abs(value || 0);
  const percentage = Math.min(100, (absValue / max) * 100);
  const isNegative = (value || 0) < 0;
  
  return (
    <div className="axis-bar">
      <span className="axis-bar__label">{label}</span>
      <div className="axis-bar__track">
        <div className="axis-bar__center" />
        <div 
          className={`axis-bar__fill axis-bar__fill--${isNegative ? 'negative' : 'positive'}`}
          style={{ 
            width: `${percentage / 2}%`,
            backgroundColor: color,
            [isNegative ? 'right' : 'left']: '50%'
          }}
        />
      </div>
      <span className="axis-bar__value">{value?.toFixed(1) || '0.0'}</span>
    </div>
  );
};

// Direction indicator showing dominant impact direction
const DirectionIndicator = ({ direction }) => {
  const arrows = {
    up: '⬆️', down: '⬇️',
    left: '⬅️', right: '➡️',
    forward: '↗️', back: '↙️'
  };
  const labels = {
    up: 'Uppercut', down: 'Stomp',
    left: 'Left Hook', right: 'Right Hook',
    forward: 'Jab', back: 'Pull Back'
  };
  
  return (
    <div className="direction-indicator">
      <span className="direction-indicator__arrow">{arrows[direction]}</span>
      <span className="direction-indicator__label">{labels[direction]}</span>
    </div>
  );
};

/**
 * ActivityTimeline - Shows recent vibration events as fading dots
 * @param {object} props - Component props
 * @param {Array} props.equipment - Array of equipment with vibration data
 */
const ActivityTimeline = ({ equipment }) => {
  const [events, setEvents] = React.useState([]);
  const processedEventsRef = React.useRef(new Set());
  
  // Process new vibration events from equipment prop
  // This avoids the memory leak of depending on vibrationState directly
  React.useEffect(() => {
    equipment.forEach(equip => {
      if (!equip?.vibration || !equip?.lastEvent) return;
      
      // Create unique event key
      const eventKey = `${equip.id}-${equip.lastEvent}`;
      
      // Skip if already processed (deduplication)
      if (processedEventsRef.current.has(eventKey)) return;
      
      // Check for near-duplicate (within threshold)
      const isDuplicate = Array.from(processedEventsRef.current).some(key => {
        const [id, time] = key.split('-');
        return id === equip.id && 
          Math.abs(parseInt(time, 10) - equip.lastEvent) < VIBRATION_CONSTANTS.DUPLICATE_EVENT_THRESHOLD_MS;
      });
      
      if (isDuplicate) return;
      
      // Mark as processed
      processedEventsRef.current.add(eventKey);
      
      // Calculate dominant axis for the event
      const axes = equip.axes || {};
      const absX = Math.abs(axes.x || 0);
      const absY = Math.abs(axes.y || 0);
      const absZ = Math.abs(axes.z || 0);
      const maxAxis = Math.max(absX, absY, absZ);
      let dominantAxis = null;
      if (maxAxis >= VIBRATION_CONSTANTS.MIN_AXIS_THRESHOLD) {
        if (absX === maxAxis) dominantAxis = 'x';
        else if (absY === maxAxis) dominantAxis = 'y';
        else dominantAxis = 'z';
      }
      
      setEvents(prev => [
        { 
          id: eventKey,
          equipmentId: equip.id,
          type: equip.type,
          intensity: equip.intensity,
          axes: { ...axes },
          dominantAxis,
          time: equip.lastEvent 
        },
        ...prev.slice(0, VIBRATION_CONSTANTS.ACTIVITY_TIMELINE_MAX_EVENTS - 1)
      ]);
    });
    
    // Cleanup old processed events to prevent memory growth
    const now = Date.now();
    processedEventsRef.current.forEach(key => {
      const time = parseInt(key.split('-')[1], 10);
      if (now - time > VIBRATION_CONSTANTS.ACTIVITY_DOT_FADE_DURATION_MS) {
        processedEventsRef.current.delete(key);
      }
    });
  }, [equipment]);
  
  return (
    <div className="activity-timeline">
      {events.map(event => (
        <div 
          key={event.id}
          className={`activity-dot activity-dot--${event.type} activity-dot--axis-${event.dominantAxis || 'none'}`}
          style={{ 
            opacity: Math.max(0.3, 1 - (Date.now() - event.time) / 30000),
            transform: `scale(${0.5 + Math.min(0.5, event.intensity / 30)})`
          }}
          title={`${event.type} | X:${event.axes?.x?.toFixed(1)} Y:${event.axes?.y?.toFixed(1)} Z:${event.axes?.z?.toFixed(1)}`}
        />
      ))}
    </div>
  );
};

export default VibrationApp;
```

**File:** `frontend/src/modules/Fitness/FitnessPlugins/plugins/VibrationApp/VibrationApp.scss`

```scss
// VibrationApp styles
// Uses BEM naming convention with max 3 levels of nesting

.vibration-app {
  padding: 1rem;
  
  &--mini {
    padding: 0.5rem;
  }
  
  &--loading,
  &--empty {
    text-align: center;
    padding: 2rem;
  }
  
  h2 {
    margin: 0 0 1rem;
    font-size: 1.5rem;
  }
}

// Loading state
.vibration-app__loading {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.75rem;
  color: rgba(255, 255, 255, 0.6);
}

.vibration-app__spinner {
  width: 20px;
  height: 20px;
  border: 2px solid rgba(255, 255, 255, 0.2);
  border-top-color: #4CAF50;
  border-radius: 50%;
  animation: spinner-rotate 1s linear infinite;
}

@keyframes spinner-rotate {
  to { transform: rotate(360deg); }
}

.vibration-app__no-sensors {
  color: rgba(255, 255, 255, 0.5);
}

// Equipment card grid
.vibration-sensors {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
  gap: 1rem;
}

// Individual equipment card
.vibration-card {
  background: rgba(255, 255, 255, 0.05);
  border-radius: 12px;
  padding: 1rem;
  border: 2px solid transparent;
  transition: all 0.3s ease;
  
  // Accessibility: ensure sufficient color contrast
  &:focus-within {
    outline: 2px solid #fff;
    outline-offset: 2px;
  }
  
  &--active {
    border-color: var(--vibration-color, #4CAF50);
    box-shadow: 0 0 20px rgba(76, 175, 80, 0.3);
    animation: pulse-glow 0.5s ease-out;
  }
  
  &--low { --vibration-color: #4CAF50; }
  &--medium { --vibration-color: #FF9800; }
  &--high { --vibration-color: #F44336; }
}

// Card sub-elements (flattened to avoid deep nesting)
.vibration-card__header {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin-bottom: 1rem;
}

.vibration-card__icon {
  font-size: 1.5rem;
}

.vibration-card__title {
  font-weight: 600;
  font-size: 1.1rem;
}

.vibration-card__status {
  display: flex;
  justify-content: center;
  padding: 1rem 0;
  // Accessibility: announce state changes to screen readers
  &[aria-live] {
    clip: rect(0, 0, 0, 0);
    height: 1px;
    width: 1px;
    overflow: hidden;
    position: absolute;
  }
}

.vibration-card__pulse {
  position: relative;
  width: 60px;
  height: 60px;
}

.vibration-card__pulse-ring {
  position: absolute;
  inset: 0;
  border: 3px solid var(--vibration-color, #4CAF50);
  border-radius: 50%;
  animation: pulse-ring 1s ease-out infinite;
  // Accessibility: reduce motion for users who prefer it
  @media (prefers-reduced-motion: reduce) {
    animation: none;
    opacity: 0.5;
  }
}

.vibration-card__pulse-dot {
  position: absolute;
  top: 50%;
  left: 50%;
  width: 20px;
  height: 20px;
  margin: -10px 0 0 -10px;
  background: var(--vibration-color, #4CAF50);
  border-radius: 50%;
}

.vibration-card__idle {
  color: rgba(255, 255, 255, 0.4);
  font-size: 0.9rem;
}

.vibration-card__metrics {
  margin-top: 1rem;
}

.vibration-card__intensity {
  display: flex;
  align-items: center;
  gap: 0.5rem;
    
    label {
      font-size: 0.8rem;
      color: rgba(255, 255, 255, 0.6);
      min-width: 60px;
    }
  }
  
  &__intensity-bar {
    flex: 1;
    height: 8px;
    background: rgba(255, 255, 255, 0.1);
    border-radius: 4px;
    overflow: hidden;
  }
  
  &__intensity-fill {
    height: 100%;
    background: var(--vibration-color, #4CAF50);
    transition: width 0.2s ease;
  }
  
  &__axes {
    margin-top: 0.75rem;
  }
  
  &__axis-bars {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }
  
  &__direction {
    margin-top: 0.5rem;
    text-align: center;
  }
  
  &__footer {
    display: flex;
    justify-content: space-between;
    margin-top: 1rem;
    font-size: 0.75rem;
    color: rgba(255, 255, 255, 0.4);
  }
  
  &__battery--low {
    color: #F44336;
  }
}

// Axis bar visualization for X, Y, Z accelerometer data
.axis-bar {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 0.75rem;
  
  &__label {
    width: 16px;
    font-weight: 600;
    color: rgba(255, 255, 255, 0.6);
    font-family: monospace;
  }
  
  &__track {
    flex: 1;
    height: 6px;
    background: rgba(255, 255, 255, 0.1);
    border-radius: 3px;
    position: relative;
    overflow: hidden;
  }
  
  &__center {
    position: absolute;
    left: 50%;
    top: 0;
    bottom: 0;
    width: 1px;
    background: rgba(255, 255, 255, 0.3);
  }
  
  &__fill {
    position: absolute;
    top: 0;
    bottom: 0;
    transition: width 0.15s ease;
    border-radius: 3px;
    
    &--positive {
      left: 50%;
      border-top-left-radius: 0;
      border-bottom-left-radius: 0;
    }
    
    &--negative {
      right: 50%;
      border-top-right-radius: 0;
      border-bottom-right-radius: 0;
    }
  }
  
  &__value {
    width: 40px;
    text-align: right;
    font-family: monospace;
    color: rgba(255, 255, 255, 0.5);
  }
}

// Direction indicator showing punch/step type
.direction-indicator {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.25rem 0.75rem;
  background: rgba(255, 255, 255, 0.1);
  border-radius: 1rem;
  animation: direction-pop 0.3s ease-out;
  
  &__arrow {
    font-size: 1.2rem;
  }
  
  &__label {
    font-size: 0.75rem;
    font-weight: 500;
    color: rgba(255, 255, 255, 0.8);
  }
}

@keyframes direction-pop {
  0% { transform: scale(0.8); opacity: 0; }
  100% { transform: scale(1); opacity: 1; }
}

.activity-timeline {
  display: flex;
  gap: 4px;
  flex-wrap: wrap;
  padding: 1rem 0;
}

.activity-dot {
  width: 12px;
  height: 12px;
  border-radius: 50%;
  transition: all 0.3s ease;
  
  // Equipment type modifiers - use snake_case consistently
  &--punching_bag {
    background: #F44336;
  }
  
  &--step_platform {
    background: #2196F3;
  }
  
  &--bike {
    background: #4CAF50;
  }
  
  &--treadmill {
    background: #9C27B0;
  }
}

@keyframes pulse-ring {
  0% {
    transform: scale(0.8);
    opacity: 1;
  }
  100% {
    transform: scale(1.5);
    opacity: 0;
  }
}

@keyframes pulse-glow {
  0% {
    box-shadow: 0 0 0 rgba(76, 175, 80, 0);
  }
  50% {
    box-shadow: 0 0 30px rgba(76, 175, 80, 0.5);
  }
  100% {
    box-shadow: 0 0 20px rgba(76, 175, 80, 0.3);
  }
}
```

**File:** `frontend/src/modules/Fitness/FitnessPlugins/plugins/VibrationApp/index.jsx`

```jsx
export { default } from './VibrationApp';
export { default as manifest } from './manifest';
```

### Phase 4: Plugin Registration

**File:** `frontend/src/modules/Fitness/FitnessPlugins/registry.js` (modification)

```javascript
import VibrationApp, { manifest as vibrationManifest } from './plugins/VibrationApp';

// Add to plugins array
export const plugins = [
  // ... existing plugins
  { component: VibrationApp, manifest: vibrationManifest }
];
```

## Configuration

### Application Configuration (`config/config.app.yml`)

Add MQTT broker settings to the main application config:

```yaml
# In config/config.app.yml (production)
mqtt:
  host: mosquitto      # Container name on {local-network}
  port: 1883
```

### Local Development Override (`config/config.app-local.yml`)

Override for dev environment to connect via exposed port:

```yaml
# In config/config.app-local.yml (dev only)
mqtt:
  host: homeserver.local  # Connect to host where mosquitto is running
  port: 1883
```

### Fitness Configuration (`config/apps/fitness.yml`)

Add vibration sensors to the existing equipment registry. The MQTT topics are configured per-equipment:

```yaml
# -----------------------------------------------------------------------------
# Equipment Registry
# -----------------------------------------------------------------------------
equipment:
  - id: punching_bag
    type: punching_bag
    name: "Punching Bag"
    location: "Garage"
    sensor:
      type: vibration
      mqtt_topic: "zigbee2mqtt-usb/Garage Punching Bag Vibration Sensor"
      ieee_address: "0xffffb40e06039375"
    workout_types:
      - boxing
      - cardio
    thresholds:
      low: 5
      medium: 15
      high: 30

  - id: step_platform
    type: step_platform  # NOTE: Use step_platform (not "step") for consistency across code
    name: "Step Platform"
    location: "Garage"
    sensor:
      type: vibration
      mqtt_topic: "zigbee2mqtt-usb/Garage Step Vibration Sensor"
      ieee_address: "0xffffb40e0605feba"
    workout_types:
      - step
      - cardio
      - hiit
    thresholds:
      low: 3
      medium: 8
      high: 15
```

This approach:
- MQTT broker config lives in `config.app.yml` (shared infrastructure)
- Equipment/sensor definitions live in `config/apps/fitness.yml` (app-specific)
- Dev overrides via `config.app-local.yml` pattern
- Topics are auto-discovered from equipment[].sensor.mqtt_topic

## Vibration Simulator

Similar to the fitness heart rate simulator (`_extentions/fitness/simulation.mjs`), we need a vibration simulator that publishes mock sensor data directly to MQTT for testing without physical sensors.

### Purpose

- Test VibrationApp UI without physical sensors
- Simulate various intensity levels and patterns
- Debug MQTT → WebSocket → Frontend data flow
- Demo the feature in environments without Zigbee hardware

### File: `_extentions/fitness/vibration-simulation.mjs`

```javascript
#!/usr/bin/env node
/**
 * Vibration Sensor Simulator
 * 
 * Publishes mock vibration sensor data to MQTT, simulating real Third Reality
 * vibration sensors. Reads equipment config from fitness.yml to discover
 * which sensors to simulate.
 * 
 * Usage:
 *   node vibration-simulation.mjs [mode]
 * 
 * Modes:
 *   random   - Random vibration events (default)
 *   workout  - Simulates a boxing/step workout pattern
 *   demo     - Continuous alternating hits for demos
 */

import mqtt from 'mqtt';
import fs from 'fs';
import path from 'path';

// Load .env file manually (same pattern as simulation.mjs)
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
        if (!process.env[key]) {
          process.env[key] = value;
        }
      }
    }
  });
  console.log('📄 Loaded .env from project root');
}

// Import config framework
import { resolveConfigPaths } from '../../backend/lib/config/pathResolver.mjs';
import { loadAllConfig } from '../../backend/lib/config/loader.mjs';
import { configService } from '../../backend/lib/config/ConfigService.mjs';
import { userDataService } from '../../backend/lib/config/UserDataService.mjs';
import { loadFile } from '../../backend/lib/io.mjs';

// Configuration
const SIMULATION_DURATION = 180 * 1000; // 3 minutes default

// Initialize config
const isDocker = fs.existsSync('/.dockerenv');
const configPaths = resolveConfigPaths({ isDocker, codebaseDir: rootDir });

if (configPaths.error) {
  console.error('❌ Configuration error:', configPaths.error);
  process.exit(1);
}

console.log(`📁 Config source: ${configPaths.source}`);

const configResult = loadAllConfig({
  configDir: configPaths.configDir,
  dataDir: configPaths.dataDir,
  isDocker,
  isDev: !isDocker
});

process.env = { ...process.env, isDocker, ...configResult.config };

// Load fitness config to get equipment with vibration sensors
function loadEquipmentConfig() {
  try {
    const householdId = configService.getDefaultHouseholdId();
    const householdConfig = userDataService.readHouseholdAppData(householdId, 'fitness', 'config');
    if (householdConfig?.equipment) {
      return householdConfig.equipment;
    }
    const legacyConfig = loadFile('config/apps/fitness');
    return legacyConfig?.equipment || [];
  } catch (err) {
    console.error('❌ Failed to load equipment config:', err.message);
    return [];
  }
}

// Get MQTT config from process.env (populated from config.app.yml / config.app-local.yml)
function getMqttConfig() {
  const mqttConfig = process.env.mqtt || {};
  // For simulator, prefer connecting to exposed port on homeserver.local
  // since simulator typically runs on dev machine, not in container
  return {
    host: mqttConfig.host || 'homeserver.local',
    port: mqttConfig.port || 1883
  };
}

// Build list of vibration sensors from equipment config
function getVibrationSensors(equipment) {
  return equipment
    .filter(e => e?.sensor?.type === 'vibration' && e.sensor.mqtt_topic)
    .map(e => ({
      id: e.id,
      name: e.name,
      type: e.type,
      topic: e.sensor.mqtt_topic,
      thresholds: e.thresholds || { low: 5, medium: 15, high: 30 }
    }));
}

// Generate realistic accelerometer data for a vibration event
function generateVibrationData(intensity = 'medium') {
  const intensityMap = {
    light: { base: 3, variance: 2 },
    medium: { base: 12, variance: 5 },
    hard: { base: 25, variance: 10 }
  };
  
  const { base, variance } = intensityMap[intensity] || intensityMap.medium;
  
  // Generate random-ish accelerometer values
  const randomAxis = () => (Math.random() - 0.5) * 2 * (base + Math.random() * variance);
  
  return {
    vibration: true,
    battery_low: false,
    battery: 85 + Math.floor(Math.random() * 15),
    voltage: 2900 + Math.floor(Math.random() * 300),
    x_axis: parseFloat(randomAxis().toFixed(1)),
    y_axis: parseFloat(randomAxis().toFixed(1)),
    z_axis: parseFloat(randomAxis().toFixed(1)),
    linkquality: 120 + Math.floor(Math.random() * 80)
  };
}

// Generate idle state (vibration: false)
function generateIdleData() {
  return {
    vibration: false,
    battery_low: false,
    battery: 85 + Math.floor(Math.random() * 15),
    voltage: 2900 + Math.floor(Math.random() * 300),
    x_axis: 0,
    y_axis: 0,
    z_axis: 0,
    linkquality: 120 + Math.floor(Math.random() * 80)
  };
}

class VibrationSimulator {
  constructor(mode = 'random') {
    this.mode = mode;
    this.mqttClient = null;
    this.sensors = [];
    this.running = false;
    this.timers = [];
  }

  async connect() {
    const equipment = loadEquipmentConfig();
    this.sensors = getVibrationSensors(equipment);
    
    if (this.sensors.length === 0) {
      console.error('❌ No vibration sensors found in equipment config');
      console.log('💡 Add equipment with sensor.type: vibration to config/apps/fitness.yml');
      process.exit(1);
    }
    
    console.log(`🎯 Found ${this.sensors.length} vibration sensor(s):`);
    this.sensors.forEach(s => console.log(`   - ${s.name} (${s.id}): ${s.topic}`));
    
    const mqttConfig = getMqttConfig();
    const brokerUrl = `mqtt://${mqttConfig.host}:${mqttConfig.port}`;
    
    console.log(`\n🔌 Connecting to MQTT broker: ${brokerUrl}`);
    
    return new Promise((resolve, reject) => {
      this.mqttClient = mqtt.connect(brokerUrl);
      
      this.mqttClient.on('connect', () => {
        console.log('✅ Connected to MQTT broker');
        resolve();
      });
      
      this.mqttClient.on('error', (err) => {
        console.error('❌ MQTT error:', err.message);
        reject(err);
      });
    });
  }

  publishVibration(sensor, intensity = 'medium') {
    const data = generateVibrationData(intensity);
    const message = JSON.stringify(data);
    
    this.mqttClient.publish(sensor.topic, message);
    console.log(`📳 ${sensor.name} [${intensity}] - intensity: ${Math.sqrt(data.x_axis**2 + data.y_axis**2 + data.z_axis**2).toFixed(1)}`);
    
    // Send idle state after 100ms (simulates real sensor behavior)
    setTimeout(() => {
      this.mqttClient.publish(sensor.topic, JSON.stringify(generateIdleData()));
    }, 100);
  }

  // Random mode: occasional random hits
  startRandomMode() {
    console.log('\n🎲 Starting RANDOM mode - occasional random vibrations\n');
    
    this.sensors.forEach(sensor => {
      const scheduleNext = () => {
        if (!this.running) return;
        
        // Random interval between 2-8 seconds
        const delay = 2000 + Math.random() * 6000;
        const timer = setTimeout(() => {
          const intensities = ['light', 'medium', 'hard'];
          const intensity = intensities[Math.floor(Math.random() * intensities.length)];
          this.publishVibration(sensor, intensity);
          scheduleNext();
        }, delay);
        this.timers.push(timer);
      };
      scheduleNext();
    });
  }

  // Workout mode: simulates realistic workout pattern
  startWorkoutMode() {
    console.log('\n🏋️ Starting WORKOUT mode - simulated exercise pattern\n');
    
    let phase = 'warmup';
    let phaseTime = 0;
    
    const tick = () => {
      if (!this.running) return;
      
      phaseTime += 1000;
      
      // Phase transitions
      if (phase === 'warmup' && phaseTime > 30000) {
        phase = 'active';
        phaseTime = 0;
        console.log('\n⚡ Phase: ACTIVE\n');
      } else if (phase === 'active' && phaseTime > 90000) {
        phase = 'cooldown';
        phaseTime = 0;
        console.log('\n🧊 Phase: COOLDOWN\n');
      }
      
      // Probability and intensity based on phase
      const config = {
        warmup: { probability: 0.1, intensities: ['light', 'light', 'medium'] },
        active: { probability: 0.4, intensities: ['medium', 'medium', 'hard', 'hard'] },
        cooldown: { probability: 0.15, intensities: ['light', 'medium'] }
      }[phase];
      
      this.sensors.forEach(sensor => {
        if (Math.random() < config.probability) {
          const intensity = config.intensities[Math.floor(Math.random() * config.intensities.length)];
          this.publishVibration(sensor, intensity);
        }
      });
      
      const timer = setTimeout(tick, 1000);
      this.timers.push(timer);
    };
    
    console.log('🔥 Phase: WARMUP\n');
    tick();
  }

  // Demo mode: continuous alternating for demos
  startDemoMode() {
    console.log('\n🎬 Starting DEMO mode - continuous alternating hits\n');
    
    let sensorIndex = 0;
    
    const tick = () => {
      if (!this.running) return;
      
      const sensor = this.sensors[sensorIndex % this.sensors.length];
      const intensities = ['light', 'medium', 'hard'];
      const intensity = intensities[Math.floor(Math.random() * intensities.length)];
      
      this.publishVibration(sensor, intensity);
      
      sensorIndex++;
      const timer = setTimeout(tick, 1500);
      this.timers.push(timer);
    };
    
    tick();
  }

  start() {
    this.running = true;
    
    switch (this.mode) {
      case 'workout':
        this.startWorkoutMode();
        break;
      case 'demo':
        this.startDemoMode();
        break;
      case 'random':
      default:
        this.startRandomMode();
    }
    
    // Stop after duration
    setTimeout(() => {
      this.stop();
    }, SIMULATION_DURATION);
  }

  stop() {
    console.log('\n🛑 Stopping simulation...');
    this.running = false;
    this.timers.forEach(t => clearTimeout(t));
    this.timers = [];
    
    if (this.mqttClient) {
      this.mqttClient.end();
    }
    
    console.log('✅ Simulation complete');
    process.exit(0);
  }
}

// Main
const mode = process.argv[2] || 'random';
const simulator = new VibrationSimulator(mode);

console.log('╔══════════════════════════════════════════════════════════╗');
console.log('║           🥊 Vibration Sensor Simulator 🦶               ║');
console.log('╠══════════════════════════════════════════════════════════╣');
console.log(`║  Mode: ${mode.padEnd(50)}║`);
console.log(`║  Duration: ${(SIMULATION_DURATION / 1000)}s`.padEnd(60) + '║');
console.log('╚══════════════════════════════════════════════════════════╝');

simulator.connect()
  .then(() => simulator.start())
  .catch(err => {
    console.error('❌ Failed to start:', err.message);
    process.exit(1);
  });

// Handle graceful shutdown
process.on('SIGINT', () => simulator.stop());
process.on('SIGTERM', () => simulator.stop());
```

### Usage

```bash
# From project root
cd _extentions/fitness

# Random mode (default) - occasional random hits
node vibration-simulation.mjs

# Workout mode - simulates exercise pattern with phases
node vibration-simulation.mjs workout

# Demo mode - continuous alternating hits
node vibration-simulation.mjs demo
```

### How It Works

1. **Config Discovery**: Reads equipment config from fitness.yml (same as backend)
2. **MQTT Connection**: Connects to broker using config.app.yml settings
3. **Topic Publishing**: Publishes to exact same topics as real sensors
4. **Realistic Data**: Generates accelerometer values matching real sensor output
5. **Vibration Pattern**: Sends `vibration: true` followed by `vibration: false` (mimics real sensor)

### Simulation Modes

| Mode | Behavior | Use Case |
|------|----------|----------|
| `random` | Random hits every 2-8 seconds | General testing |
| `workout` | Phases (warmup → active → cooldown) with varying intensity | Testing workout integration |
| `demo` | Continuous alternating hits every 1.5s | Live demos |

## Dependencies

### Backend

Add to `backend/package.json`:

```json
{
  "dependencies": {
    "mqtt": "^5.3.0"
  }
}
```

### Frontend

No additional dependencies required.

## Data Flow

1. **Sensor → MQTT**: Vibration sensor publishes state change to Zigbee2MQTT topic
2. **MQTT → Backend**: Backend MQTT client receives message and parses payload
3. **Backend → WebSocket**: Backend broadcasts vibration event to all connected clients
4. **WebSocket → FitnessContext**: Context receives and processes vibration data
5. **FitnessContext → Plugin**: VibrationApp reads state and renders visualization

## Event Debouncing

The Third Reality sensors send `vibration: true` followed by `vibration: false` with accelerometer data. To smooth the visualization:

- Keep vibration state active for 500ms after detection
- Calculate intensity from accelerometer magnitude
- Track event history for timeline visualization
- Decay visual intensity over time

## Future Enhancements

1. **Workout Integration**: Count punches/steps and integrate with session timeline
2. **Rep Counting**: Use vibration patterns to detect exercise reps
3. **Intensity Zones**: Map vibration intensity to workout zones
4. **Audio Feedback**: Play sounds on high-intensity hits
5. **Gamification**: Challenge modes (hit X times in Y seconds)
6. **History Graphs**: Show vibration intensity over time in charts

## Testing

### Unit Tests

**File:** `backend/tests/mqtt.test.mjs`

```javascript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { buildSensorTopicMap, validateVibrationPayload } from '../lib/mqtt.mjs';

describe('mqtt.mjs', () => {
  describe('buildSensorTopicMap', () => {
    it('should build map from valid equipment config', () => {
      const equipment = [
        {
          id: 'punching_bag',
          name: 'Punching Bag',
          type: 'punching_bag',
          sensor: { type: 'vibration', mqtt_topic: 'zigbee/sensor1' },
          thresholds: { low: 5, medium: 15, high: 30 }
        }
      ];
      
      const map = buildSensorTopicMap(equipment);
      
      expect(map.size).toBe(1);
      expect(map.get('zigbee/sensor1')).toEqual({
        id: 'punching_bag',
        name: 'Punching Bag',
        type: 'punching_bag',
        thresholds: { low: 5, medium: 15, high: 30 }
      });
    });
    
    it('should skip equipment without vibration sensors', () => {
      const equipment = [
        { id: 'bike', name: 'Bike', type: 'bike' }, // No sensor
        { id: 'bag', sensor: { type: 'heartrate' } } // Wrong sensor type
      ];
      
      const map = buildSensorTopicMap(equipment);
      expect(map.size).toBe(0);
    });
    
    it('should use default thresholds when not provided', () => {
      const equipment = [{
        id: 'test',
        name: 'Test',
        type: 'test',
        sensor: { type: 'vibration', mqtt_topic: 'test/topic' }
        // No thresholds
      }];
      
      const map = buildSensorTopicMap(equipment);
      expect(map.get('test/topic').thresholds).toEqual({ low: 5, medium: 15, high: 30 });
    });
    
    it('should handle null/undefined equipment array', () => {
      expect(buildSensorTopicMap(null).size).toBe(0);
      expect(buildSensorTopicMap(undefined).size).toBe(0);
    });
    
    it('should warn and return empty map for non-array input', () => {
      expect(buildSensorTopicMap('invalid').size).toBe(0);
      expect(buildSensorTopicMap({ foo: 'bar' }).size).toBe(0);
    });
  });
  
  describe('validateVibrationPayload', () => {
    it('should accept valid payload', () => {
      const payload = {
        vibration: true,
        x_axis: 10.5,
        y_axis: -3.2,
        z_axis: 8.0,
        battery: 95,
        voltage: 3100,
        linkquality: 156,
        battery_low: false
      };
      
      const result = validateVibrationPayload(payload);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });
    
    it('should require vibration to be boolean', () => {
      const result = validateVibrationPayload({ vibration: 'yes' });
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('vibration must be a boolean');
    });
    
    it('should reject non-numeric axis values', () => {
      const result = validateVibrationPayload({ 
        vibration: true, 
        x_axis: 'bad' 
      });
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('x_axis must be a number if provided');
    });
    
    it('should validate battery range', () => {
      const result = validateVibrationPayload({ 
        vibration: true, 
        battery: 150 
      });
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('battery must be between 0 and 100');
    });
    
    it('should accept null/undefined optional fields', () => {
      const result = validateVibrationPayload({ 
        vibration: false,
        x_axis: null,
        battery: undefined
      });
      expect(result.valid).toBe(true);
    });
    
    it('should reject null payload', () => {
      const result = validateVibrationPayload(null);
      expect(result.valid).toBe(false);
    });
  });
});
```

**File:** `frontend/src/modules/Fitness/FitnessPlugins/plugins/VibrationApp/__tests__/VibrationApp.test.jsx`

```javascript
import { describe, it, expect, vi } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import VibrationApp from '../VibrationApp';
import { FitnessContext } from '../../../../../../context/FitnessContext';

const mockVibrationState = {
  punching_bag: {
    id: 'punching_bag',
    name: 'Punching Bag',
    type: 'punching_bag',
    vibration: true,
    intensity: 15.5,
    axes: { x: 10, y: 5, z: 11 },
    thresholds: { low: 5, medium: 15, high: 30 },
    battery: 85,
    batteryLow: false,
    lastEvent: Date.now()
  }
};

const renderWithContext = (ui, { vibrationState = {}, wsConnected = true } = {}) => {
  return render(
    <FitnessContext.Provider value={{ vibrationState, wsConnected }}>
      {ui}
    </FitnessContext.Provider>
  );
};

describe('VibrationApp', () => {
  it('should show loading state when WebSocket not connected', () => {
    renderWithContext(<VibrationApp />, { wsConnected: false });
    expect(screen.getByText(/Connecting to sensor network/)).toBeInTheDocument();
  });
  
  it('should show empty state when no sensors configured', () => {
    renderWithContext(<VibrationApp />, { vibrationState: {} });
    expect(screen.getByText(/No vibration sensors configured/)).toBeInTheDocument();
  });
  
  it('should render equipment cards when sensors present', () => {
    renderWithContext(<VibrationApp />, { vibrationState: mockVibrationState });
    expect(screen.getByText('Punching Bag')).toBeInTheDocument();
  });
  
  it('should show active pulse when vibration detected', () => {
    renderWithContext(<VibrationApp />, { vibrationState: mockVibrationState });
    const card = screen.getByText('Punching Bag').closest('.vibration-card');
    expect(card).toHaveClass('vibration-card--active');
  });
  
  it('should display battery warning when battery low', () => {
    const lowBatteryState = {
      ...mockVibrationState,
      punching_bag: { ...mockVibrationState.punching_bag, batteryLow: true, battery: 10 }
    };
    renderWithContext(<VibrationApp />, { vibrationState: lowBatteryState });
    expect(screen.getByText('🔋 10%').closest('.vibration-card__battery')).toHaveClass('vibration-card__battery--low');
  });
});
```

**File:** `frontend/src/context/__tests__/FitnessContext.vibration.test.jsx`

```javascript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { calculateIntensity } from '../FitnessContext';

describe('FitnessContext vibration utilities', () => {
  describe('calculateIntensity', () => {
    it('should calculate magnitude correctly', () => {
      // √(3² + 4² + 0²) = 5
      expect(calculateIntensity(3, 4, 0)).toBe(5);
    });
    
    it('should return 0 for null axes', () => {
      expect(calculateIntensity(null, 5, 5)).toBe(0);
      expect(calculateIntensity(5, null, 5)).toBe(0);
      expect(calculateIntensity(5, 5, null)).toBe(0);
    });
    
    it('should handle negative values', () => {
      // √((-3)² + (-4)² + 0²) = 5
      expect(calculateIntensity(-3, -4, 0)).toBe(5);
    });
  });
});
```

### Integration Tests

**File:** `backend/tests/mqtt.integration.test.mjs`

```javascript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock mqtt module before importing mqtt.mjs
vi.mock('mqtt', () => {
  const EventEmitter = require('events');
  const mockClient = new EventEmitter();
  mockClient.subscribe = vi.fn((topic, cb) => cb(null));
  mockClient.end = vi.fn();
  mockClient.connected = true;
  
  return {
    connect: vi.fn(() => mockClient),
    __mockClient: mockClient
  };
});

import mqtt from 'mqtt';
import { initMqttSubscriber, closeMqttConnection, getMqttStatus } from '../lib/mqtt.mjs';
import * as websocket from '../routers/websocket.mjs';

vi.mock('../routers/websocket.mjs', () => ({
  broadcastToWebsockets: vi.fn()
}));

describe('MQTT Integration', () => {
  const mockEquipment = [{
    id: 'test_bag',
    name: 'Test Bag',
    type: 'punching_bag',
    sensor: { type: 'vibration', mqtt_topic: 'test/sensor' },
    thresholds: { low: 5, medium: 15, high: 30 }
  }];
  
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.mqtt = { host: 'localhost', port: 1883 };
  });
  
  afterEach(() => {
    closeMqttConnection();
  });
  
  it('should broadcast valid vibration events to WebSocket', async () => {
    initMqttSubscriber(mockEquipment);
    const mockClient = mqtt.__mockClient;
    
    // Simulate connection
    mockClient.emit('connect');
    
    // Simulate incoming message
    const payload = JSON.stringify({
      vibration: true,
      x_axis: 10,
      y_axis: 5,
      z_axis: 8,
      battery: 90
    });
    
    mockClient.emit('message', 'test/sensor', Buffer.from(payload));
    
    expect(websocket.broadcastToWebsockets).toHaveBeenCalledWith(
      expect.objectContaining({
        topic: 'vibration',
        equipmentId: 'test_bag',
        data: expect.objectContaining({ vibration: true })
      })
    );
  });
  
  it('should NOT broadcast invalid payloads', async () => {
    initMqttSubscriber(mockEquipment);
    const mockClient = mqtt.__mockClient;
    mockClient.emit('connect');
    
    // Invalid JSON
    mockClient.emit('message', 'test/sensor', Buffer.from('not json'));
    expect(websocket.broadcastToWebsockets).not.toHaveBeenCalled();
    
    // Invalid schema
    mockClient.emit('message', 'test/sensor', Buffer.from('{"vibration":"yes"}'));
    expect(websocket.broadcastToWebsockets).not.toHaveBeenCalled();
  });
  
  it('should throttle rapid messages', async () => {
    initMqttSubscriber(mockEquipment);
    const mockClient = mqtt.__mockClient;
    mockClient.emit('connect');
    
    const payload = JSON.stringify({ vibration: true, x_axis: 1, y_axis: 1, z_axis: 1 });
    
    // Fire 10 messages rapidly
    for (let i = 0; i < 10; i++) {
      mockClient.emit('message', 'test/sensor', Buffer.from(payload));
    }
    
    // Should only broadcast once due to throttling
    expect(websocket.broadcastToWebsockets).toHaveBeenCalledTimes(1);
  });
  
  it('should report status via getMqttStatus', () => {
    initMqttSubscriber(mockEquipment);
    mqtt.__mockClient.emit('connect');
    
    const status = getMqttStatus();
    expect(status.connected).toBe(true);
    expect(status.sensorCount).toBe(1);
    expect(status.topics).toContain('test/sensor');
  });
});
```

### Manual Testing Checklist

| Test Case | Steps | Expected Result |
|-----------|-------|-----------------|
| MQTT Connection | Start backend, check logs | `mqtt.connected` log message |
| MQTT Reconnection | Stop mosquitto, wait 5s, restart | Auto-reconnect with backoff logs |
| Valid Vibration | Hit punching bag | Visual pulse, intensity bar fills |
| Invalid Payload | Publish malformed JSON to topic | No crash, warning logged |
| High Frequency | Shake sensor rapidly | UI updates smoothly (throttled) |
| Multiple Equipment | Hit bag then step platform | Both cards update independently |
| Battery Warning | Set battery < 20% via simulator | Red battery indicator |
| WebSocket Disconnect | Stop backend, restart | Frontend reconnects, state resumes |
| Memory (5 min soak) | Leave running with simulator | No memory growth in Chrome DevTools |

### MQTT Testing (CLI)

```bash
# Subscribe to sensor topics
ssh homeserver.local 'docker exec mosquitto mosquitto_sub -h localhost -t "zigbee2mqtt-usb/Garage Punching Bag Vibration Sensor" -v'

# Publish valid test message
ssh homeserver.local 'docker exec mosquitto mosquitto_pub -h localhost -t "zigbee2mqtt-usb/Garage Punching Bag Vibration Sensor" -m "{\"vibration\":true,\"x_axis\":10,\"y_axis\":5,\"z_axis\":15,\"battery\":85}"'

# Publish invalid message (should be rejected)
ssh homeserver.local 'docker exec mosquitto mosquitto_pub -h localhost -t "zigbee2mqtt-usb/Garage Punching Bag Vibration Sensor" -m "{\"vibration\":\"yes\"}"'
```

## Security Considerations

### Assumptions

> ⚠️ **CRITICAL**: This implementation assumes MQTT broker is accessible only from trusted networks.

| Assumption | Risk if Violated | Mitigation |
|------------|------------------|------------|
| MQTT broker is on internal network | Unauthorized sensor data injection | Add MQTT auth, TLS |
| Docker network `{local-network}` is isolated | Container escape could access MQTT | Network policies, firewall |
| Dev machine is trusted | Dev config exposes homeserver.local | VPN for remote dev |

### What's NOT Protected

- **No MQTT authentication**: Anyone on `{local-network}` can publish to sensor topics
- **No TLS encryption**: MQTT traffic is plaintext
- **No message signing**: Cannot verify messages are from real sensors

### Future Security Hardening

1. Enable MQTT username/password authentication
2. Add TLS for MQTT connections (port 8883)
3. Implement message signing with sensor-specific keys
4. Add rate limiting at MQTT broker level
5. Log and alert on anomalous publish patterns

---

## Phased Implementation Plan

### Phase 1: Foundation (Backend MQTT) — 2-3 hours

**Goal**: Establish MQTT connectivity and WebSocket broadcast pipeline.

**Deliverables**:
- [ ] Create `backend/lib/mqtt.constants.mjs` with all constants
- [ ] Create `backend/lib/mqtt.mjs` with full implementation
- [ ] Add `mqtt` dependency to `backend/package.json`
- [ ] Add MQTT config to `config/config.app.yml` and `config/config.app-local.yml`
- [ ] Initialize MQTT subscriber in `backend/api.mjs`
- [ ] Write unit tests for `buildSensorTopicMap` and `validateVibrationPayload`

**Verification**:
```bash
# Start backend, check logs for:
# - mqtt.initializing
# - mqtt.connected
# - mqtt.subscribed (for each topic)

# Publish test message via CLI, verify log shows:
# - mqtt.vibration.detected
```

**Exit Criteria**: Backend receives MQTT messages and logs them. No frontend changes yet.

---

### Phase 2: Frontend Context (State Management) — 2 hours

**Goal**: Wire WebSocket vibration events into React state with proper cleanup.

**Deliverables**:
- [ ] Create `frontend/src/modules/Fitness/FitnessPlugins/plugins/VibrationApp/constants.js`
- [ ] Add `vibrationState` and `vibrationTimeoutRefs` to `FitnessContext.jsx`
- [ ] Implement `handleVibrationEvent` with debounce token logic
- [ ] Add cleanup effect for timeouts on unmount
- [ ] Export `getEquipmentVibration` helper from context
- [ ] Write unit tests for `calculateIntensity`

**Verification**:
```javascript
// In browser console while connected to fitness app:
// Trigger test MQTT message, verify:
console.log(fitnessContext.vibrationState);
// Should show equipment entry with vibration: true, then false after 500ms
```

**Exit Criteria**: `vibrationState` updates correctly on WebSocket messages. No UI yet.

---

### Phase 3: Basic UI (VibrationApp Plugin) — 3-4 hours

**Goal**: Render equipment cards with real-time vibration feedback.

**Deliverables**:
- [ ] Create `VibrationApp/manifest.js`
- [ ] Create `VibrationApp/VibrationApp.jsx` (main component + VibrationCard)
- [ ] Create `VibrationApp/VibrationApp.scss` (cards, pulse animation)
- [ ] Create `VibrationApp/index.jsx` (exports)
- [ ] Register plugin in `FitnessPlugins/registry.js`
- [ ] Write component tests for loading/empty/active states

**Verification**:
1. Open Fitness app → Plugin menu → Launch "Vibration Monitor"
2. Should show "Connecting..." then equipment cards
3. Hit punching bag → card pulses green/orange/red based on intensity

**Exit Criteria**: Basic visualization works. No axis bars or timeline yet.

---

### Phase 4: Enhanced Visualization — 2-3 hours

**Goal**: Add axis bars, direction indicators, and activity timeline.

**Deliverables**:
- [ ] Implement `AxisBar` component with bidirectional fill
- [ ] Implement `DirectionIndicator` component
- [ ] Implement `ActivityTimeline` component with event tracking
- [ ] Add remaining SCSS for axis bars, direction, timeline dots
- [ ] Add `prefers-reduced-motion` support

**Verification**:
1. Hit bag at angle → see X/Y/Z bars move, direction indicator shows "Left Hook" etc.
2. Multiple hits → timeline dots appear and fade over 30s
3. Enable reduced motion in OS → animations stop

**Exit Criteria**: Full visualization complete with accessibility support.

---

### Phase 5: Configuration & Equipment Registry — 1-2 hours

**Goal**: Configure real sensors in fitness.yml.

**Deliverables**:
- [ ] Add equipment entries to `config/apps/fitness.yml` for:
  - Punching bag sensor
  - Step platform sensor
- [ ] Verify topic names match Zigbee2MQTT exactly
- [ ] Test with real sensors (if available) or simulator

**Verification**:
```bash
# Run simulator
cd _extentions/fitness
node vibration-simulation.mjs demo

# Frontend should show both equipment cards responding
```

**Exit Criteria**: Real or simulated sensors appear in UI correctly.

---

### Phase 6: Simulator — 1-2 hours

**Goal**: Create vibration simulator for testing without hardware.

**Deliverables**:
- [ ] Create `_extentions/fitness/vibration-simulation.mjs`
- [ ] Implement random, workout, and demo modes
- [ ] Test all three modes produce expected UI behavior

**Verification**:
```bash
node vibration-simulation.mjs workout
# Watch UI: warmup (sparse hits) → active (frequent) → cooldown (sparse)
```

**Exit Criteria**: Simulator provides reliable test data for all scenarios.

---

### Phase 7: Integration Tests & Hardening — 2-3 hours

**Goal**: Ensure production reliability.

**Deliverables**:
- [ ] Write integration tests with mocked MQTT client
- [ ] Test reconnection by stopping/starting mosquitto
- [ ] Test invalid payload rejection
- [ ] Test throttling under rapid-fire events
- [ ] 5-minute soak test monitoring memory in Chrome DevTools
- [ ] Add `getMqttStatus()` endpoint for health checks (optional)

**Verification**:
- All tests pass
- No memory growth during soak test
- Reconnection works within 30s of broker restart

**Exit Criteria**: Feature is production-ready.

---

### Phase 8: Documentation & Deploy — 1 hour

**Goal**: Ship it.

**Deliverables**:
- [ ] Update this PRD with any implementation deviations
- [ ] Add inline code comments where non-obvious
- [ ] Manual smoke test in prod environment
- [ ] Deploy via `./deploy.sh`
- [ ] Monitor logs for 24 hours

**Verification**:
```bash
ssh homeserver.local 'docker logs daylight-station -f' | grep mqtt
# Should see healthy connect/subscribe logs, no errors
```

**Exit Criteria**: Feature live in production, monitoring confirms stability.

---

### Timeline Summary

| Phase | Effort | Cumulative |
|-------|--------|------------|
| 1. Foundation | 2-3h | 2-3h |
| 2. Frontend Context | 2h | 4-5h |
| 3. Basic UI | 3-4h | 7-9h |
| 4. Enhanced Viz | 2-3h | 9-12h |
| 5. Config | 1-2h | 10-14h |
| 6. Simulator | 1-2h | 11-16h |
| 7. Testing | 2-3h | 13-19h |
| 8. Deploy | 1h | **14-20h total** |

**Estimated Total**: 2-3 working days

### Dependencies & Blockers

| Dependency | Blocker? | Mitigation |
|------------|----------|------------|
| Mosquitto MQTT broker running | Yes | Already deployed on homeserver |
| Zigbee2MQTT configured | Yes | Already configured for other sensors |
| Physical sensors available | No | Use simulator for development |
| `mqtt` npm package | No | Standard package, no approval needed |

### Rollback Plan

If issues arise in production:

1. **Quick disable**: Comment out `initMqttSubscriber()` call in `api.mjs`, redeploy
2. **Frontend graceful degradation**: Plugin shows "No sensors" if backend not broadcasting
3. **Full rollback**: Revert commits, redeploy previous version

Feature is additive and isolated — no risk to existing functionality.
