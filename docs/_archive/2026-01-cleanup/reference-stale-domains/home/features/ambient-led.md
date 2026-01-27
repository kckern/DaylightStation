# Ambient LED Fitness Zone Configuration Guide

This guide documents the configuration options for the Ambient LED feature, which syncs fitness heart rate zones with Home Assistant-controlled LED lights.

## Quick Start

Add the following to your household's fitness config (`data/households/{household_id}/apps/fitness/config.yml`):

```yaml
ambient_led:
  scenes:
    off: garage_led_off
    cool: garage_led_blue
    active: garage_led_green
    warm: garage_led_yellow
    hot: garage_led_orange
    fire: garage_led_red
    fire_all: garage_led_red_breathe
  throttle_ms: 2000
```

## Configuration Reference

### `ambient_led` Section

| Option | Type | Required | Default | Description |
|--------|------|----------|---------|-------------|
| `scenes` | object | Yes | - | Maps zone names to Home Assistant scene entity names |
| `throttle_ms` | number | No | 2000 | Minimum milliseconds between HA scene activations |

### `scenes` Object

| Key | Required | Description |
|-----|----------|-------------|
| `off` | **Yes** | Scene to activate when session ends or no active participants |
| `cool` | No | Scene for cool zone (<60% max HR) |
| `active` | No | Scene for active zone (60-70% max HR) |
| `warm` | No | Scene for warm zone (70-80% max HR) |
| `hot` | No | Scene for hot zone (80-90% max HR) |
| `fire` | No | Scene for fire zone (90%+ max HR) |
| `fire_all` | No | Scene when ALL active participants are in fire zone |

**Note:** The `off` scene is required. If other scenes are missing, they fall back to the next lower zone, ultimately to `off`.

### Scene Fallback Chain

When a zone scene is not configured, the system falls back through this chain:

```
fire_all → fire → hot → warm → active → cool → off
```

Example: If you only configure `off` and `fire`:
- cool, active, warm, hot zones → `off` scene
- fire zone → `fire` scene
- all-fire condition → `fire` scene (since `fire_all` not configured)

## Zone Mapping

| Zone | Heart Rate | LED Color | Trigger |
|------|------------|-----------|---------|
| Off | - | Off | Session ended or no active participants |
| Cool | <60% | Blue | Recovery, warmup |
| Active | 60-70% | Green | Fat burn zone |
| Warm | 70-80% | Yellow | Cardio zone |
| Hot | 80-90% | Orange | Threshold zone |
| Fire | 90%+ | Red | Max effort |
| Fire All | All users 90%+ | Red (breathing) | Special effect when everyone is maxed |

## Multi-User Behavior

When multiple users are active:
- **Max Zone Wins**: The highest zone among all active participants is displayed
- **All-Fire Special**: When every active participant is in the fire zone, triggers the breathing effect

Example with 3 users:
- User A: warm (70%)
- User B: hot (85%)
- User C: cool (55%)
- **Result**: Orange LED (hot zone - the maximum)

## Feature Toggle

The feature is automatically **disabled** if:
- `ambient_led` section is missing from config
- `ambient_led.scenes` is missing or empty
- `ambient_led.scenes.off` is not configured

This makes it safe to deploy to households without Home Assistant integration.

## Home Assistant Requirements

### Scene Setup

Create scenes in Home Assistant for each LED state. Example `scenes.yaml`:

```yaml
- name: "Garage LED Off"
  entities:
    light.garage_led_strip:
      state: "off"

- name: "Garage LED Blue"
  entities:
    light.garage_led_strip:
      state: "on"
      brightness: 255
      rgb_color: [0, 100, 255]

- name: "Garage LED Green"
  entities:
    light.garage_led_strip:
      state: "on"
      brightness: 255
      rgb_color: [0, 255, 100]

- name: "Garage LED Yellow"
  entities:
    light.garage_led_strip:
      state: "on"
      brightness: 255
      rgb_color: [255, 255, 0]

- name: "Garage LED Orange"
  entities:
    light.garage_led_strip:
      state: "on"
      brightness: 255
      rgb_color: [255, 150, 0]

- name: "Garage LED Red"
  entities:
    light.garage_led_strip:
      state: "on"
      brightness: 255
      rgb_color: [255, 0, 0]

- name: "Garage LED Red Breathe"
  entities:
    light.garage_led_strip:
      state: "on"
      brightness: 255
      rgb_color: [255, 0, 0]
      effect: "Breathe"
```

### Environment Variables

Ensure these are set in your DaylightStation environment:

```yaml
HOME_ASSISTANT_TOKEN: "your_long_lived_access_token"
home_assistant:
  host: "http://homeassistant.local"
  port: 8123
```

## API Endpoints

### Check Status
```bash
GET /fitness/zone_led/status?householdId=default
```

Response:
```json
{
  "enabled": true,
  "scenes": { "off": "garage_led_off", ... },
  "throttleMs": 2000,
  "state": {
    "lastScene": "garage_led_yellow",
    "lastActivatedAt": 1735123456789,
    "failureCount": 0,
    "backoffUntil": 0,
    "isInBackoff": false
  }
}
```

### View Metrics
```bash
GET /fitness/zone_led/metrics
```

