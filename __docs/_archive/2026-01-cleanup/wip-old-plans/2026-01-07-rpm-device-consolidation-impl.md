# RPM Device Consolidation Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Unify bicycles and jump ropes under a single "RPM Device" UI pattern with gauge-based avatars and progress-based sorting.

**Architecture:** Create unified `RpmDeviceCard` and `RpmDeviceAvatar` components that handle both device subtypes. Modify sorting logic in `FitnessUsers.jsx` to use progress-based ordering. Update full-screen overlay to use the unified pattern.

**Tech Stack:** React, SCSS, existing FitnessContext data model

---

## Task 1: Add RPM Thresholds to Bike Equipment Config

**Files:**
- Modify: `/Users/kckern/Library/CloudStorage/Dropbox/Apps/DaylightStation/data/households/default/apps/fitness/config.yml`

**Step 1: Add rpm thresholds to stationary bike equipment**

Add `rpm:` block to each bike/cadence equipment entry (jumprope already has it):

```yaml
  - name: CycleAce
    id: cycle_ace
    type: stationary_bike
    cadence: 49904
    rpm:
      min: 30
      med: 60
      high: 80
      max: 100

  - name: Ab Roller
    id: ab_roller
    type: ab_roller
    cadence: 7183
    rpm:
      min: 20
      med: 40
      high: 60
      max: 80

  - name: Tricycle
    id: tricycle
    type: stationary_bike
    cadence: 7153
    rpm:
      min: 30
      med: 60
      high: 80
      max: 100

  - name: NiceDay
    id: niceday
    type: stationary_bike
    cadence: 7138
    rpm:
      min: 30
      med: 60
      high: 80
      max: 100
```

**Step 2: Verify config loads**

Run: `npm run dev` and check console for config loading errors.

**Step 3: Commit**

```bash
git add data/households/default/apps/fitness/config.yml
git commit -m "feat(config): add rpm thresholds to bike equipment"
```

---

## Task 2: Create RpmDeviceAvatar Gauge Component

**Files:**
- Create: `frontend/src/modules/Fitness/FitnessSidebar/RealtimeCards/RpmDeviceAvatar.jsx`
- Create: `frontend/src/modules/Fitness/FitnessSidebar/RealtimeCards/RpmDeviceAvatar.scss`

**Step 1: Write unit test for progress calculation**

Create: `tests/unit/fitness/rpm-device-avatar.unit.test.mjs`

```javascript
import { describe, it, expect } from '@jest/globals';

// Test the pure functions that will be used by the component
describe('RpmDeviceAvatar utilities', () => {
  describe('getRpmProgress', () => {
    it('returns 0 when rpm is at or below min', () => {
      const progress = calculateRpmProgress(30, { min: 30, max: 100 });
      expect(progress).toBe(0);
    });

    it('returns 1 when rpm is at or above max', () => {
      const progress = calculateRpmProgress(100, { min: 30, max: 100 });
      expect(progress).toBe(1);
    });

    it('returns 0.5 when rpm is midway', () => {
      const progress = calculateRpmProgress(65, { min: 30, max: 100 });
      expect(progress).toBe(0.5);
    });

    it('clamps negative rpm to 0', () => {
      const progress = calculateRpmProgress(-10, { min: 30, max: 100 });
      expect(progress).toBe(0);
    });
  });

  describe('getRpmZoneColor', () => {
    const thresholds = { min: 30, med: 60, high: 80, max: 100 };

    it('returns idle color below min', () => {
      expect(getRpmZoneColor(20, thresholds)).toBe('#666');
    });

    it('returns min color at min threshold', () => {
      expect(getRpmZoneColor(30, thresholds)).toBe('#3b82f6');
    });

    it('returns med color at med threshold', () => {
      expect(getRpmZoneColor(60, thresholds)).toBe('#22c55e');
    });

    it('returns high color at high threshold', () => {
      expect(getRpmZoneColor(80, thresholds)).toBe('#f59e0b');
    });

    it('returns max color at max threshold', () => {
      expect(getRpmZoneColor(100, thresholds)).toBe('#ef4444');
    });
  });
});

// Export these for import into component
export function calculateRpmProgress(rpm, thresholds) {
  const { min = 0, max = 100 } = thresholds || {};
  if (!Number.isFinite(rpm) || rpm <= min) return 0;
  if (rpm >= max) return 1;
  return (rpm - min) / (max - min);
}

export function getRpmZoneColor(rpm, thresholds) {
  const { min = 10, med = 50, high = 80, max = 120 } = thresholds || {};
  if (!Number.isFinite(rpm) || rpm < min) return '#666';
  if (rpm >= max) return '#ef4444';
  if (rpm >= high) return '#f59e0b';
  if (rpm >= med) return '#22c55e';
  return '#3b82f6';
}
```

