# Fullscreen Vitals Overlay Feature

> **Related code:** `frontend/src/modules/Fitness/FitnessPlayerOverlay/FullscreenVitalsOverlay.jsx`, `frontend/src/modules/Fitness/FitnessPlayerOverlay/FullscreenVitalsOverlay.scss`, `frontend/src/modules/Fitness/components/CircularUserAvatar.jsx`, `frontend/src/modules/Fitness/FitnessSidebar/RealtimeCards/RpmDeviceAvatar.jsx`

Floating avatar overlay displaying real-time heart rate and RPM device vitals during fullscreen video playback.

---

## Overview

The Fullscreen Vitals Overlay displays circular avatar widgets for active fitness devices when the video player enters fullscreen mode. It provides at-a-glance visibility into heart rate zones and RPM metrics without obscuring workout video content.

**Key behaviors:**
- Appears automatically when video enters fullscreen
- Click/tap toggles anchor position between left and right corners
- Heart rate avatars show zone-colored ring and progress gauge
- RPM avatars show spinning gauge proportional to cadence
- Inactive devices are dimmed (grayscale + reduced opacity)
- Fire zone triggers special pulsing animation with sunbeams

---

## Core Components

| Component | File | Responsibility |
|-----------|------|----------------|
| `FullscreenVitalsOverlay` | `FitnessPlayerOverlay/FullscreenVitalsOverlay.jsx` | Main container, device data mapping |
| `CircularUserAvatar` | `components/CircularUserAvatar.jsx` | Heart rate avatar with zone gauge |
| `RpmDeviceAvatar` | `FitnessSidebar/RealtimeCards/RpmDeviceAvatar.jsx` | RPM device avatar with spinning gauge |
| `rpmUtils.mjs` | `FitnessSidebar/RealtimeCards/rpmUtils.mjs` | RPM progress/color calculations |

**Alternate implementation:** `frontend/src/modules/Fitness/shared/integrations/FullscreenVitalsOverlay/` contains a shared version for plugin contexts. This version uses an older `RpmDeviceAvatar` from `components/` with different styling (`.vital-rpm` class vs `.fullscreen-rpm-item` wrapper). The implementations have diverged and should be consolidated.

---

## User Stories

### Primary Flow

1. **As a user in fullscreen**, I want to see my heart rate displayed so I can monitor my workout intensity without leaving fullscreen.

2. **As a user**, I want my current heart rate zone shown via color so I can quickly assess my effort level.

3. **As a user**, I want to see RPM metrics for my bike/jumprope so I can maintain target cadence.

4. **As a user**, I want to move the overlay to the opposite corner so it doesn't block important video content.

5. **As a user with multiple family members**, I want to see all active users' vitals simultaneously so everyone can track their metrics.

### Secondary Flows

6. **As a user**, I want inactive devices to be dimmed so I can focus on active participants.

7. **As a user in fire zone**, I want special visual feedback so I know I've reached peak intensity.

8. **As a user**, I want to see zone progress so I know how close I am to the next zone threshold.

---

## Component Architecture

### Data Flow

```
FitnessContext
    │
    ├── heartRateDevices[]
    │       │
    │       ▼
    │   getUserByDevice() ──▶ user lookup
    │       │
    │       ▼
    │   resolveUserZone() ──▶ zone ID + color
    │       │
    │       ▼
    │   hrItems[] ──▶ CircularUserAvatar
    │
    └── cadenceDevices[] / jumpropeDevices[]
            │
            ▼
        equipmentMap lookup ──▶ thresholds
            │
            ▼
        rpmItems[] ──▶ RpmDeviceAvatar
```

### Visibility Control

```
FitnessPlayerOverlay
    │
    ├── isFullscreen (from player state)
    │       │
    │       ▼
    └── <FullscreenVitalsOverlay visible={isFullscreen} />
```

**Usage in FitnessPlayerOverlay.jsx:1101:**
```jsx
<FullscreenVitalsOverlay visible={showFullscreenVitals} />
```

---

## Heart Rate Avatars