Response:
```json
{
  "uptime": { "ms": 3600000, "formatted": "1h 0m" },
  "totals": {
    "requests": 150,
    "activated": 45,
    "failures": 0
  },
  "skipped": {
    "duplicate": 80,
    "rateLimited": 25
  },
  "sceneHistogram": {
    "garage_led_blue": 10,
    "garage_led_yellow": 20
  }
}
```

### Reset Circuit Breaker
```bash
POST /fitness/zone_led/reset
```

Use this after fixing Home Assistant connectivity issues.

## Example Configurations

### Minimal (Only On/Off)
```yaml
ambient_led:
  scenes:
    off: led_strip_off
    fire: led_strip_red
```

### Full Color Gradient
```yaml
ambient_led:
  scenes:
    off: fitness_led_off
    cool: fitness_led_blue
    active: fitness_led_green
    warm: fitness_led_yellow
    hot: fitness_led_orange
    fire: fitness_led_red
    fire_all: fitness_led_rainbow
  throttle_ms: 1500
```

### Multiple Light Groups
```yaml
# Use scenes that control multiple lights
ambient_led:
  scenes:
    off: gym_lights_off
    cool: gym_lights_cool
    active: gym_lights_active
    warm: gym_lights_warm
    hot: gym_lights_hot
    fire: gym_lights_fire
    fire_all: gym_lights_party_mode
```

## Related Documentation

