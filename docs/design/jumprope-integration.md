# Jumprope Integration Design Document

## Overview

This document outlines the integration of BLE jumprope devices (RENPHO R-Q008) into the DaylightStation fitness tracking system. The jumprope represents a new device category alongside existing bikes (cadence) and heart rate monitors.

## Architecture

### Data Flow

```
┌─────────────────┐    BLE      ┌─────────────────┐   WebSocket   ┌─────────────────┐
│  RENPHO R-Q008  │ ─────────►  │  Fitness Docker │ ────────────► │  DaylightStation│
│  (Jumprope)     │             │  (garage)       │               │  Backend        │
└─────────────────┘             └─────────────────┘               └────────┬────────┘
                                                                           │
                                                                    WebSocket pub/sub
                                                                           │
                                                                           ▼
                                ┌─────────────────┐   React State  ┌─────────────────┐
                                │  DeviceManager  │ ◄───────────── │  FitnessSession │
                                │  (devices Map)  │                │  (ingestData)   │
                                └────────┬────────┘                └─────────────────┘
                                         │
                                         ▼
                                ┌─────────────────┐
                                │  DeviceAvatar   │
                                │  (UI rendering) │
                                └─────────────────┘
```

### Message Format

BLE jumprope data arrives via WebSocket with this structure:

```json
{
  "topic": "fitness",
  "source": "fitness",
  "type": "ble_jumprope",
  "deviceId": "12:34:5B:E1:DD:85",
  "deviceName": "R-Q008",
  "timestamp": "2026-01-06T17:01:00.000Z",
  "data": {
    "jumps": 150,
    "rpm": 120,
    "avgRPM": 115,
    "maxRPM": 135,
    "duration": 180,
    "calories": 15
  }
}
```

## Component Changes

### 1. FitnessSession.js (Backend Data Layer)

**Location:** `frontend/src/hooks/fitness/FitnessSession.js`

**Status:** ✅ Already implemented

The `ingestData()` method now handles BLE jumprope data:

```javascript
// Handle BLE Jumprope Data
if (payload.topic === 'fitness' && payload.type === 'ble_jumprope' && payload.deviceId && payload.data) {
  const normalized = {
    id: String(payload.deviceId),
    name: payload.deviceName || 'Jumprope',
    type: 'jumprope',
    profile: 'jumprope',
    lastSeen: Date.now(),
    connectionState: 'connected',
    cadence: payload.data.rpm || 0,           // Map RPM to cadence field
    revolutionCount: payload.data.jumps || 0, // Map jumps to revolution count
    timestamp: payload.timestamp ? new Date(payload.timestamp).getTime() : Date.now()
  };
  
  const device = this.deviceManager.registerDevice(normalized);
  if (device) {
    this.recordDeviceActivity(device, { rawPayload: payload });
  }
  return device;
}
```

**Key mappings:**
- `payload.data.rpm` → `device.cadence` (allows reuse of existing RPM display logic)
- `payload.data.jumps` → `device.revolutionCount` (cumulative count)
- `type: 'jumprope'` → Enables device-specific UI rendering

### 2. DeviceManager.js (Device State)

**Location:** `frontend/src/hooks/fitness/DeviceManager.js`

**Status:** ✅ No changes needed

The `Device` class already supports all required fields:
- `type` - Set to `'jumprope'`
- `cadence` - Used for RPM display
- `revolutionCount` - Used for total jumps

The `getMetricsSnapshot()` method returns compatible data:
```javascript
getMetricsSnapshot() {
  return {
    deviceId: this.id,
    type: this.type,
    rpm: this.cadence,       // Works for jumprope RPM
    cadence: this.cadence,
    revolutionCount: this.revolutionCount, // Total jumps
    // ...
  };
}
```

### 3. DeviceAvatar.jsx (UI Component)

**Location:** `frontend/src/modules/Fitness/shared/integrations/DeviceAvatar/`

**Status:** ⚠️ Needs enhancement for jumprope-specific display

**Current behavior:** Renders a spinning circular avatar based on RPM.

**Proposed changes:**

```jsx
// Add jumprope variant support
const DeviceAvatar = ({
  rpm = 0,
  deviceType = 'cadence',  // NEW: 'cadence' | 'jumprope' | 'power'
  jumpCount,               // NEW: Total jump count for jumprope
  // ... existing props
}) => {
  // Jumprope gets bounce animation instead of spin
  const isJumprope = deviceType === 'jumprope';
  
  const animationStyle = isJumprope
    ? { animation: `jump-bounce ${60 / (rpm || 60)}s ease-in-out infinite` }
    : { '--spin-duration': spinDuration };
  
  // Display format depends on device type
  const displayValue = isJumprope
    ? jumpCount ?? '--'
    : (normalizedRpm != null ? normalizedRpm : '--');
    
  // ...
};
```

**New SCSS animation:**
```scss
@keyframes jump-bounce {
  0%, 100% { transform: translateY(0); }
  50% { transform: translateY(-8px); }
}

.device-avatar--jumprope {
  .device-avatar__spinner {
    border-radius: 8px; // Rounded rectangle instead of circle
    border-top-color: #ff6b6b;
    border-right-color: transparent;
    animation: jump-bounce var(--spin-duration, 0.5s) ease-in-out infinite;
  }
}
```

### 4. SidebarFooter.jsx (Device Grid)