### CircularUserAvatar Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `name` | string | - | User's display name |
| `avatarSrc` | string | - | Profile image URL |
| `fallbackSrc` | string | - | Fallback image if main fails |
| `heartRate` | number | - | Current BPM value |
| `zoneId` | string | - | Zone identifier (cool/active/warm/hot/fire) |
| `zoneColor` | string | - | CSS color for zone ring |
| `progress` | number | - | 0-1 progress within current zone |
| `size` | number/string | 76px | Avatar diameter |
| `ringWidth` | number/string | 6px | Gauge ring thickness |
| `showGauge` | bool | true | Show progress gauge |
| `showIndicator` | bool | true | Show progress dot indicator |
| `className` | string | '' | Additional CSS classes |

### Zone Resolution

**Location:** `FullscreenVitalsOverlay.jsx:20-60`

Zone is resolved in priority order:
1. `userCurrentZones[userName]` from context
2. Color-to-zone mapping from zones config
3. Fallback: calculate from heart rate thresholds

```javascript
const resolveUserZone = (userName, device, context) => {
  // 1. Check userCurrentZones map
  const entry = userCurrentZones?.[userName];

  // 2. If color but no zoneId, map color to zone
  if (color && !zoneId) {
    zoneId = zones.find(z => z.color === color)?.id;
  }

  // 3. Fallback: calculate from HR thresholds
  if (!zoneId && device?.heartRate) {
    const cfg = usersConfigRaw?.primary?.find(u => u.name === userName);
    const sorted = [...zones].sort((a, b) => b.min - a.min);
    for (const z of sorted) {
      const min = cfg?.zones?.[z.id] ?? z.min;
      if (device.heartRate >= min) {
        return { id: z.id, color: z.color };
      }
    }
  }
};
```

### Visual Elements

**Progress Gauge:**
- SVG circle with stroke-dasharray/dashoffset
- Track: dark background arc (270 degrees)
- Progress: colored arc fills based on zone progress
- Radius: 47 units in 100x100 viewBox

**Progress Indicator:**
- White dot positioned on gauge circumference
- Angle calculated: `180 + (progress * 180)` degrees
- Transform rotates dot to correct position

**HR Value Overlay:**
- Semi-transparent bar at bottom 25% of avatar
- Shows rounded BPM value
- Only renders if heartRate is finite

### Fire Zone Enhancement

**Location:** `CircularUserAvatar.scss:131-239`

When `zoneId === 'fire'`:
- Progress indicator hidden (showIndicator forced false)
- Pulsing red glow animation (1.5s cycle)
- Thicker gauge ring (1.4x width)
- Red track and progress colors
- Sunbeam rays emanating from avatar (12 triangular beams)
- Beams rotate slowly (8s full rotation)
- Individual beams flicker with staggered delays

```css
&.zone-fire {
  animation: fire-pulse 1.5s ease-in-out infinite;

  .zone-progress-gauge {
    animation: fire-ring-glow 1.5s ease-in-out infinite;
  }

  .fire-sunbeams {
    animation: spin-sunbeams 8s linear infinite;
  }
}
```

---

## RPM Device Avatars

### RpmDeviceAvatar Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `equipmentId` | string | - | Equipment identifier for image |
| `equipmentName` | string | 'Equipment' | Alt text for image |
| `rpm` | number | 0 | Current RPM/cadence value |
| `revolutionCount` | number | 0 | Total revolutions (jumprope) |
| `rpmThresholds` | object | {} | min/med/high/max thresholds |
| `deviceSubtype` | string | 'cycle' | 'cycle' or 'jumprope' |
| `size` | number/string | - | Avatar diameter |
| `className` | string | '' | Additional CSS classes |

### Gauge Design

**Two-arc system:**
- **Top arc:** Progress gauge (0-100% of max RPM)
- **Bottom arc:** Varies by device type:
  - Cycle: Dashed spinning animation
  - Jumprope: Solid arc that pulses on revolution count change

**Progress calculation:**