- [Ambient LED Fitness Zones PRD](./ambient-led-fitness-zones-prd.md)
- [Troubleshooting Guide](./ambient-led-troubleshooting.md)
- [Home Assistant API Reference](https://developers.home-assistant.io/docs/api/rest/)
# Product Requirements Document: Ambient LED Fitness Zone Indicator

## 1. Executive Summary

### 1.1 Overview
This feature integrates the DaylightStation fitness tracking system with Home Assistant-controlled garage LED lights. The LEDs will dynamically change colors to reflect the **maximum heart rate zone** among all active workout participants, providing real-time visual feedback that extends the fitness experience beyond the screen.

### 1.2 User Story
> *As a fitness session participant, I want the garage LEDs to reflect my workout intensity so that I have ambient environmental feedback on my effort level, even when not looking at the screen.*

### 1.3 Scenes Mapping
| Scene Name | Zone | Trigger Condition |
|------------|------|-------------------|
| `ambient_led_off` | None | Session ended or no active participants |
| `ambient_led_blue` | Cool | Max zone = cool (recovery, <60% HR) |
| `ambient_led_green` | Active | Max zone = active (fat burn, 60-70% HR) |
| `ambient_led_yellow` | Warm | Max zone = warm (cardio, 70-80% HR) |
| `ambient_led_orange` | Hot | Max zone = hot (threshold, 80-90% HR) |
| `ambient_led_red` | Fire | Max zone = fire (max effort, 90%+ HR) |
| `ambient_led_red_breathe` | Fire (ALL) | **ALL** active users are in fire zone |

---

## 2. Technical Architecture

### 2.1 System Components

```
┌─────────────────────────────────────────────────────────────────────────┐
│                           FRONTEND (React)                              │
├─────────────────────────────────────────────────────────────────────────┤
│  FitnessContext.jsx                                                     │
│    ├── participantRoster (zoneId, zoneColor for each user)              │
│    ├── zoneRankMap (zone ordering: cool < active < warm < hot)          │
│    └── onSessionEnded callback                                          │
│                                                                         │
│  FitnessSession.js                                                      │
│    ├── roster getter → [{name, zoneId, zoneColor, isActive}]            │
│    ├── endSession(reason) → triggers cleanup                            │
│    └── _collectTimelineTick() → called every 5s                         │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    │ HTTP POST (throttled)
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                           BACKEND (Node.js)                             │
├─────────────────────────────────────────────────────────────────────────┤
│  fitness.mjs (fitnessRouter)                                            │
│    └── POST /fitness/zone_led                                           │
│          ├── Receives: { zones: [{zoneId, isActive}], sessionEnded }    │
│          ├── Computes max zone across active users                      │
│          ├── Detects "all hot" condition                                │
│          ├── Applies rate limiting & deduplication                      │
│          └── Calls HomeAssistant.activateScene()                        │
│                                                                         │
│  lib/homeassistant.mjs (extended)                                       │
│    └── activateScene(sceneName) → POST /api/services/scene/turn_on      │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    │ REST API
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                         HOME ASSISTANT                                  │
├─────────────────────────────────────────────────────────────────────────┤
│  Scenes:                                                                │
│    scene.ambient_led_off                                                 │
│    scene.ambient_led_blue                                                │
│    scene.ambient_led_green                                               │
│    scene.ambient_led_yellow                                              │
│    scene.ambient_led_orange                                              │
│    scene.ambient_led_red                                                 │
│    scene.ambient_led_red_breathe                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### 2.2 Data Flow

1. **Frontend** collects zone data from `participantRoster` every tick (~5s)
2. **Frontend** sends zone summary to backend via throttled HTTP POST
3. **Backend** computes the target scene based on zone logic
4. **Backend** rate-limits and deduplicates HA calls (no repeated scene activations)
5. **Home Assistant** activates the appropriate LED scene

---

## 3. Detailed Design

### 3.1 Zone Hierarchy & Scene Resolution

The zone configuration follows this precedence (from existing `ZONE_SYMBOL_MAP`):

```javascript
const ZONE_PRIORITY = {
  cool: 0,    // Blue LED
  active: 1,  // Green LED
  warm: 2,    // Yellow LED
  hot: 3,     // Orange LED
  fire: 4     // Red / Red-Breathe LED
};
```

**Scene Selection Logic:**

```javascript
function resolveScene(participants) {
  // Filter to only active participants (isActive === true)
  const active = participants.filter(p => p.isActive);
  
  if (active.length === 0) {
    return 'ambient_led_off'; // No active participants
  }
  
  const zones = active.map(p => normalizeZoneId(p.zoneId)).filter(Boolean);
  
  if (zones.length === 0) {
    return 'ambient_led_blue'; // Fallback: no zone data
  }
  
  const maxZone = zones.reduce((max, zone) => 
    ZONE_PRIORITY[zone] > ZONE_PRIORITY[max] ? zone : max
  , 'cool');
  
  // Special case: ALL users in fire zone → breathing red
  const allFire = zones.length > 0 && zones.every(z => z === 'fire');
  
  switch (maxZone) {
    case 'cool':   return 'ambient_led_blue';
    case 'active': return 'ambient_led_green';
    case 'warm':   return 'ambient_led_yellow';
    case 'hot':    return 'ambient_led_orange';
    case 'fire':   return allFire ? 'ambient_led_red_breathe' : 'ambient_led_red';
    default:       return 'ambient_led_blue';
  }
}
```

### 3.2 Frontend Implementation

#### 3.2.1 Zone LED Hook (New: `useZoneLedSync.js`)

```javascript
// frontend/src/hooks/fitness/useZoneLedSync.js
import { useRef, useCallback, useEffect } from 'react';
import { DaylightAPI } from '../../lib/api.mjs';

const THROTTLE_MS = 5000; // Minimum interval between LED updates
const DEBOUNCE_MS = 1000; // Wait for zone stability before sending

export function useZoneLedSync({ 
  participantRoster, 
  sessionActive, 
  enabled = false,  // Default to disabled - requires explicit config
  householdId = null
}) {
  const lastSentRef = useRef(null);
  const lastSceneRef = useRef(null);
  const throttleTimerRef = useRef(null);
  const debounceTimerRef = useRef(null);

  const sendZoneUpdate = useCallback(async (zones, sessionEnded = false) => {
    if (!enabled) return;
    
    try {
      await DaylightAPI.post('/fitness/zone_led', {
        zones,
        sessionEnded,
        householdId,
        timestamp: Date.now()
      });
    } catch (err) {
      console.warn('[ZoneLED] Failed to update:', err.message);
    }
  }, [enabled, householdId]);

  // ... throttling/debouncing logic
}
```

#### 3.2.2 Integration Point in `FitnessContext.jsx`

```javascript
// In FitnessProvider, after participantRoster is computed:
const zoneLedPayload = React.useMemo(() => {
  return participantRoster.map(p => ({
    zoneId: p.zoneId || null,
    isActive: p.isActive ?? true
  }));
}, [participantRoster]);

// Hook integration - only enabled if ambient_led.scenes is configured
const garageLedEnabled = React.useMemo(() => {
  const scenes = fitnessRoot?.ambient_led?.scenes;
  return scenes && typeof scenes === 'object' && !!scenes.off;
}, [fitnessRoot]);

useZoneLedSync({
  participantRoster: zoneLedPayload,
  sessionActive: !!session.sessionId,
  enabled: garageLedEnabled,
  householdId: fitnessRoot?._household
});

// Session end handler
useEffect(() => {
  if (!garageLedEnabled) return;
  
  const unsubscribe = session.onSessionEnded((sessionId, reason) => {
    // Send immediate LED-off command
    DaylightAPI.post('/fitness/zone_led', { 
      sessionEnded: true,
      householdId: fitnessRoot?._household
    });
  });
  return unsubscribe;
}, [session, garageLedEnabled, fitnessRoot?._household]);
```

### 3.3 Backend Implementation

#### 3.3.1 New Endpoint in `fitness.mjs`

```javascript
// backend/fitness.mjs

import { activateScene, getSceneState } from './lib/homeassistant.mjs';
import { createLogger } from './lib/logging/logger.js';

const fitnessLogger = createLogger({ source: 'backend', app: 'fitness' });

// Rate limiting state
const zoneLedState = {
  lastScene: null,
  lastActivatedAt: 0,
  minIntervalMs: 2000,  // Don't call HA more than once per 2s
  failureCount: 0,
  maxFailures: 5,
  backoffUntil: 0
};

// Zone priority (hardcoded - defines zone ordering)
const ZONE_PRIORITY = { cool: 0, active: 1, warm: 2, hot: 3, fire: 4 };
const ZONE_ORDER = ['cool', 'active', 'warm', 'hot', 'fire']; // For fallback resolution

function normalizeZoneId(zoneId) {
  if (!zoneId) return null;
  const lower = String(zoneId).toLowerCase().trim();
  return ['cool', 'active', 'warm', 'hot', 'fire'].includes(lower) ? lower : null;
}

/**
 * Resolve the target HA scene name from config
 * @param {object} sceneConfig - The ambient_led.scenes config object
 * @param {string} zoneKey - Zone key: 'off', 'cool', 'active', 'warm', 'hot', 'fire', 'fire_all'
 * @returns {string|null} Scene name or null if not configured
 */
function resolveSceneFromConfig(sceneConfig, zoneKey) {
  if (!sceneConfig || typeof sceneConfig !== 'object') return null;
  
  // Direct lookup
  if (sceneConfig[zoneKey]) return sceneConfig[zoneKey];
  
  // Fallback chain for missing zone scenes
  if (zoneKey === 'fire_all') return sceneConfig.fire || sceneConfig.off || null;
  
  const zoneIndex = ZONE_ORDER.indexOf(zoneKey);
  if (zoneIndex > 0) {
    // Fall back to next lower zone
    for (let i = zoneIndex - 1; i >= 0; i--) {
      if (sceneConfig[ZONE_ORDER[i]]) return sceneConfig[ZONE_ORDER[i]];
    }
  }
  
  return sceneConfig.off || null;
}

/**
 * Check if garage LED feature is enabled based on config
 * @param {object} fitnessConfig - The full fitness config
 * @returns {boolean}
 */
function isGarageLedEnabled(fitnessConfig) {
  const garageLed = fitnessConfig?.ambient_led;
  if (!garageLed) return false;
  
  const scenes = garageLed.scenes;
  if (!scenes || typeof scenes !== 'object') return false;
  if (!scenes.off) return false; // 'off' scene is required
  
  return true;
}

function resolveTargetScene(zones, sessionEnded, sceneConfig) {
  if (!sceneConfig) return null;
  
  if (sessionEnded) return resolveSceneFromConfig(sceneConfig, 'off');
  
  const activeZones = zones
    .filter(z => z.isActive !== false)
    .map(z => normalizeZoneId(z.zoneId))
    .filter(Boolean);
  
  if (activeZones.length === 0) return resolveSceneFromConfig(sceneConfig, 'off');
  
  const maxZone = activeZones.reduce((max, zone) =>
    ZONE_PRIORITY[zone] > ZONE_PRIORITY[max] ? zone : max
  , 'cool');
  
  // Special case: ALL users in fire zone
  if (maxZone === 'fire' && activeZones.every(z => z === 'fire')) {
    return resolveSceneFromConfig(sceneConfig, 'fire_all');
  }
  
  return resolveSceneFromConfig(sceneConfig, maxZone);
}

fitnessRouter.post('/zone_led', async (req, res) => {
  try {
    const { zones = [], sessionEnded = false, householdId } = req.body;
    const now = Date.now();
    
    // Load fitness config for this household
    const fitnessConfig = loadFitnessConfig(householdId);
    
    // Check if feature is enabled
    if (!isGarageLedEnabled(fitnessConfig)) {
      return res.json({ 
        ok: true, 
        skipped: true, 
        reason: 'feature_disabled',
        message: 'ambient_led not configured or missing required scenes'
      });
    }
    
    const sceneConfig = fitnessConfig.ambient_led.scenes;
    const throttleMs = fitnessConfig.ambient_led.throttle_ms || 2000;
    
    // Circuit breaker: if too many failures, wait before retrying
    if (zoneLedState.backoffUntil > now) {
      fitnessLogger.warn('fitness.zone_led.backoff', {
        remainingMs: zoneLedState.backoffUntil - now
      });
      return res.json({ 
        ok: true, 
        skipped: true, 
        reason: 'backoff',
        scene: zoneLedState.lastScene 
      });
    }
    
    const targetScene = resolveTargetScene(zones, sessionEnded, sceneConfig);
    
    if (!targetScene) {
      return res.json({ 
        ok: true, 
        skipped: true, 
        reason: 'no_scene_configured',
        message: 'No scene configured for resolved zone'
      });
    }
    
    // Deduplication: skip if same scene
    if (targetScene === zoneLedState.lastScene) {
      return res.json({ 
        ok: true, 
        skipped: true, 
        reason: 'duplicate',
        scene: targetScene 
      });
    }
    
    // Rate limiting: minimum interval between calls (use config or default)
    const elapsed = now - zoneLedState.lastActivatedAt;
    if (elapsed < throttleMs && !sessionEnded) {
      return res.json({ 
        ok: true, 
        skipped: true, 
        reason: 'rate_limited',
        scene: zoneLedState.lastScene 
      });
    }
    
    // Activate scene via Home Assistant
    const result = await activateScene(targetScene);
    
    if (result.ok) {
      zoneLedState.lastScene = targetScene;
      zoneLedState.lastActivatedAt = now;
      zoneLedState.failureCount = 0;
      
      fitnessLogger.info('fitness.zone_led.activated', {
        scene: targetScene,
        activeCount: zones.filter(z => z.isActive !== false).length,
        sessionEnded
      });
      
      return res.json({ ok: true, scene: targetScene });
    } else {
      throw new Error(result.error || 'HA activation failed');
    }
    
  } catch (error) {
    zoneLedState.failureCount++;
    
    // Exponential backoff after repeated failures
    if (zoneLedState.failureCount >= zoneLedState.maxFailures) {
      const backoffMs = Math.min(60000, 1000 * Math.pow(2, zoneLedState.failureCount - zoneLedState.maxFailures));
      zoneLedState.backoffUntil = Date.now() + backoffMs;
      
      fitnessLogger.error('fitness.zone_led.circuit_open', {
        failureCount: zoneLedState.failureCount,
        backoffMs
      });
    }
    
    fitnessLogger.error('fitness.zone_led.failed', {
      error: error.message,
      failureCount: zoneLedState.failureCount
    });
    
    return res.status(500).json({ 
      ok: false, 
      error: error.message,
      failureCount: zoneLedState.failureCount 
    });
  }
});
```

#### 3.3.2 Extended `homeassistant.mjs`

```javascript
// backend/lib/homeassistant.mjs (additions)

/**
 * Activate a Home Assistant scene
 * @param {string} sceneName - Scene name (without 'scene.' prefix)
 * @returns {Promise<{ok: boolean, error?: string}>}
 */
export const activateScene = async (sceneName) => {
  const entityId = sceneName.startsWith('scene.') 
    ? sceneName 
    : `scene.${sceneName}`;
    
  const data = { entity_id: entityId };
  
  try {
    const result = await HomeAPI('services/scene/turn_on', data);
    return { ok: !!result };
  } catch (error) {
    return { ok: false, error: error.message };
  }
};

/**
 * Get current state of a scene entity
 * @param {string} sceneName - Scene name
 * @returns {Promise<{state: string, last_changed: string} | null>}
 */
export const getSceneState = async (sceneName) => {
  const entityId = sceneName.startsWith('scene.') 
    ? sceneName 
    : `scene.${sceneName}`;
    
  const { HOME_ASSISTANT_TOKEN, home_assistant: { host, port } } = process.env;
  const url = `${host}:${port}/api/states/${entityId}`;
  
  try {
    const response = await axios.get(url, {
      headers: {
        'Authorization': `Bearer ${HOME_ASSISTANT_TOKEN}`,
        'Content-Type': 'application/json'
      }
    });
    return response.data;
  } catch (error) {
    return null;
  }
};
```

---

## 4. Configuration

### 4.1 Fitness Config Extension

Add to household fitness config (`data/households/{hid}/apps/fitness/config.yml`):

```yaml
# -----------------------------------------------------------------------------
# Ambient LED (Home Assistant Scenes) - OPTIONAL
# -----------------------------------------------------------------------------
# Maps fitness zones to Home Assistant scene names
# If this section is omitted or scenes is empty, LED sync is completely disabled
ambient_led:
  scenes:
    off: ambient_led_off           # Required if ambient_led is enabled
    cool: ambient_led_blue         # Optional - falls back to 'off' if missing
    active: ambient_led_green
    warm: ambient_led_yellow
    hot: ambient_led_orange
    fire: ambient_led_red
    fire_all: ambient_led_red_breathe  # When ALL users in fire zone
  throttle_ms: 2000               # Optional - minimum ms between HA calls (default: 2000)
```

**Feature Toggle Logic:**
- If `ambient_led` section is missing → Feature disabled
- If `ambient_led.scenes` is missing or empty → Feature disabled
- If `ambient_led.scenes.off` is missing → Feature disabled (required for session end)
- Missing zone scenes → Fall back to next lower zone, ultimately to 'off'

### 4.2 Environment Variables

Existing HA config in `process.env` is reused:
- `HOME_ASSISTANT_TOKEN`
- `process.env.home_assistant.host`
- `process.env.home_assistant.port`

---

## 5. Error Handling & Resilience

### 5.1 Failure Scenarios

| Scenario | Handling |
|----------|----------|
| HA unreachable | Circuit breaker opens after 5 failures; exponential backoff up to 60s |
| Scene doesn't exist | Log error, return gracefully (don't crash workout) |
| Invalid zone data | Normalize/sanitize input; fallback to 'cool' zone |
| Network timeout | 5s timeout on HA calls; count as failure |
| Frontend disconnect | Backend ignores stale requests; session-end turns off LED |

### 5.2 Circuit Breaker Pattern

```javascript
const circuitBreaker = {
  state: 'closed',  // closed | open | half-open
  failures: 0,
  threshold: 5,
  resetTimeout: 30000,
  lastFailure: null,
  
  async call(fn) {
    if (this.state === 'open') {
      if (Date.now() - this.lastFailure > this.resetTimeout) {
        this.state = 'half-open';
      } else {
        throw new Error('Circuit breaker open');
      }
    }
    
    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure();
      throw error;
    }
  },
  
  onSuccess() {
    this.failures = 0;
    this.state = 'closed';
  },
  
  onFailure() {
    this.failures++;
    this.lastFailure = Date.now();
    if (this.failures >= this.threshold) {
      this.state = 'open';
    }
  }
};
```

### 5.3 Graceful Degradation

1. **LED failures NEVER interrupt workout** - logging only, no thrown errors
2. **Session end always attempts LED-off** - even if previous calls failed
3. **Frontend caches last known state** - UI feedback independent of HA success
4. **Backend tracks scene state** - avoids redundant calls on reconnect

---

## 6. Rate Limiting & Throttling

### 6.1 Multi-Layer Throttling

```
Frontend                    Backend                    Home Assistant
   │                           │                           │
   │ ──debounce 1s──►          │                           │
   │ ──throttle 5s──►          │                           │
   │                           │ ──dedupe same scene──►    │
   │                           │ ──min interval 2s──►      │
   │                           │                           │
