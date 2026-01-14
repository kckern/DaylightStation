# BUG-01: RPM Device Styling Inconsistency in Sidebar

**Date Reported:** 2026-01-09  
**Category:** 🎨 UI, Styling, & Animation  
**Priority:** Medium  
**Status:** ✅ Fixed

---

## Summary

RPM (cadence/power) devices render correctly in Fullscreen view but appear broken when rendered inside the Sidebar.

## Expected Behavior

The Sidebar view should share the exact same styling as the Fullscreen view. While the scale/size can differ, the visual elements and CSS styling must be identical.

## Current Behavior

RPM devices look "terrible" when rendered inside the Sidebar, indicating significant styling discrepancies between the two view contexts.

---

## Technical Analysis

### Relevant Components

| File | Purpose |
|------|---------|
| [`SidebarFooter.jsx`](file:///Users/kckern/Documents/GitHub/DaylightStation/frontend/src/modules/Fitness/SidebarFooter.jsx) | Renders device cards in sidebar footer |
| [`SidebarFooter.scss`](file:///Users/kckern/Documents/GitHub/DaylightStation/frontend/src/modules/Fitness/SidebarFooter.scss) | Sidebar footer styling |
| [`FullscreenVitalsOverlay.jsx`](file:///Users/kckern/Documents/GitHub/DaylightStation/frontend/src/modules/Fitness/FitnessPlayerOverlay/FullscreenVitalsOverlay.jsx) | Fullscreen vitals display |
| [`FullscreenVitalsOverlay.scss`](file:///Users/kckern/Documents/GitHub/DaylightStation/frontend/src/modules/Fitness/FitnessPlayerOverlay/FullscreenVitalsOverlay.scss) | Fullscreen vitals styling |

### Root Cause Hypothesis

1. **Separate Style Definitions**: The Sidebar and Fullscreen views likely use completely different CSS class structures rather than sharing base styles with size modifiers.

2. **Context-Specific Overrides**: The `SidebarFooter.scss` may have overrides that don't properly handle RPM device rendering.

3. **Component Divergence**: The components may have evolved separately without maintaining parity.

### Key Styling Differences to Investigate

In `SidebarFooter.scss`:
- `.device-card` class with circular avatar presentation
- Limited styling for device-specific icons (RPM, HR)
- No animation for RPM spinning indicators

In `FullscreenVitalsOverlay.scss`:
- `.fullscreen-vitals-group.rpm-group` with specialized styling
- RPM spin animation: `@keyframes fullscreen-rpm-spin`
- Proper handling of RPM indicators with spin duration variables

---

## Recommended Fix

### Option A: Share Base Components (Preferred)

Create a shared device rendering component that both views can use:

```jsx
// Create: shared/components/DeviceVitalsCard.jsx
const DeviceVitalsCard = ({ device, size = 'default' }) => {
  // Single source of truth for device rendering
  const sizeClass = `device-card--${size}`;
  // ... shared rendering logic
};
```

### Option B: CSS Unification

1. Extract RPM-specific styles from `FullscreenVitalsOverlay.scss` into a shared mixin or base class
2. Apply the same animation (`fullscreen-rpm-spin`) to sidebar RPM devices
3. Ensure spin duration variable (`--spin-duration`) is passed correctly in sidebar context

### Files to Modify

1. `SidebarFooter.jsx` - Import shared styling/components
2. `SidebarFooter.scss` - Add RPM-specific styling matching fullscreen
3. Consider creating a shared `_device-vitals.scss` partial

---

## Verification Steps

1. Open Fitness App with active RPM device (e.g., bike with cadence sensor)
2. Compare sidebar view during session
3. Switch to fullscreen mode and compare
4. Verify visual parity (animations, colors, layout) at different sizes

---

## Related Files

- [`FitnessPlayer.jsx:1375-1410`](file:///Users/kckern/Documents/GitHub/DaylightStation/frontend/src/modules/Fitness/FitnessPlayer.jsx#L1375-L1410) - Fullscreen vitals overlay rendering
- [`SidebarFooter.jsx:185-189`](file:///Users/kckern/Documents/GitHub/DaylightStation/frontend/src/modules/Fitness/SidebarFooter.jsx#L185-L189) - Zone class helper

---

*For testing, assign to: UI/UX Team*  
*For development, assign to: Frontend Team*
