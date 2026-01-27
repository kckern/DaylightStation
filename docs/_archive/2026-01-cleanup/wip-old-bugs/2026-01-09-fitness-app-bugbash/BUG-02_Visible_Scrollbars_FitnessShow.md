# BUG-02: Visible Scroll Bars on Fitness Show

**Date Reported:** 2026-01-09  
**Category:** 🎨 UI, Styling, & Animation  
**Priority:** High  
**Status:** ✅ Fixed

---

## Summary

A scroll bar is visible on the right side of the "Fitness Show" panel, violating the touch-first interface design requirement.

## Expected Behavior

Scroll bars should never be visible anywhere in the application. This is a strictly touch-interface device; scrolling is handled via touch-drag logic.

## Current Behavior

Visible scrollbar appears on the right side of the Fitness Show panel, likely in the episodes container or show description areas.

---

## Technical Analysis

### Relevant Files

| File | Purpose |
|------|---------|
| [`FitnessShow.scss`](file:///Users/kckern/Documents/GitHub/DaylightStation/frontend/src/modules/Fitness/FitnessShow.scss) | Main styling for Fitness Show view |
| [`FitnessShow.jsx`](file:///Users/kckern/Documents/GitHub/DaylightStation/frontend/src/modules/Fitness/FitnessShow.jsx) | Fitness Show component |

### Root Cause Identification

In `FitnessShow.scss`, multiple elements have `overflow-y: auto` without scrollbar hiding:

**Line 107**: `.episode-info`
```scss
.episode-info {
  display: flex;
  flex-direction: column;
  gap: 1rem;
  overflow-y: auto;  // ⚠️ No scrollbar hiding
  padding-right: 0.5rem;
}
```

**Line 225**: `.season-info`
```scss
.season-info {
  display: flex;
  flex-direction: column;
  gap: 1rem;
  height: 100%;
  overflow-y: auto;  // ⚠️ No scrollbar hiding
  padding-right: 0.5rem;
}
```

**Line 294**: `.show-description`
```scss
.show-description {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;  // ⚠️ No scrollbar hiding
  // ... rest of styles
}
```

**Line 493**: `.episodes-container`
```scss
.episodes-container {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;  // ⚠️ No scrollbar hiding - MOST LIKELY CULPRIT
  display: flex;
  flex-direction: column;
  gap: 2ex;
}
```

### Existing Scrollbar Hide Pattern

The codebase already has a scrollbar-hide mixin in `shared/styles/_mixins.scss`:

```scss
@mixin scrollbar-hide {
  -ms-overflow-style: none;
  scrollbar-width: none;
  &::-webkit-scrollbar {
    display: none;
  }
}
```

---

## Recommended Fix

### Option A: Apply Mixin to All Scrollable Areas (Preferred)

Add the scrollbar-hide mixin to all overflow areas in `FitnessShow.scss`:

```scss
@import '../shared/styles/_mixins.scss';

.episode-info {
  overflow-y: auto;
  @include scrollbar-hide;  // ADD THIS
}

.season-info {
  overflow-y: auto;
  @include scrollbar-hide;  // ADD THIS
}

.show-description {
  overflow-y: auto;
  @include scrollbar-hide;  // ADD THIS
}

.episodes-container {
  overflow-y: auto;
  @include scrollbar-hide;  // ADD THIS
}
```

### Option B: Global Application

Add global scrollbar hiding to the root Fitness App styles:

```scss
// In FitnessApp.scss or a global _base.scss
.fitness-app {
  * {
    -ms-overflow-style: none;
    scrollbar-width: none;
    &::-webkit-scrollbar {
      display: none;
    }
  }
}
```

> [!CAUTION]
> Option B is broader but may have unintended side effects. Option A is more targeted and safer.

---

## Files to Modify

1. **Primary**: [`FitnessShow.scss`](file:///Users/kckern/Documents/GitHub/DaylightStation/frontend/src/modules/Fitness/FitnessShow.scss) - Add `@include scrollbar-hide` to:
   - Line ~107 (`.episode-info`)
   - Line ~225 (`.season-info`)
   - Line ~294 (`.show-description`)
   - Line ~493 (`.episodes-container`)

2. **Optional**: Review and apply to any other touch-interface panels globally

---

## Verification Steps

1. Open Fitness App
2. Navigate to any show with multiple seasons/episodes
3. Verify no scrollbar is visible on any panel
4. Scroll with touch/drag to confirm scrolling still works
5. Check on both horizontal and vertical orientations

---

## Related Components

These files already implement proper scrollbar hiding (for reference):

- [`FullScreenContainer.scss:66`](file:///Users/kckern/Documents/GitHub/DaylightStation/frontend/src/modules/Fitness/shared/containers/FullScreenContainer/FullScreenContainer.scss#L66) - Uses `@include scrollbar-hide`
- [`VoiceMemoOverlay.scss:125`](file:///Users/kckern/Documents/GitHub/DaylightStation/frontend/src/modules/Fitness/FitnessPlayerOverlay/VoiceMemoOverlay.scss#L125) - Hides webkit scrollbar

---

*For testing, assign to: QA Team*  
*For development, assign to: Frontend Team (CSS fix)*