**Step 2: Run test to verify it passes**

Run: `npm test -- tests/unit/fitness/rpm-device-avatar.unit.test.mjs`

**Step 3: Create the RpmDeviceAvatar component**

Create: `frontend/src/modules/Fitness/FitnessSidebar/RealtimeCards/RpmDeviceAvatar.jsx`

```jsx
/**
 * RpmDeviceAvatar - Unified gauge avatar for RPM devices (bikes + jumprope)
 *
 * Top arc: Progress gauge based on RPM relative to thresholds
 * Bottom arc: Animation varies by device subtype
 *   - cycle: Spinning dashed stroke
 *   - jumprope: Pulses on revolution count change
 */

import React, { useMemo, useState, useEffect, useRef } from 'react';
import PropTypes from 'prop-types';
import { DaylightMediaPath } from '../../../../lib/api.mjs';
import './RpmDeviceAvatar.scss';

const GAUGE_RADIUS = 47;
const GAUGE_CIRCUMFERENCE = 2 * Math.PI * GAUGE_RADIUS;
const HALF_CIRCUMFERENCE = GAUGE_CIRCUMFERENCE / 2;

const RPM_COLORS = {
  idle: '#666',
  min: '#3b82f6',
  med: '#22c55e',
  high: '#f59e0b',
  max: '#ef4444'
};

export function calculateRpmProgress(rpm, thresholds) {
  const { min = 0, max = 100 } = thresholds || {};
  if (!Number.isFinite(rpm) || rpm <= min) return 0;
  if (rpm >= max) return 1;
  return (rpm - min) / (max - min);
}

export function getRpmZoneColor(rpm, thresholds) {
  const { min = 10, med = 50, high = 80, max = 120 } = thresholds || {};
  if (!Number.isFinite(rpm) || rpm < min) return RPM_COLORS.idle;
  if (rpm >= max) return RPM_COLORS.max;
  if (rpm >= high) return RPM_COLORS.high;
  if (rpm >= med) return RPM_COLORS.med;
  return RPM_COLORS.min;
}

const RpmDeviceAvatar = ({
  equipmentId,
  equipmentName = 'Equipment',
  rpm = 0,
  revolutionCount = 0,
  rpmThresholds = {},
  deviceSubtype = 'cycle', // 'cycle' | 'jumprope'
  size,
  className = ''
}) => {
  const prevRevCountRef = useRef(revolutionCount);
  const [isPulsing, setIsPulsing] = useState(false);

  // Pulse bottom arc when revolution count changes (jumprope mode)
  useEffect(() => {
    if (deviceSubtype === 'jumprope' && revolutionCount !== prevRevCountRef.current && revolutionCount > 0) {
      setIsPulsing(true);
      const timer = setTimeout(() => setIsPulsing(false), 200);
      prevRevCountRef.current = revolutionCount;
      return () => clearTimeout(timer);
    }
  }, [revolutionCount, deviceSubtype]);

  const progress = useMemo(() => calculateRpmProgress(rpm, rpmThresholds), [rpm, rpmThresholds]);
  const zoneColor = useMemo(() => getRpmZoneColor(rpm, rpmThresholds), [rpm, rpmThresholds]);

  // Top arc progress
  const topArcOffset = HALF_CIRCUMFERENCE * (1 - progress);

  // Bottom arc spin duration (for cycle mode)
  const spinDuration = rpm > 0 ? `${270 / Math.max(rpm, 1)}s` : '0s';

  const isActive = rpm > 0;

  const rootStyle = {
    '--rpm-avatar-size': typeof size === 'number' ? `${size}px` : size,
    '--rpm-zone-color': zoneColor,
    '--rpm-spin-duration': spinDuration
  };

  const combinedClassName = [
    'rpm-device-avatar',
    `subtype-${deviceSubtype}`,
    isActive ? 'is-active' : 'is-idle',
    isPulsing ? 'is-pulsing' : '',
    className
  ].filter(Boolean).join(' ');

  const handleImageError = (e) => {
    if (e.target.dataset.fallback) {
      e.target.style.display = 'none';
      return;
    }
    e.target.dataset.fallback = '1';
    e.target.src = DaylightMediaPath('/media/img/equipment/equipment');
  };

  return (
    <div className={combinedClassName} style={rootStyle}>
      <svg
        className="rpm-gauge"
        viewBox="0 0 100 100"
        preserveAspectRatio="xMidYMid meet"
        aria-hidden="true"
      >
        {/* Top arc - track */}
        <path
          className="gauge-arc gauge-arc-track top-arc"
          d="M 3 50 A 47 47 0 0 1 97 50"
          fill="none"
        />

        {/* Top arc - progress */}
        <path
          className="gauge-arc gauge-arc-progress top-arc"
          d="M 3 50 A 47 47 0 0 1 97 50"
          fill="none"
          style={{
            strokeDasharray: HALF_CIRCUMFERENCE,
            strokeDashoffset: topArcOffset,
            stroke: zoneColor
          }}
        />

        {/* Bottom arc - cycle: spinning dashes, jumprope: solid pulse */}
        <path
          className={`gauge-arc bottom-arc ${deviceSubtype === 'cycle' ? 'spinning' : 'pulsing'}`}
          d="M 97 50 A 47 47 0 0 1 3 50"
          fill="none"
          style={{ stroke: zoneColor }}
        />
      </svg>

      <div className="avatar-core">
        <img
          src={DaylightMediaPath(`/media/img/equipment/${equipmentId}`)}
          alt={equipmentName}
          onError={handleImageError}
        />
      </div>
    </div>
  );
};

RpmDeviceAvatar.propTypes = {
  equipmentId: PropTypes.string,
  equipmentName: PropTypes.string,
  rpm: PropTypes.number,
  revolutionCount: PropTypes.number,
  rpmThresholds: PropTypes.shape({
    min: PropTypes.number,
    med: PropTypes.number,
    high: PropTypes.number,
    max: PropTypes.number
  }),
  deviceSubtype: PropTypes.oneOf(['cycle', 'jumprope']),
  size: PropTypes.oneOfType([PropTypes.number, PropTypes.string]),
  className: PropTypes.string
};

export default RpmDeviceAvatar;
```

