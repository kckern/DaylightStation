# Bug 06: RPM Device Domain Consolidation

**Severity:** Medium
**Area:** Refactor
**Status:** Open

## Summary

Current data models treat Bicycles and Jump Ropes as disparate entities, leading to UI fragmentation. They should be unified under an "RPM Device" super-category since both share the core attribute of measuring rotations per minute.

## Current Architecture

### Separate Device Types
- `cadence` / `stationary_bike` / `ab_roller` → CadenceCard
- `jumprope` → JumpropeCard

### Current Card Registry
**File:** `frontend/src/modules/Fitness/FitnessSidebar/RealtimeCards/index.js`

```javascript
CARD_REGISTRY = {
  heart_rate: PersonCard,
  cadence: CadenceCard,
  stationary_bike: CadenceCard,
  ab_roller: CadenceCard,
  jumprope: JumpropeCard,
  vibration: VibrationCard,
  punching_bag: VibrationCard,
  step_platform: VibrationCard,
  pull_up_bar: VibrationCard
}
```

### Data Pipeline Differences

**Cadence devices (ANT+):**
- **File:** `frontend/src/hooks/fitness/DeviceManager.js`
- Data: `CalculatedCadence`, `CumulativeCadenceRevolutionCount`
- RPM from ANT+ protocol directly

**Jump rope (BLE):**
- **File:** `frontend/src/hooks/fitness/JumpropeSessionState.js`
- **File:** `_extensions/fitness/src/decoders/jumprope.mjs`
- Data: Monotonic revolution count from BLE packets
- RPM calculated via rolling 10-second window

### Event Routing
**File:** `frontend/src/hooks/fitness/DeviceEventRouter.js`

Separate handlers for:
- `'ant'` → ANT+ cadence data
- `'ble_jumprope'` → BLE jump rope data
- `'vibration'` → Vibration sensors

## Proposed Architecture

### Super Category: RPM Device

**Shared attributes:**
- `rpm` - Rotations per minute
- `revolutionCount` - Total revolutions in session
- `connectionState` - connected/disconnected
- `inactiveSince` - Timestamp for staleness

**Sub-classes:**
- **Cycle** - stationary_bike, ab_roller, cadence
- **JumpRope** - jumprope

### UI Consolidation

1. **Grouped display:** RPM devices in same row container
2. **Full screen view:** Display generic "RPM" label
3. **Visual overrides:**
   - Cycles: Spinning dotted lines animation
   - Jump Ropes: Arc gauge visualization

### Unified Card Component

New `RpmDeviceCard` component that:
- Accepts device type for visual customization
- Shares common RPM display logic
- Renders appropriate visualization based on subtype

## Relevant Code Files

### Device Models
| File | Purpose |
|------|---------|
| `frontend/src/hooks/fitness/DeviceManager.js` | Device registry and metrics |
| `frontend/src/hooks/fitness/JumpropeSessionState.js` | Jump rope RPM calculation |
| `frontend/src/hooks/fitness/DeviceEventRouter.js` | Event routing by type |

### UI Components
| File | Purpose |
|------|---------|
| `frontend/src/modules/Fitness/FitnessSidebar/RealtimeCards/CadenceCard.jsx` | Cycle display |
| `frontend/src/modules/Fitness/FitnessSidebar/RealtimeCards/JumpropeCard.jsx` | Jump rope display |
| `frontend/src/modules/Fitness/FitnessSidebar/RealtimeCards/JumpropeAvatar.jsx` | Jump rope gauge |
| `frontend/src/modules/Fitness/components/RpmDeviceAvatar.jsx` | Spinning animation |
| `frontend/src/modules/Fitness/shared/integrations/DeviceAvatar/DeviceAvatar.jsx` | Unified avatar |

### Configuration
| File | Purpose |
|------|---------|
| `config/apps/fitness.yml` | Equipment definitions |

## Fix Direction

1. **Create abstract RPM device model:**
   - New `RpmDevice` class in DeviceManager
   - Common interface for `getRpm()`, `getRevolutions()`

2. **Unify card component:**
   - Create `RpmDeviceCard` that wraps both device types
   - Pass `deviceSubtype` for visual customization
   - Reuse `RpmDeviceAvatar` with type-based styling

3. **Update card registry:**
   ```javascript
   CARD_REGISTRY = {
     // ... other types
     rpm_device: RpmDeviceCard,  // New unified type
     // Legacy aliases for backwards compatibility
     cadence: RpmDeviceCard,
     stationary_bike: RpmDeviceCard,
     jumprope: RpmDeviceCard,
   }
   ```

4. **Layout grouping:**
   - Sidebar component groups RPM devices together
   - Single row container with flex wrap

5. **Full-screen display:**
   - `RpmFullscreenOverlay` shows generic "RPM" label
   - Device-specific icon/animation based on subtype

## Testing Approach

Runtime tests should:
1. Verify unified display for cycle + jumprope
2. Test RPM calculations for both device types
3. Verify correct visualization per subtype
4. Test staleness detection works for both
5. Verify layout grouping in sidebar