```

### 6.2 Implementation Details

**Frontend:**
- Debounce: Wait 1s after last zone change before sending
- Throttle: Maximum 1 request per 5 seconds
- Skip: Don't send if session not active

**Backend:**
- Deduplication: Skip if target scene matches last activated scene
- Rate limit: Minimum 2s between HA calls (except session-end)
- Priority: Session-end always bypasses throttle

---

## 7. Testing Strategy

### 7.1 Unit Tests

```javascript
// backend/fitness.test.mjs

describe('Zone LED Resolution', () => {
  test('resolves cool zone to blue LED', () => {
    const zones = [{ zoneId: 'cool', isActive: true }];
    expect(resolveTargetScene(zones, false)).toBe('ambient_led_blue');
  });
  
  test('resolves max zone among multiple users', () => {
    const zones = [
      { zoneId: 'cool', isActive: true },
      { zoneId: 'warm', isActive: true },
      { zoneId: 'active', isActive: true }
    ];
    expect(resolveTargetScene(zones, false)).toBe('ambient_led_yellow');
  });
  
  test('hot zone triggers orange LED', () => {
    const zones = [{ zoneId: 'hot', isActive: true }];
    expect(resolveTargetScene(zones, false)).toBe('ambient_led_orange');
  });
  
  test('fire zone triggers red LED', () => {
    const zones = [
      { zoneId: 'fire', isActive: true },
      { zoneId: 'warm', isActive: true }
    ];
    expect(resolveTargetScene(zones, false)).toBe('ambient_led_red');
  });
  
  test('all-fire triggers breathing red', () => {
    const zones = [
      { zoneId: 'fire', isActive: true },
      { zoneId: 'fire', isActive: true }
    ];
    expect(resolveTargetScene(zones, false)).toBe('ambient_led_red_breathe');
  });
  
  test('session ended triggers off', () => {
    const zones = [{ zoneId: 'hot', isActive: true }];
    expect(resolveTargetScene(zones, true)).toBe('ambient_led_off');
  });
  
  test('inactive users excluded from max calculation', () => {
    const zones = [
      { zoneId: 'hot', isActive: false },  // Inactive
      { zoneId: 'cool', isActive: true }
    ];
    expect(resolveTargetScene(zones, false)).toBe('ambient_led_blue');
  });
});
```

### 7.2 Integration Tests

```javascript
describe('Zone LED API', () => {
  test('deduplicates repeated scene requests', async () => {
    // First request
    await request(app).post('/fitness/zone_led')
      .send({ zones: [{ zoneId: 'warm', isActive: true }] });
    
    // Second identical request should be skipped
    const res = await request(app).post('/fitness/zone_led')
      .send({ zones: [{ zoneId: 'warm', isActive: true }] });
    
    expect(res.body.skipped).toBe(true);
    expect(res.body.reason).toBe('duplicate');
  });
  
  test('rate limits rapid requests', async () => {
    await request(app).post('/fitness/zone_led')
      .send({ zones: [{ zoneId: 'cool', isActive: true }] });
    
    // Immediate different request
    const res = await request(app).post('/fitness/zone_led')
      .send({ zones: [{ zoneId: 'active', isActive: true }] });
    
    expect(res.body.skipped).toBe(true);
    expect(res.body.reason).toBe('rate_limited');
  });
});
```

### 7.3 Manual Testing Checklist

- [ ] Start session → LED stays off (no zone data yet)
- [ ] First HR reading in cool zone → Blue LED
- [ ] User enters warm zone → Yellow LED
- [ ] Second user joins in hot zone → Red LED (max zone)
- [ ] All users reach hot zone → Red breathing LED
- [ ] User drops out (inactive) → LED reflects remaining users
- [ ] All users drop out → LED off
- [ ] Session ends (manual) → LED off immediately
- [ ] Session ends (timeout) → LED off
- [ ] HA offline → LED updates silently fail; workout continues
- [ ] Rapid zone changes → Throttled to reasonable rate

---

## 8. Implementation Plan

### Phase 1: Backend Foundation (Day 1)
1. Extend `homeassistant.mjs` with `activateScene()` function
2. Add `/fitness/zone_led` endpoint to `fitness.mjs`
3. Implement zone resolution logic with tests
4. Add rate limiting and circuit breaker

### Phase 2: Frontend Integration (Day 2)
1. Create `useZoneLedSync` hook
2. Integrate with `FitnessContext.jsx`
3. Add session-end handler for LED-off
4. Add configuration toggle (optional disable)

### Phase 3: Testing & Hardening (Day 3)
1. Unit tests for zone resolution
2. Integration tests for API
3. Manual end-to-end testing with real HA
4. Error handling verification

### Phase 4: Polish & Documentation (Day 4)
1. Add metrics/logging for observability
2. Update household config schema
3. Document configuration options
4. Create troubleshooting guide

---

## 9. Future Considerations

### 9.1 Potential Enhancements
- **Per-user LED strips**: Different LED zones for different participants
- **Transition animations**: Smooth color fades between zones
- **Achievement flashes**: Brief pulse when user hits target zone
- **Music sync**: LED patterns synchronized with workout music BPM
- **Rest interval dimming**: Lower brightness during rest periods

### 9.2 Alternative Architectures
- **WebSocket direct to HA**: Skip HTTP for lower latency (complex)
- **HA Automation trigger**: Backend triggers HA automation instead of scene (more flexible)
- **MQTT bridge**: Publish zone data to MQTT for HA subscription (decoupled)

---

## 10. Appendix

### 10.1 Home Assistant Scene API Reference

**Activate Scene:**
```bash
POST /api/services/scene/turn_on
Content-Type: application/json
Authorization: Bearer <token>