**Step 4: Create the SCSS file**

Create: `frontend/src/modules/Fitness/FitnessSidebar/RealtimeCards/RpmDeviceAvatar.scss`

```scss
.rpm-device-avatar {
  --rpm-avatar-size: 64px;
  --rpm-zone-color: #666;
  --rpm-spin-duration: 0s;

  position: relative;
  width: var(--rpm-avatar-size);
  height: var(--rpm-avatar-size);

  .rpm-gauge {
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
  }

  .gauge-arc {
    stroke-width: 4;
    stroke-linecap: round;
    fill: none;
    transition: stroke 0.3s ease;
  }

  .gauge-arc-track {
    stroke: rgba(255, 255, 255, 0.15);
  }

  .gauge-arc-progress {
    transition: stroke-dashoffset 0.3s ease, stroke 0.3s ease;
  }

  .bottom-arc {
    stroke-width: 4;

    &.spinning {
      stroke-dasharray: 8 12;
      animation: rpm-spin var(--rpm-spin-duration) linear infinite;
      transform-origin: center;
    }

    &.pulsing {
      stroke-dasharray: none;
      transition: opacity 0.2s ease;
    }
  }

  &.is-pulsing .bottom-arc.pulsing {
    opacity: 1;
    stroke-width: 6;
  }

  &.is-idle {
    .gauge-arc-progress {
      opacity: 0.5;
    }
    .bottom-arc {
      opacity: 0.3;
    }
  }

  .avatar-core {
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    width: 70%;
    height: 70%;
    border-radius: 50%;
    overflow: hidden;
    background: #222;

    img {
      width: 100%;
      height: 100%;
      object-fit: cover;
    }
  }
}

@keyframes rpm-spin {
  from {
    transform: rotate(0deg);
  }
  to {
    transform: rotate(360deg);
  }
}
```

**Step 5: Commit**

```bash
git add tests/unit/fitness/rpm-device-avatar.unit.test.mjs
git add frontend/src/modules/Fitness/FitnessSidebar/RealtimeCards/RpmDeviceAvatar.jsx
git add frontend/src/modules/Fitness/FitnessSidebar/RealtimeCards/RpmDeviceAvatar.scss
git commit -m "feat(ui): create unified RpmDeviceAvatar gauge component"
```

---

## Task 3: Create Unified RpmDeviceCard Component

