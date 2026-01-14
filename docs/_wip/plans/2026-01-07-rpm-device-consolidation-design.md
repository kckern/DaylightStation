# RPM Device Consolidation Design

**Date:** 2026-01-07
**Status:** Approved
**Related Bug:** `docs/_wip/bugs/2026-01-07 FitnessApp BugBash/06-rpm-device-consolidation.md`

## Overview

Unify bicycles and jump ropes under an "RPM Device" super-category with consistent visual language, shared data model, and progress-based sidebar ordering.

## Goals

1. **Visual consistency** - Bikes and jump ropes use the same gauge-based avatar
2. **Code maintainability** - Single card component for all RPM devices
3. **Full-screen display** - Unified RPM overlay (bicycle-style, number only)

---

## Design Decisions

### 1. Data Model & Config

Config structure follows existing pattern (jump rope already has `rpm` thresholds):

```yaml
equipment:
  - name: CycleAce
    id: cycle_ace
    type: stationary_bike
    cadence: 49904
    rpm:
      min: 30
      med: 60
      high: 80
      max: 100
    showRevolutions: false  # optional, default false

  - name: Jump Rope
    id: r-q008
    type: jumprope
    ble: 12:34:5B:E1:DD:85
    rpm:
      min: 30
      med: 50
      high: 80
      max: 150
    showRevolutions: true  # shows jump count
```

Unified device model:
```javascript
{
  rpm: number,              // current RPM
  revolutionCount: number,  // cumulative revolutions
  rpmProgress: number,      // 0-1, calculated from (rpm - min) / (max - min)
  rpmThresholds: { min, med, high, max },
  deviceSubtype: 'cycle' | 'jumprope',
  showRevolutions: boolean
}
```

### 2. Unified UI Component

**RpmDeviceCard** replaces both `CadenceCard` and `JumpropeCard`.

**RpmDeviceAvatar** (gauge-based):
- **Top arc**: Progress gauge based on `rpmProgress` (0-1)
- **Bottom arc**: Animation varies by `deviceSubtype`
  - `cycle`: Spinning dashed stroke (speed proportional to RPM)
  - `jumprope`: Solid stroke that pulses on revolution count change
- **Center**: Equipment image from `/media/img/equipment/{id}`
- **Zone colors**: Same color scale based on min/med/high/max thresholds

Card registry update:
```javascript
CARD_REGISTRY = {
  heart_rate: PersonCard,
  cadence: RpmDeviceCard,
  stationary_bike: RpmDeviceCard,
  ab_roller: RpmDeviceCard,
  jumprope: RpmDeviceCard,
  vibration: VibrationCard,
  // ...
}
```

### 3. Sidebar Ordering

**RPM devices** - Sorted by `rpmProgress` descending (closest to max first):
```javascript
// Example: Three devices
CycleAce:   rpm=75, max=100 → progress=0.75
Jump Rope:  rpm=120, max=150 → progress=0.80
Ab Roller:  rpm=40, max=100 → progress=0.40

// Sorted order: Jump Rope (80%), CycleAce (75%), Ab Roller (40%)
```

**Heart rate devices** - Two-level sort:
1. Primary: Zone (fire > hot > warm > active > cool)
2. Secondary: Progress within zone (not raw HR)

```javascript
// Example: Two users both in "warm" zone (120-140 HR)
Felix: HR=135, zone=warm → zoneProgress = (135-120)/(140-120) = 0.75
Milo:  HR=125, zone=warm → zoneProgress = (125-120)/(140-120) = 0.25

// Within warm zone: Felix (75%) before Milo (25%)
```

**Overall sidebar order**:
1. Heart rate devices (sorted by zone, then zone-progress)
2. RPM devices (sorted by rpmProgress)
3. Vibration devices (existing order)

### 4. Full-Screen Display

Minimal overlay (reuse bicycle-style pattern):
- Large equipment icon
- Big RPM number only, no label
- Background color matches current zone color
- Same component handles both bikes and jump ropes

---

## File Changes

### New Files
- `frontend/src/modules/Fitness/FitnessSidebar/RealtimeCards/RpmDeviceCard.jsx`
- `frontend/src/modules/Fitness/FitnessSidebar/RealtimeCards/RpmDeviceAvatar.jsx`

### Modified Files
- `RealtimeCards/index.js` - Update registry
- `DeviceManager.js` - Add `rpmProgress` calculation
- `FitnessSidebar.jsx` - Add progress-based sorting for RPM devices
- `PersonCard.jsx` (or HR sorting logic) - Change secondary sort to zone-progress %
- Config loader - Ensure `rpm` thresholds loaded for all equipment

### Deleted Files
- `CadenceCard.jsx`
- `JumpropeCard.jsx`
- `JumpropeAvatar.jsx`
- `JumpropeCard.scss`

### Repurposed
- Bicycle full-screen overlay → Generic RPM full-screen overlay

---

## Testing

### Unit Tests
- `rpmProgress` calculation: verify (rpm - min) / (max - min) clamped to 0-1
- Zone-progress calculation for HR: verify normalization within zone bounds
- Sorting comparator: verify progress-based ordering

### Integration Tests
- RpmDeviceCard renders for both `cycle` and `jumprope` subtypes
- Bottom arc animation: spinning for cycles, pulsing for jumprope
- Config loading: verify `rpm` thresholds loaded for all equipment

### Runtime Tests
- Connect bike + jumprope simultaneously, verify unified card appearance
- Verify sorting updates dynamically as RPM changes
- Verify full-screen overlay works for both device types
- Verify revolution count shows only when `showRevolutions: true`