{
  "entity_id": "scene.ambient_led_blue"
}
```

**Get Scene State:**
```bash
GET /api/states/scene.ambient_led_blue
Authorization: Bearer <token>

# Response:
{
  "entity_id": "scene.ambient_led_blue",
  "state": "scening",
  "last_changed": "2025-12-25T10:30:00Z",
  "last_updated": "2025-12-25T10:30:00Z"
}
```

### 10.2 Zone Color Mapping Reference

| Zone | HR % of Max | Scene | LED Color | Notes |
|------|-------------|-------|-----------|-------|
| Cool | < 60% | `ambient_led_blue` | Blue | Recovery/warmup |
| Active | 60-70% | `ambient_led_green` | Green | Fat burn zone |
| Warm | 70-80% | `ambient_led_yellow` | Yellow | Cardio zone |
| Hot | 80-90% | `ambient_led_orange` | Orange | Threshold zone |
| Fire | 90%+ | `ambient_led_red` | Red | Max effort (VO2 max) |
| Fire (all) | All 90%+ | `ambient_led_red_breathe` | Red (breathing) | ALL users at max effort |

### 10.3 Logging Events

| Event | Level | Payload |
|-------|-------|---------|
| `fitness.zone_led.activated` | INFO | scene, activeCount, sessionEnded |
| `fitness.zone_led.skipped` | DEBUG | reason, scene |
| `fitness.zone_led.failed` | ERROR | error, failureCount |
| `fitness.zone_led.circuit_open` | WARN | failureCount, backoffMs |
| `fitness.zone_led.backoff` | WARN | remainingMs |
# Ambient LED Troubleshooting Guide

This guide helps diagnose and fix issues with the Ambient LED fitness zone feature.

## Quick Diagnostics

### 1. Check Feature Status
```bash
curl http://localhost:3000/fitness/zone_led/status
```

**Expected response when working:**
```json
{
  "enabled": true,
  "scenes": { "off": "...", "cool": "...", ... },
  "state": { "failureCount": 0, "isInBackoff": false }
}
```

### 2. Check Metrics
```bash
curl http://localhost:3000/fitness/zone_led/metrics
```

Look for:
- `totals.activated` > 0 (scenes are being activated)
- `totals.failures` = 0 (no HA errors)
- `circuitBreaker.isOpen` = false (not in backoff)

---

## Common Issues

### Issue: Feature Shows as Disabled

**Symptoms:**
- `enabled: false` in status response
- No LED changes during workout

**Causes & Solutions:**

| Cause | Solution |
|-------|----------|
| Missing `ambient_led` section | Add `ambient_led:` section to fitness config |
| Missing `scenes` object | Add `scenes:` under `ambient_led:` |
| Missing `off` scene | Add `off: your_scene_name` (required) |
| Wrong config file | Ensure config is in correct household path |

**Verify config location:**
```
data/households/{household_id}/apps/fitness/config.yml
```

---

### Issue: LEDs Not Changing

**Symptoms:**
- Status shows `enabled: true`
- `lastScene` never updates
- Metrics show `activated: 0`

**Diagnostic Steps:**

1. **Check if requests are reaching backend:**
   ```bash
   # Watch logs
   tail -f logs/backend.log | grep zone_led
   ```

2. **Check skip reasons in metrics:**
   ```bash
   curl http://localhost:3000/fitness/zone_led/metrics | jq '.skipped'
   ```

**Common skip reasons:**

| Reason | Meaning | Solution |
|--------|---------|----------|
| `duplicate` | Same scene already active | Normal behavior - only changes are sent |
| `rate_limited` | Too many requests | Wait for throttle window (default 2s) |
| `backoff` | Circuit breaker open | Fix HA connection, then reset |
| `feature_disabled` | Config missing | Check config file |

3. **Test manual scene activation:**
   ```bash
   curl -X POST http://localhost:3000/fitness/zone_led \
     -H "Content-Type: application/json" \
     -d '{"zones":[{"zoneId":"warm","isActive":true}]}'
   ```

---

### Issue: Home Assistant Connection Failures

**Symptoms:**
- `failureCount` > 0 in status
- `isInBackoff: true` (circuit breaker open)
- Error logs showing HA connection issues

**Diagnostic Steps:**

1. **Check HA connectivity:**
   ```bash
   curl -H "Authorization: Bearer $HOME_ASSISTANT_TOKEN" \
        http://your-ha-host:8123/api/
   ```

2. **Test scene activation directly:**
   ```bash
   curl -X POST http://your-ha-host:8123/api/services/scene/turn_on \
     -H "Authorization: Bearer $HOME_ASSISTANT_TOKEN" \
     -H "Content-Type: application/json" \
     -d '{"entity_id": "scene.your_scene_name"}'
   ```

**Common causes:**

| Cause | Solution |
|-------|----------|
| Wrong HA host/port | Update `home_assistant.host` and `home_assistant.port` in config |
| Invalid token | Generate new long-lived access token in HA |
| Network issues | Check firewall, DNS resolution |
| HA offline | Wait for HA to come back online |

3. **Reset circuit breaker after fixing:**
   ```bash
   curl -X POST http://localhost:3000/fitness/zone_led/reset
   ```

---

### Issue: Scene Doesn't Exist in HA

**Symptoms:**
- HA returns 404 or error
- Error log shows "scene not found"

**Solution:**

1. Verify scene exists in HA:
   ```bash
   curl -H "Authorization: Bearer $HOME_ASSISTANT_TOKEN" \
        http://your-ha-host:8123/api/states/scene.your_scene_name
   ```

2. Check scene naming:
   - Config uses scene **name** (e.g., `garage_led_blue`)
   - HA uses entity_id format: `scene.garage_led_blue`
   - The backend adds `scene.` prefix automatically

3. Create missing scene in HA `scenes.yaml`

---

### Issue: Wrong Zone Displayed

**Symptoms:**
- LED color doesn't match expected zone
- Unexpected zone resolution

**Diagnostic Steps:**

1. **Check what zones are being sent:**
   ```bash
   # In browser console during workout
   # Or check backend logs for zone_led.activated events
   ```

2. **Verify zone calculation:**
   - Max zone among all **active** participants is used
   - Inactive users (heart rate timeout) are excluded
   - Single user in fire = "all fire" (breathing effect)

3. **Test zone resolution:**
   ```bash
   # Test warm zone
   curl -X POST http://localhost:3000/fitness/zone_led \
     -H "Content-Type: application/json" \
     -d '{"zones":[{"zoneId":"warm","isActive":true}]}'
   ```

---

### Issue: Rate Limiting Too Aggressive

**Symptoms:**
- Many `rate_limited` skips in metrics
- LED changes feel delayed

**Solution:**

Reduce throttle time in config:
```yaml
ambient_led:
  throttle_ms: 1000  # Reduce from default 2000ms
  scenes:
    # ...