**Files:**
- Create: `frontend/src/modules/Fitness/FitnessSidebar/RealtimeCards/RpmDeviceCard.jsx`
- Create: `frontend/src/modules/Fitness/FitnessSidebar/RealtimeCards/RpmDeviceCard.scss`

**Step 1: Create the RpmDeviceCard component**

```jsx
/**
 * RpmDeviceCard - Unified realtime card for all RPM devices
 *
 * Handles both cycles (stationary_bike, ab_roller, cadence) and jumpropes
 * with configurable stats display and gauge-based avatar.
 */

import React from 'react';
import PropTypes from 'prop-types';
import RpmDeviceAvatar from './RpmDeviceAvatar.jsx';
import './RpmDeviceCard.scss';

const STALENESS_THRESHOLD_MS = 5000;

export function RpmDeviceCard({
  device,
  deviceName,
  equipmentId,
  rpmThresholds = {},
  deviceSubtype = 'cycle',
  showRevolutions = false,
  layoutMode = 'horizontal',
  zoneClass = '',
  isInactive = false,
  isCountdownActive = false,
  countdownWidth = 0,
}) {
  const isStale = device.timestamp && (Date.now() - device.timestamp > STALENESS_THRESHOLD_MS);

  const rpm = device.cadence ?? 0;
  const revolutions = device.revolutionCount ?? null;

  const rpmValue = isStale ? '--' : (Number.isFinite(rpm) && rpm > 0 ? `${Math.round(rpm)}` : '--');
  const revsValue = Number.isFinite(revolutions) ? `${Math.round(revolutions)}` : '--';

  const cardClasses = [
    'rpm-device-card',
    'fitness-device',
    layoutMode === 'vert' ? 'card-vertical' : 'card-horizontal',
    isInactive ? 'inactive' : 'active',
    isCountdownActive ? 'countdown-active' : '',
    isStale ? 'stale' : '',
    zoneClass
  ].filter(Boolean).join(' ');

  return (
    <div
      className={cardClasses}
      title={`${deviceName} - ${rpmValue} rpm${showRevolutions ? ` (${revsValue} total)` : ''}`}
    >
      {isCountdownActive && (
        <div className="device-timeout-bar" aria-label="Removal countdown" role="presentation">
          <div
            className="device-timeout-fill"
            style={{ width: `${Math.max(0, Math.min(100, countdownWidth))}%` }}
          />
        </div>
      )}

      <RpmDeviceAvatar
        equipmentId={equipmentId}
        equipmentName={deviceName}
        rpm={rpm}
        revolutionCount={revolutions}
        rpmThresholds={rpmThresholds}
        deviceSubtype={deviceSubtype}
        size={64}
      />

      <div className="device-info">
        <div className="device-name">{deviceName}</div>
        <div className="device-stats">
          <span className="device-value">{rpmValue}</span>
          <span className="device-unit">RPM</span>
          {showRevolutions && (
            <>
              <span className="device-value secondary">{revsValue}</span>
              <span className="device-unit secondary">total</span>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

RpmDeviceCard.propTypes = {
  device: PropTypes.object.isRequired,
  deviceName: PropTypes.string.isRequired,
  equipmentId: PropTypes.string.isRequired,
  rpmThresholds: PropTypes.shape({
    min: PropTypes.number,
    med: PropTypes.number,
    high: PropTypes.number,
    max: PropTypes.number
  }),
  deviceSubtype: PropTypes.oneOf(['cycle', 'jumprope']),
  showRevolutions: PropTypes.bool,
  layoutMode: PropTypes.oneOf(['horizontal', 'vert']),
  zoneClass: PropTypes.string,
  isInactive: PropTypes.bool,
  isCountdownActive: PropTypes.bool,
  countdownWidth: PropTypes.number
};

export default RpmDeviceCard;
```

**Step 2: Create the SCSS file**

