# Bug Report: FHE Menu Item Fails to Open Submenu in Dev

**Date Discovered:** 2026-01-22  
**Severity:** High  
**Status:** Open  
**Component:** Frontend - TV App / Menu Navigation  
**Test File:** `tests/runtime/tv-app/fhe-menu-comparison.mjs`

---

## Summary

When selecting the "FHE" menu item from the TV app, the expected submenu (containing 9 items) fails to open in local development. Instead, a Player component is loaded with a perpetual loading spinner.

Production correctly opens the submenu.

---

## Steps to Reproduce

### Manual Testing
1. Navigate to http://localhost:3111/tv
2. Use arrow keys to navigate to "FHE" (row 1, col 2, index 7)
3. Press Enter to select

**Expected:** Submenu opens showing 9 child items  
**Actual:** Loading spinner appears, Player component loaded, no submenu

### Automated Testing
```bash
cd /Users/kckern/Documents/GitHub/DaylightStation
node tests/runtime/tv-app/fhe-menu-comparison.mjs
```

---

## Comparison Data

| Metric | Localhost (Bug) | Production (Working) |
|--------|-----------------|---------------------|
| **Submenu Items** | 0 ❌ | 9 ✅ |
| **Player Components** | 1 ❌ | 0 ✅ |
| **Video Elements** | 0 | 0 |
| **Loading Spinners** | 6 ❌ (visible) | 0 ✅ |

---

## Expected Behavior (Production ✅)

```
After selecting FHE:
  - Submenu items: 9 ✅
  - Player components: 0 ✅
  - Loading spinner: Hidden ✅
  - Result: Submenu opens with FHE content choices
```

---

## Actual Behavior (Localhost ❌)

```
After selecting FHE:
  - Submenu items: 0 ❌
  - Player components: 1 ❌ (should be 0)
  - Loading spinner: 6 visible ❌ (stuck)
  - Result: Player trying to play folder metadata
```

---

## Root Cause Analysis

The TV app is incorrectly routing folder/collection data to the Player component instead of rendering a submenu. When a folder is selected:

1. **Production**: Recognizes it as a folder → Opens submenu with 9 items
2. **Localhost**: Treats it as playable media → Passes to Player → Player shows spinner

This indicates a difference in how the menu system determines whether an item should open a submenu or start playback.

---

## Affected Code (Suspected)

| File | Issue |
|------|-------|
| `frontend/src/modules/Menu/Menu.jsx` | Item type detection differs from production |
| `frontend/src/modules/TVApp/TVApp.jsx` | Selection routing logic |
| Backend list endpoint | May return different data structure for folders |

---

## Environment

- **OS:** macOS
- **Local Dev Port:** 3111
- **Production:** https://daylightlocal.kckern.net

---

## Related Issues

- Same root cause as Bible Project bug
- Same root cause as The Chosen bug (but manifests differently)
- Part of broader "folder metadata to Player" issue

---

## Workaround

None. FHE content cannot be accessed on localhost.

---

## Test Output Location

- `/tmp/fhe-test-output.log`
- `/tmp/multi-item-test.log`