```

**Note:** Don't go below 500ms to avoid overwhelming Home Assistant.

---

### Issue: Circuit Breaker Won't Reset

**Symptoms:**
- `isInBackoff: true` even after HA is fixed
- Backoff keeps increasing

**Solution:**

1. **Manual reset:**
   ```bash
   curl -X POST http://localhost:3000/fitness/zone_led/reset
   ```

2. **Verify HA is actually reachable** before resetting

3. **Check for recurring failures** - if HA keeps failing, circuit will re-open

---

## Log Analysis

### Key Log Events

| Event | Level | Meaning |
|-------|-------|---------|
| `fitness.zone_led.activated` | INFO | Scene successfully changed |
| `fitness.zone_led.skipped` | DEBUG | Request skipped (see reason) |
| `fitness.zone_led.failed` | ERROR | HA call failed |
| `fitness.zone_led.circuit_open` | ERROR | Circuit breaker opened |
| `fitness.zone_led.backoff` | WARN | Request rejected due to backoff |
| `fitness.zone_led.reset` | INFO | State was manually reset |

### Enable Debug Logging

To see all zone_led events including skipped requests:
```bash
# Set log level to debug for fitness app
export LOG_LEVEL=debug
```

### Log Search Examples

```bash
# Find all scene activations
grep "zone_led.activated" logs/backend.log