```scss
.rpm-device-card {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px 12px;
  background: rgba(0, 0, 0, 0.4);
  border-radius: 8px;
  position: relative;

  &.card-horizontal {
    flex-direction: row;
  }

  &.card-vertical {
    flex-direction: column;
    text-align: center;
  }

  &.inactive {
    opacity: 0.5;
  }

  &.stale {
    opacity: 0.4;
  }

  .device-timeout-bar {
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    height: 3px;
    background: rgba(255, 255, 255, 0.1);
    border-radius: 8px 8px 0 0;
    overflow: hidden;

    .device-timeout-fill {
      height: 100%;
      background: #ff6b6b;
      transition: width 0.5s linear;
    }
  }

  .device-info {
    display: flex;
    flex-direction: column;
    gap: 4px;

    .device-name {
      font-weight: 600;
      font-size: 14px;
      color: #fff;
    }

    .device-stats {
      display: flex;
      align-items: baseline;
      gap: 4px;
      flex-wrap: wrap;

      .device-value {
        font-size: 20px;
        font-weight: 700;
        color: #fff;

        &.secondary {
          font-size: 14px;
          font-weight: 500;
          opacity: 0.7;
          margin-left: 8px;
        }
      }

      .device-unit {
        font-size: 11px;
        color: rgba(255, 255, 255, 0.6);
        text-transform: uppercase;

        &.secondary {
          opacity: 0.5;
        }
      }
    }
  }
}
```

**Step 3: Commit**

```bash
git add frontend/src/modules/Fitness/FitnessSidebar/RealtimeCards/RpmDeviceCard.jsx
git add frontend/src/modules/Fitness/FitnessSidebar/RealtimeCards/RpmDeviceCard.scss
git commit -m "feat(ui): create unified RpmDeviceCard component"
```

---

## Task 4: Update Card Registry

**Files:**
- Modify: `frontend/src/modules/Fitness/FitnessSidebar/RealtimeCards/index.js`

**Step 1: Update registry to use RpmDeviceCard**

```javascript
/**
 * RealtimeCards Registry
 */

import { PersonCard } from './PersonCard.jsx';
import { RpmDeviceCard } from './RpmDeviceCard.jsx';
import { VibrationCard } from './VibrationCard.jsx';
import { BaseRealtimeCard, StatsRow } from './BaseRealtimeCard.jsx';
import RpmDeviceAvatar, { calculateRpmProgress, getRpmZoneColor } from './RpmDeviceAvatar.jsx';

// Legacy imports for backward compatibility during transition
import { CadenceCard } from './CadenceCard.jsx';
import { JumpropeCard } from './JumpropeCard.jsx';
import JumpropeAvatar from './JumpropeAvatar.jsx';

const CARD_REGISTRY = {
  // People (heart rate monitors)
  heart_rate: PersonCard,

  // Equipment - RPM-based (unified)
  cadence: RpmDeviceCard,
  stationary_bike: RpmDeviceCard,
  ab_roller: RpmDeviceCard,
  jumprope: RpmDeviceCard,

  // Equipment - Vibration-based
  vibration: VibrationCard,
  punching_bag: VibrationCard,
  step_platform: VibrationCard,
  pull_up_bar: VibrationCard,
};

export function getCardComponent(deviceType) {
  return CARD_REGISTRY[deviceType] || null;
}

export function hasCard(deviceType) {
  return deviceType in CARD_REGISTRY;
}

export function getRegisteredTypes() {
  return Object.keys(CARD_REGISTRY);
}

export function registerCard(deviceType, component) {
  CARD_REGISTRY[deviceType] = component;
}

// Named exports
export {
  PersonCard,
  RpmDeviceCard,
  RpmDeviceAvatar,
  calculateRpmProgress,
  getRpmZoneColor,
  VibrationCard,
  BaseRealtimeCard,
  StatsRow,
  // Legacy exports
  CadenceCard,
  JumpropeCard,
  JumpropeAvatar
};

export default {
  getCardComponent,
  hasCard,
  getRegisteredTypes,
  registerCard,
  PersonCard,
  RpmDeviceCard,
  RpmDeviceAvatar,
  VibrationCard,
  BaseRealtimeCard,
  StatsRow
};
```

**Step 2: Commit**

```bash
git add frontend/src/modules/Fitness/FitnessSidebar/RealtimeCards/index.js
git commit -m "feat(registry): update card registry to use unified RpmDeviceCard"
```

---

## Task 5: Update FitnessUsers Sorting Logic

**Files:**
- Modify: `frontend/src/modules/Fitness/FitnessSidebar/FitnessUsers.jsx`

**Step 1: Import calculateRpmProgress**

Add to imports at top of file:

```javascript
import { RpmDeviceCard, calculateRpmProgress } from './RealtimeCards';
```

**Step 2: Update equipmentMap to include showRevolutions**

Find the `equipmentMap` useMemo (around line 480) and update:

```javascript
const equipmentMap = React.useMemo(() => {
  const map = {};
  if (Array.isArray(equipment)) {
    equipment.forEach(e => {
      const entry = {
        name: e.name,
        id: e.id || e.name.toLowerCase(),
        type: e.type,
        showRevolutions: e.showRevolutions ?? (e.type === 'jumprope')
      };
      if (e?.rpm) {
        entry.rpm = e.rpm;
      }
      if (e?.cadence) {
        map[String(e.cadence)] = entry;
      }
      if (e?.speed) {
        map[String(e.speed)] = entry;
      }
      if (e?.ble) {
        map[String(e.ble)] = entry;
      }
    });
  }
  return map;
}, [equipment]);
```

**Step 3: Update sorting to use rpmProgress**

Find the useEffect with device sorting (around line 644) and replace the cadence and jump sorting blocks:

```javascript
useEffect(() => {
  const hrDevices = allDevices.filter(d => d.type === 'heart_rate');
  // Combine cadence and jumprope into single RPM group
  const rpmDevices = allDevices.filter(d =>
    d.type === 'cadence' || d.type === 'stationary_bike' ||
    d.type === 'ab_roller' || d.type === 'jumprope'
  );
  const otherDevices = allDevices.filter(d =>
    d.type !== 'heart_rate' && d.type !== 'cadence' &&
    d.type !== 'stationary_bike' && d.type !== 'ab_roller' &&
    d.type !== 'jumprope'
  );

  // HR: Sort by zone rank, then by zone progress (not raw HR)
  hrDevices.sort((a, b) => {
    const aZone = getDeviceZoneId(a);
    const bZone = getDeviceZoneId(b);
    const aRank = aZone ? zoneRankMap[aZone] : -1;
    const bRank = bZone ? zoneRankMap[bZone] : -1;
    if (bRank !== aRank) return bRank - aRank;

    // Secondary sort: zone progress (normalized within zone)
    const aName = resolveCanonicalUserName(a.deviceId);
    const bName = resolveCanonicalUserName(b.deviceId);
    const aProgress = lookupZoneProgress(aName)?.progress ?? 0;
    const bProgress = lookupZoneProgress(bName)?.progress ?? 0;
    if (bProgress !== aProgress) return bProgress - aProgress;

    if (a.isActive && !b.isActive) return -1;
    if (!a.isActive && b.isActive) return 1;
    return String(a.deviceId).localeCompare(String(b.deviceId));
  });

  // RPM: Sort by rpmProgress (% toward max) descending
  rpmDevices.sort((a, b) => {
    if (a.isActive && !b.isActive) return -1;
    if (!a.isActive && b.isActive) return 1;

    const aEquip = equipmentMap[String(a.deviceId)] || {};
    const bEquip = equipmentMap[String(b.deviceId)] || {};
    const aThresholds = aEquip.rpm || { min: 0, max: 100 };
    const bThresholds = bEquip.rpm || { min: 0, max: 100 };
    const aRpm = a.cadence || 0;
    const bRpm = b.cadence || 0;
    const aProgress = calculateRpmProgress(aRpm, aThresholds);
    const bProgress = calculateRpmProgress(bRpm, bThresholds);

    return bProgress - aProgress;
  });

  otherDevices.sort((a, b) => {
    const typeOrder = CONFIG.sorting.otherTypeOrder;
    const fallback = typeOrder.unknown || 3;
    const typeA = typeOrder[a.type] || fallback;
    const typeB = typeOrder[b.type] || fallback;
    if (typeA !== typeB) return typeA - typeB;
    if (a.isActive && !b.isActive) return -1;
    if (!a.isActive && b.isActive) return 1;
    const valueA = a.power || (a.speedKmh || 0);
    const valueB = b.power || (b.speedKmh || 0);
    return valueB - valueA;
  });

  const combined = [...hrDevices];
  // Single unified RPM group
  if (rpmDevices.length > 0) {
    combined.push({ type: 'rpm-group', devices: rpmDevices });
  }
  combined.push(...otherDevices);
  setSortedDevices(combined);
}, [allDevices, equipmentMap, resolveCanonicalUserName, lookupZoneProgress]);
```

**Step 4: Update rpm-group rendering**

Find the `rpm-group` rendering block (around line 816) and update to use RpmDeviceCard:

```javascript
if (device.type === 'rpm-group') {
  const rpmDevices = device.devices;
  const isMultiDevice = rpmDevices.length > 1;

  return (
    <div
      key="rpm-group"
      ref={rpmGroupRef}
      className={`rpm-group-container ${isMultiDevice ? 'multi-device' : 'single-device'}`}
      style={{
        transform: `scale(${rpmScale})`,
        transformOrigin: 'left center'
      }}
    >
      <div className={`rpm-devices devicecount_${rpmDevices.length}`}>
        {rpmDevices.map(rpmDevice => {
          const equipmentInfo = equipmentMap[String(rpmDevice.deviceId)];
          const deviceName = equipmentInfo?.name || String(rpmDevice.deviceId);
          const equipmentId = equipmentInfo?.id || String(rpmDevice.deviceId);
          const rpmThresholds = equipmentInfo?.rpm || { min: 30, med: 60, high: 80, max: 100 };
          const deviceSubtype = rpmDevice.type === 'jumprope' ? 'jumprope' : 'cycle';
          const showRevolutions = equipmentInfo?.showRevolutions ?? (rpmDevice.type === 'jumprope');
          const isInactive = rpmDevice.isActive === false || !!rpmDevice.inactiveSince;

          return (
            <RpmDeviceCard
              key={`rpm-${rpmDevice.deviceId}`}
              device={rpmDevice}
              deviceName={deviceName}
              equipmentId={equipmentId}
              rpmThresholds={rpmThresholds}
              deviceSubtype={deviceSubtype}
              showRevolutions={showRevolutions}
              isInactive={isInactive}
            />
          );
        })}
      </div>
    </div>
  );
}
```

**Step 5: Remove the separate jump-group rendering**

Delete the entire `if (device.type === 'jump-group')` block (around lines 865-892) since jumpropes are now in the rpm-group.

**Step 6: Commit**

```bash
git add frontend/src/modules/Fitness/FitnessSidebar/FitnessUsers.jsx
git commit -m "feat(sorting): implement progress-based sorting for RPM and HR devices"
```

---

## Task 6: Update FullscreenVitalsOverlay

**Files:**
- Modify: `frontend/src/modules/Fitness/FitnessPlayerOverlay/FullscreenVitalsOverlay.jsx`

**Step 1: Replace JumpropeAvatar import with RpmDeviceAvatar**

```javascript
import RpmDeviceAvatar, { calculateRpmProgress, getRpmZoneColor } from '../FitnessSidebar/RealtimeCards/RpmDeviceAvatar.jsx';
// Remove: import JumpropeAvatar from '../FitnessSidebar/RealtimeCards/JumpropeAvatar.jsx';
```

**Step 2: Merge jumpropeItems into rpmItems**

Update the `rpmItems` useMemo to include jumpropes:

```javascript
const rpmItems = useMemo(() => {
  const cadenceConfig = deviceConfiguration?.cadence || {};
  const allRpmDevices = [
    ...(Array.isArray(cadenceDevices) ? cadenceDevices : []),
    ...(Array.isArray(jumpropeDevices) ? jumpropeDevices : [])
  ].filter((device) => device && device.deviceId != null);

  return allRpmDevices.map((device) => {
    const isJumprope = jumpropeDevices?.some(j => j.deviceId === device.deviceId);
    const equipmentConfig = isJumprope
      ? equipment.find(e => e.ble === device.deviceId)
      : equipmentMap[String(device.deviceId)];
    const equipmentId = equipmentConfig?.id || String(device.deviceId);
    const rpmThresholds = equipmentConfig?.rpm || { min: 30, med: 60, high: 80, max: 100 };
    const rpm = Math.max(0, Math.round(device.cadence || 0));

    return {
      deviceId: device.deviceId,
      rpm,
      equipmentId,
      rpmThresholds,
      deviceSubtype: isJumprope ? 'jumprope' : 'cycle',
      revolutionCount: device.revolutionCount ?? 0
    };
  }).sort((a, b) => {
    const aProgress = calculateRpmProgress(a.rpm, a.rpmThresholds);
    const bProgress = calculateRpmProgress(b.rpm, b.rpmThresholds);
    return bProgress - aProgress;
  });
}, [cadenceDevices, jumpropeDevices, equipmentMap, equipment, deviceConfiguration?.cadence]);
```

**Step 3: Update the JSX to use unified rendering**

Remove the separate `jumpropeItems` section and update the rpm-group rendering:

```jsx
{rpmItems.length > 0 && (
  <div className={`fullscreen-vitals-group rpm-group count-${rpmItems.length}`}>
    {rpmItems.map((item) => (
      <div key={`rpm-${item.deviceId}`} className="fullscreen-rpm-item">
        <RpmDeviceAvatar
          equipmentId={item.equipmentId}
          equipmentName=""
          rpm={item.rpm}
          revolutionCount={item.revolutionCount}
          rpmThresholds={item.rpmThresholds}
          deviceSubtype={item.deviceSubtype}
          size={68}
        />
        <div className="rpm-value-overlay">
          <span className="rpm-value">{item.rpm}</span>
        </div>
      </div>
    ))}
  </div>
)}
```

**Step 4: Remove jumpropeItems useMemo and JSX**

Delete the `jumpropeItems` useMemo block and the `{jumpropeItems.length > 0 && ...}` JSX block.

**Step 5: Commit**

```bash
git add frontend/src/modules/Fitness/FitnessPlayerOverlay/FullscreenVitalsOverlay.jsx
git commit -m "feat(overlay): unify RPM device display in fullscreen overlay"
```

---

## Task 7: Clean Up Legacy Files

**Files:**
- Delete: `frontend/src/modules/Fitness/FitnessSidebar/RealtimeCards/CadenceCard.jsx`
- Delete: `frontend/src/modules/Fitness/FitnessSidebar/RealtimeCards/JumpropeCard.jsx`
- Delete: `frontend/src/modules/Fitness/FitnessSidebar/RealtimeCards/JumpropeAvatar.jsx`
- Delete: `frontend/src/modules/Fitness/FitnessSidebar/RealtimeCards/JumpropeCard.scss`
- Delete: `frontend/src/modules/Fitness/FitnessSidebar/RealtimeCards/JumpropeAvatar.scss`

**Step 1: Verify no remaining imports**

Run: `grep -r "CadenceCard\|JumpropeCard\|JumpropeAvatar" frontend/src --include="*.jsx" --include="*.js"`

Should only show the index.js legacy exports.

**Step 2: Remove legacy exports from index.js**

Update `frontend/src/modules/Fitness/FitnessSidebar/RealtimeCards/index.js`:

```javascript
// Remove legacy imports and exports
// Remove: import { CadenceCard } from './CadenceCard.jsx';
// Remove: import { JumpropeCard } from './JumpropeCard.jsx';
// Remove: import JumpropeAvatar from './JumpropeAvatar.jsx';
```

**Step 3: Delete the files**

```bash
rm frontend/src/modules/Fitness/FitnessSidebar/RealtimeCards/CadenceCard.jsx
rm frontend/src/modules/Fitness/FitnessSidebar/RealtimeCards/JumpropeCard.jsx
rm frontend/src/modules/Fitness/FitnessSidebar/RealtimeCards/JumpropeAvatar.jsx
rm frontend/src/modules/Fitness/FitnessSidebar/RealtimeCards/JumpropeCard.scss
rm frontend/src/modules/Fitness/FitnessSidebar/RealtimeCards/JumpropeAvatar.scss
```

**Step 4: Commit**

```bash
git add -A frontend/src/modules/Fitness/FitnessSidebar/RealtimeCards/
git commit -m "chore: remove legacy CadenceCard, JumpropeCard, JumpropeAvatar"
```

---

## Task 8: Integration Testing

**Step 1: Start dev server**

Run: `npm run dev`

**Step 2: Manual verification checklist**

- [ ] Connect a bike device - verify gauge avatar appears with top arc progress
- [ ] Connect jump rope - verify gauge avatar appears with pulsing bottom arc
- [ ] Both devices show RPM value
- [ ] Jump rope shows revolution count (bikes don't unless configured)
- [ ] Devices sort by progress % (highest first)
- [ ] Full-screen overlay shows unified RPM avatars
- [ ] Clicking overlay toggles anchor position

**Step 3: Run existing tests**

Run: `npm test`

**Step 4: Final commit**

```bash
git commit -m "test: verify RPM device consolidation"
```

---

## Summary

| Task | Description | Files Changed |
|------|-------------|---------------|
| 1 | Add RPM thresholds to config | config.yml |
| 2 | Create RpmDeviceAvatar | RpmDeviceAvatar.jsx, .scss, test |
| 3 | Create RpmDeviceCard | RpmDeviceCard.jsx, .scss |
| 4 | Update card registry | index.js |
| 5 | Update sorting logic | FitnessUsers.jsx |
| 6 | Update fullscreen overlay | FullscreenVitalsOverlay.jsx |
| 7 | Clean up legacy files | Delete 5 files |
| 8 | Integration testing | Manual verification |