**Location:** `frontend/src/modules/Fitness/SidebarFooter.jsx`

**Status:** ⚠️ Needs update for jumprope icon

**Current code (line 382-385):**
```jsx
{device.type === 'power' && '⚡'}
{device.type === 'cadence' && '⚙️'}
{device.type === 'speed' && '🚴'}
{!['power', 'cadence', 'speed'].includes(device.type) && '📡'}
```

**Proposed change:**
```jsx
{device.type === 'power' && '⚡'}
{device.type === 'cadence' && '⚙️'}
{device.type === 'speed' && '🚴'}
{device.type === 'jumprope' && '🦘'}
{!['power', 'cadence', 'speed', 'jumprope'].includes(device.type) && '📡'}
```

### 5. FitnessUsers.jsx (Device Type Config)

**Location:** `frontend/src/modules/Fitness/FitnessSidebar/FitnessUsers.jsx`

**Status:** ⚠️ Needs update for jumprope type config

**Current config (line 34):**
```javascript
const DEVICE_TYPE_CONFIG = {
  cadence: { unit: 'RPM', colorClass: 'cadence', icon: '⚙️' },
  // ...
};
```

**Proposed addition:**
```javascript
const DEVICE_TYPE_CONFIG = {
  cadence: { unit: 'RPM', colorClass: 'cadence', icon: '⚙️' },
  jumprope: { unit: 'jumps', colorClass: 'jumprope', icon: '🦘' },
  // ...
};
```

### 6. Equipment Config (Backend)

**Location:** `data/households/default/apps/fitness/config.yml`

**Status:** ✅ Already implemented

```yaml
equipment:
  - name: Jumprope
    id: jumprope
    type: jumprope
    cadence: 12:34:5B:E1:DD:85  # BLE MAC address as device ID
```

## Display Considerations

### Metrics Shown

| Metric | Display Location | Format |
|--------|------------------|--------|
| RPM | DeviceAvatar value | `120` (integer) |
| Total Jumps | DeviceAvatar or sidebar | `1,234` (with comma) |
| Duration | Session stats | `3:45` (mm:ss) |
| Avg RPM | Session summary | `115 avg` |
| Max RPM | Session summary | `135 max` |
| Calories | Session summary | `~150 cal` |

### Visual Differentiation

| Device Type | Icon | Animation | Color |
|-------------|------|-----------|-------|
| Bike (cadence) | ⚙️ | Spin | Yellow/Orange |
| Heart Rate | ❤️ | Pulse | Red gradient by zone |
| Jumprope | 🦘 | Bounce | Pink/Coral |
| Power | ⚡ | None | Blue |

## Session Integration

### Session Start Triggers

The jumprope can contribute to session start when:
1. Heart rate is detected (from a separate HR monitor)
2. Jumprope RPM exceeds threshold (e.g., > 60 RPM for 5+ seconds)

### Timeline Recording

Jumprope data is recorded in the session timeline:
- `device:{deviceId}:rpm` - RPM over time
- `device:{deviceId}:jumps` - Cumulative jump count

### Gamification

Future consideration: Jumprope could contribute to coin earning:
- 1 coin per 50 jumps in Active zone
- Bonus coins for sustained high RPM

## Implementation Phases

### Phase 1: Basic Display (Current)
- [x] BLE data ingestion in FitnessSession
- [x] Device registration in DeviceManager
- [x] Equipment config entry
- [ ] Icon in SidebarFooter

### Phase 2: Enhanced UI
- [ ] Jumprope-specific DeviceAvatar variant
- [ ] Jump count display
- [ ] Bounce animation
- [ ] Device type config in FitnessUsers

### Phase 3: Session Integration
- [ ] Timeline series recording
- [ ] Session statistics
- [ ] Historical data persistence

### Phase 4: Gamification
- [ ] Coin earning rules
- [ ] Achievement tracking
- [ ] Leaderboard integration

## Testing Checklist

- [ ] Jumprope appears in device grid when active
- [ ] RPM updates in real-time
- [ ] Device shows correct icon (🦘)
- [ ] Inactivity timeout works correctly
- [ ] Reconnection after jumprope power cycle
- [ ] Data persists to session history
- [ ] Works alongside bike/HR devices simultaneously

## Files Modified

| File | Change | Status |
|------|--------|--------|
| `_extensions/fitness/src/ble.mjs` | BLE manager | ✅ Done |
| `_extensions/fitness/src/decoders/jumprope.mjs` | Data decoder | ✅ Done |
| `_extensions/fitness/config/ble-devices.json` | Device config | ✅ Done |
| `frontend/src/hooks/fitness/FitnessSession.js` | Data ingestion | ✅ Done |
| `data/households/default/apps/fitness/config.yml` | Equipment | ✅ Done |
| `frontend/src/modules/Fitness/SidebarFooter.jsx` | Icon display | ✅ Done |
| `frontend/src/modules/Fitness/FitnessSidebar/FitnessUsers.jsx` | Type config | ✅ Done |
| `frontend/src/modules/Fitness/FitnessSidebar.scss` | Jumprope color | ✅ Done |
| `frontend/src/modules/Fitness/MiniMonitor.scss` | Jumprope color | ✅ Done |
| `frontend/src/modules/Fitness/shared/integrations/DeviceAvatar/` | Bounce animation | ⏳ Optional |