# Find failures
grep "zone_led.failed\|zone_led.circuit_open" logs/backend.log

# Count by event type
grep "zone_led" logs/backend.log | cut -d'"' -f4 | sort | uniq -c
```

---

## Testing Tools

### Manual Test Script

```bash
# Test all zones in sequence
node scripts/test-zone-led.mjs test-all
```

### Individual Zone Commands

```bash
node scripts/test-zone-led.mjs cool    # Blue
node scripts/test-zone-led.mjs warm    # Yellow
node scripts/test-zone-led.mjs hot     # Orange
node scripts/test-zone-led.mjs fire    # Red
node scripts/test-zone-led.mjs off     # Off
```

### Stress Test (Throttle Verification)

```bash
node scripts/test-zone-led.mjs stress
```

---

## Health Check Endpoints

| Endpoint | Purpose |
|----------|---------|
| `GET /fitness/zone_led/status` | Current state and config |
| `GET /fitness/zone_led/metrics` | Detailed usage metrics |
| `POST /fitness/zone_led/reset` | Reset circuit breaker |

---

## Recovery Procedures

### Full Reset Procedure

1. Stop any active workout sessions
2. Fix underlying issue (HA connectivity, config, etc.)
3. Reset circuit breaker:
   ```bash
   curl -X POST http://localhost:3000/fitness/zone_led/reset
   ```
4. Test with manual scene change:
   ```bash
   curl -X POST http://localhost:3000/fitness/zone_led \
     -H "Content-Type: application/json" \
     -d '{"zones":[{"zoneId":"cool","isActive":true}]}'
   ```
5. Verify in status:
   ```bash
   curl http://localhost:3000/fitness/zone_led/status
   ```

### Emergency LED Off

If LEDs are stuck on and need to be turned off immediately:

```bash
# Via DaylightStation
curl -X POST http://localhost:3000/fitness/zone_led \
  -H "Content-Type: application/json" \
  -d '{"sessionEnded":true}'

# Directly via Home Assistant
curl -X POST http://your-ha-host:8123/api/services/scene/turn_on \
  -H "Authorization: Bearer $HOME_ASSISTANT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"entity_id": "scene.garage_led_off"}'
```

---

## Contact & Support

If issues persist after following this guide:
1. Collect logs: `grep zone_led logs/backend.log > zone_led_debug.log`
2. Get metrics: `curl http://localhost:3000/fitness/zone_led/metrics > metrics.json`
3. Get status: `curl http://localhost:3000/fitness/zone_led/status > status.json`
4. Include config (redact sensitive data)