```javascript
// From rpmUtils.mjs
const calculateRpmProgress = (rpm, thresholds) => {
  const { min = 0, max = 100 } = thresholds;
  if (rpm <= min) return 0;
  if (rpm >= max) return 1;
  return (rpm - min) / (max - min);
};
```

**Zone color calculation:**

```javascript
const getRpmZoneColor = (rpm, thresholds) => {
  const { min = 30, med = 60, high = 80, max = 100 } = thresholds;
  if (rpm <= 0) return '#6ab8ff';      // Blue (idle)
  if (rpm < min) return '#51cf66';      // Green (low)
  if (rpm < med) return '#f0c836';      // Yellow
  if (rpm < high) return '#ff922b';     // Orange
  return '#ff6b6b';                      // Red (high)
};
```

### Spin Animation

**Location:** `RpmDeviceAvatar.jsx:56`

```javascript
const spinDuration = rpm > 0 ? `${270 / Math.max(rpm, 1)}s` : '0s';
```

- Duration inversely proportional to RPM
- At 90 RPM: 3s per rotation
- At 30 RPM: 9s per rotation
- At 0 RPM: no animation

### Revolution Pulse (Jumprope)

**Location:** `RpmDeviceAvatar.jsx:33-47`

```javascript
useEffect(() => {
  if (deviceSubtype === 'jumprope' &&
      revolutionCount !== prevRevCountRef.current &&
      revolutionCount > 0) {
    setIsPulsing(true);
    const timer = setTimeout(() => setIsPulsing(false), 200);
    prevRevCountRef.current = revolutionCount;
    return () => clearTimeout(timer);
  }
}, [revolutionCount, deviceSubtype]);
```

---

## Layout & Positioning

### Anchor Modes

| Mode | Position | Alignment |
|------|----------|-----------|
| `anchor-right` (default) | Bottom-right corner | Items align right |
| `anchor-left` | Bottom-left corner | Items align left |

**Toggle behavior:** Click anywhere on overlay to switch sides.

```javascript
const handleToggleAnchor = useCallback((event) => {
  event.preventDefault();
  event.stopPropagation();
  setAnchor(prev => prev === 'right' ? 'left' : 'right');
}, []);
```

### Positioning CSS

**Location:** `FullscreenVitalsOverlay.scss:1-36`

```scss
.fullscreen-vitals-overlay {
  position: absolute;
  bottom: clamp(14px, 4vw, 32px);
  right: clamp(14px, 4vw, 32px);
  z-index: var(--fitness-fullscreen-vitals-z, 80);

  &.anchor-left {
    right: auto;
    left: clamp(14px, 4vw, 32px);
  }
}
```

### Group Layout

**HR Group:**
- Default: Vertical column (1-2 users)
- 3+ users: Horizontal row with wrapping
- Class: `count-{n}` for styling hooks

**RPM Group:**
- Always horizontal row
- Gap: 10-18px responsive

```scss
.fullscreen-vitals-group {
  display: flex;
  gap: clamp(10px, 1vw, 18px);

  &.hr-group {
    flex-direction: column;

    &.count-3, &.count-4, &.count-5, &.count-6 {
      flex-direction: row;
      flex-wrap: wrap;
    }
  }
}
```

---

## Context Dependencies

### Required from FitnessContext

| Property | Type | Usage |
|----------|------|-------|
| `heartRateDevices` | array | Heart rate device list |
| `cadenceDevices` | array | Bike/cadence device list |
| `jumpropeDevices` | array | Jumprope device list |
| `getUserByDevice` | function | Map deviceId to user |
| `userCurrentZones` | object | User -> zone mapping |
| `zones` | array | Zone definitions with thresholds |
| `users` | array | All user objects |
| `usersConfigRaw` | object | Raw user config for overrides |
| `equipment` | array | Equipment config with RPM thresholds |
| `deviceConfiguration` | object | Device color mappings |
| `userZoneProgress` | Map/object | User -> progress data |

### Equipment Mapping

