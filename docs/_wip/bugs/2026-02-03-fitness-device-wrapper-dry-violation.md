# DRY Violation: Duplicate device-wrapper Implementation

**Date:** 2026-02-03  
**Status:** Open  
**Priority:** Medium (Technical Debt)  
**Component:** Frontend - Fitness Sidebar  
**Type:** Code Quality / Refactoring

---

## Summary

The `device-wrapper` structure and its associated layout logic is duplicated between two files:
1. `BaseRealtimeCard.jsx` - Intended as a shared layout wrapper component
2. `FitnessUsers.jsx` - Contains its own inline implementation

This violates the DRY (Don't Repeat Yourself) principle and creates maintenance burden.

---

## Affected Files

### Primary Files
- `frontend/src/modules/Fitness/FitnessSidebar/RealtimeCards/BaseRealtimeCard.jsx`
- `frontend/src/modules/Fitness/FitnessSidebar/FitnessUsers.jsx` (line 977+)

---

## Issue Details

### Current State

**BaseRealtimeCard.jsx** was created as a shared layout wrapper (per its header documentation):
```
/**
 * BaseRealtimeCard - Shared layout wrapper for all realtime fitness cards
 * 
 * Provides consistent structure for:
 * - Timeout/countdown bar
 * - Profile image container
 * - Info section (name, stats)
 * - Zone badge (optional)
 * - Progress bar (optional)
 */
```

However, **FitnessUsers.jsx** still contains its own implementation of this structure (starting at line 977):
```jsx
<div className="device-wrapper" key={`device-${device.deviceId}`}>
  <div className={`device-zone-info ${zoneClass} ...`}>
    {showZoneBadge && (...)}
  </div>
  <div className={`fitness-device ${isHeartRate ? 'clickable' : ''} ...`}>
    {isCountdownActive && (<div className="device-timeout-bar">...)}
    <div className={`card-avatar ${zoneClass}`}>...</div>
    <div className="device-info">...</div>
    {isHeartRate && shouldShowProgressBar && (<div className="zone-progress-bar">...)}
  </div>
</div>
```

Both implementations provide identical functionality:
- `device-wrapper` container
- Zone badge display (`device-zone-info`)
- Main card (`fitness-device`)
- Countdown/timeout bar
- Avatar with fallback handling
- Device info section
- Optional progress bar

---

## Impact

### Code Maintenance
- Changes to card structure must be made in two places
- Styling updates require duplicate effort
- Bug fixes need to be applied twice
- Inconsistent behavior risk between implementations

### Technical Debt
- Violates established component architecture
- Defeats the purpose of creating BaseRealtimeCard
- Increases codebase complexity
- Makes future enhancements harder

### Risk Level: Medium
- Currently not causing bugs
- Creates maintenance burden
- Could lead to divergent implementations over time

---

## Root Cause

FitnessUsers.jsx was written before BaseRealtimeCard.jsx was created, and was never refactored to use the shared component. The inline implementation predates the abstraction.

---

## Recommended Solution

### Refactor FitnessUsers.jsx to use BaseRealtimeCard

Replace the inline device-wrapper implementation with BaseRealtimeCard component:

```jsx
import { BaseRealtimeCard, StatsRow } from './RealtimeCards/BaseRealtimeCard';

// In the render section:
return (
  <BaseRealtimeCard
    device={device}
    deviceName={deviceName}
    layoutMode={layoutMode === 'vert' ? 'vertical' : 'horizontal'}
    zoneClass={zoneClass}
    isInactive={isInactive}
    isCountdownActive={isCountdownActive}
    countdownWidth={countdownWidth}
    imageSrc={DaylightMediaPath(`/static/img/users/${profileId}`)}
    imageAlt={`${deviceName} profile`}
    imageFallback={DaylightMediaPath('/static/img/users/user')}
    onClick={isHeartRate ? () => handleAvatarClick(device) : undefined}
    isClickable={isHeartRate}
    ariaLabel={isHeartRate ? `Reassign ${deviceName}` : undefined}
    zoneBadge={showZoneBadge && <Badge ...>{readableZone}</Badge>}
    progressBar={isHeartRate && shouldShowProgressBar && <div className="zone-progress-bar">...</div>}
  >
    <StatsRow
      icon={getDeviceIcon(device)}
      value={deviceValue}
      unit={getDeviceUnit(device)}
    />
  </BaseRealtimeCard>
);
```

### Benefits
- Single source of truth for card layout
- Consistent styling and behavior
- Easier to maintain and enhance
- Reduced code duplication
- Honors original design intent

---

## Testing Requirements

After refactoring:
1. Verify all device types render correctly (heart_rate, power, cadence, speed, jumprope)
2. Confirm zone badges display properly
3. Test countdown animations
4. Verify click handlers work for heart rate devices
5. Confirm progress bars animate correctly
6. Test vertical vs horizontal layout modes
7. Verify image fallbacks work
8. Check responsive scaling behavior

---

## Related Code

- `frontend/src/modules/Fitness/FitnessSidebar/FitnessSidebar.scss` - Shared styles
- `frontend/src/modules/Fitness/FitnessSidebar/RealtimeCards/` - Card component directory
- `frontend/src/modules/Fitness/FitnessSidebar/FitnessUsers.jsx` - Main user list component

---

## Notes

- This refactoring should be done carefully to avoid breaking existing functionality
- Consider creating a feature flag to toggle between implementations during migration
- May need to extend BaseRealtimeCard props to support all FitnessUsers.jsx use cases
- The RPM group rendering is separate and doesn't need this refactoring

---

## References

- Original analysis conversation: 2026-02-03
- BaseRealtimeCard was designed as shared component but never adopted by FitnessUsers.jsx