```javascript
const equipmentMap = useMemo(() => {
  const map = {};
  equipment.forEach(item => {
    const entry = {
      name: item.name,
      id: item.id || String(item.cadence),
      rpm: item.rpm,  // { min, med, high, max }
      showRevolutions: item.showRevolutions ?? (item.type === 'jumprope')
    };
    if (item.cadence != null) map[String(item.cadence)] = entry;
    if (item.speed != null) map[String(item.speed)] = entry;
    if (item.ble != null) map[String(item.ble)] = entry;
  });
  return map;
}, [equipment]);
```

---

## Inactive State

### Detection

```javascript
const isInactive = device.inactiveSince || device.connectionState !== 'connected';
```

### Visual Treatment

**Location:** `CircularUserAvatar.scss:21-32`

```scss
&.inactive {
  opacity: 0.5;
  filter: grayscale(0.8);

  .gauge-arc-progress {
    stroke: rgba(255, 255, 255, 0.2);
  }

  .zone-progress-indicator {
    display: none;
  }
}
```

---

## Color Mapping

### RPM Colors

```javascript
const RPM_COLOR_MAP = {
  red: '#ff6b6b',
  orange: '#ff922b',
  yellow: '#f0c836',
  green: '#51cf66',
  blue: '#6ab8ff'
};
```

### Zone Colors

Zones use colors from the zones config array:

| Zone ID | Typical Color |
|---------|---------------|
| cool | Blue (#6ab8ff) |
| active | Green (#51cf66) |
| warm | Yellow (#f0c836) |
| hot | Orange (#ff922b) |
| fire | Red (#ff6b6b) |

---

## Performance Considerations

### Memoization

- `equipmentMap`: Rebuilt only when `equipment` changes
- `hrItems`: Rebuilt when device/user data changes
- `rpmItems`: Rebuilt when cadence/jumprope data changes

### Render Optimization

- Overlay returns `null` if:
  - `visible === false`
  - No HR items AND no RPM items
- Prevents unnecessary DOM nodes during non-fullscreen playback

### Animation Performance

- CSS animations preferred over JS intervals
- SVG stroke-dashoffset transitions (0.3s)
- Fire effects use GPU-accelerated properties

---

## Accessibility

### Keyboard Support

```jsx
<div
  role="button"
  tabIndex={0}
  onClick={handleToggleAnchor}
  onKeyDown={(e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      handleToggleAnchor(e);
    }
  }}
>
```

### ARIA Attributes

- `aria-hidden={!visible}` on overlay container
- Gauge SVG: `aria-hidden="true"`
- Avatar images have alt text

---

## CSS Custom Properties

| Property | Default | Description |
|----------|---------|-------------|
| `--fitness-fullscreen-vitals-z` | 80 | Z-index layer |
| `--vital-avatar-size` | 76px | Avatar diameter |
| `--vital-ring-width` | 6px | Gauge stroke width |
| `--vital-ring-color` | varies | Zone color for ring |
| `--rpm-zone-color` | varies | RPM gauge color |
| `--rpm-spin-duration` | varies | Spin animation duration |
| `--indicator-angle` | 180deg | Progress dot rotation |

---

## Known Issues

### 1. Sorting in Fullscreen vs Sidebar

RPM items in fullscreen are sorted by progress (highest first), while sidebar now sorts by appearance time. This inconsistency may confuse users.

**Status:** Needs alignment

### 2. Missing Jumprope Revolution Display

The fullscreen overlay doesn't display revolution count for jumprope devices (only RPM shown).

**Status:** Low priority

### 3. No Configurable Size

Avatar sizes are fixed at 76px. Some users may want larger displays for visibility.

**Status:** Enhancement opportunity

---

## Future Considerations

1. **Size customization** - Allow user preference for avatar size
2. **Position memory** - Remember anchor preference across sessions
3. **Hide/show toggle** - Let users temporarily hide overlay
4. **Multiple columns** - Better layout for 5+ users
5. **Touch gestures** - Swipe to dismiss/reposition
6. **Revolution counter** - Show jumps on jumprope avatar

---

**Last updated:** 2026-01-08
