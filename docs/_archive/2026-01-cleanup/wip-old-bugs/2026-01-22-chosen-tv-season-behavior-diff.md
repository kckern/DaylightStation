# Bug Report: The Chosen (TV Season) Behavior Differs Between Dev and Prod

**Date Discovered:** 2026-01-22  
**Severity:** Medium  
**Status:** Open / Under Investigation  
**Component:** Frontend - TV App / Player  
**Test File:** `tests/runtime/tv-app/multi-item-bug-investigation.mjs`

---

## Summary

When selecting "Chosen" (The Chosen TV series) from the TV app menu, the behavior differs between localhost and production:

- **Localhost:** Immediately loads video player with content
- **Production:** Shows nothing (0 player, 0 video, 0 submenu)

This is an inverted behavior pattern compared to other bugs - localhost appears to "work" while production does nothing.

---

## Steps to Reproduce

### Manual Testing
1. Navigate to http://localhost:3111/tv
2. Use arrow keys to navigate to "Chosen" (index 33)
3. Press Enter to select

### Production Testing
1. Navigate to https://daylightlocal.kckern.net/tv
2. Navigate to "Chosen" (index 23)
3. Press Enter to select

### Automated Testing
```bash
cd /Users/kckern/Documents/GitHub/DaylightStation
node tests/runtime/tv-app/multi-item-bug-investigation.mjs
```

---

## Comparison Data

| Metric | Localhost | Production |
|--------|-----------|------------|
| **Submenu Items** | 0 | 0 |
| **Player Components** | 2 | 0 |
| **Video Elements** | 1 ✅ | 0 |
| **Audio Elements** | 0 | 0 |
| **Loading Spinners** | 0 | 0 |

---

## Behavior Analysis

### Localhost Behavior
```
After selecting "Chosen":
  - Submenu items: 0
  - Player components: 2
  - Video elements: 1 (video loaded and ready)
  - Loading: 0
  - Result: Video player appears, starts playing first episode
```

### Production Behavior
```
After selecting "Chosen":
  - Submenu items: 0
  - Player components: 0
  - Video elements: 0
  - Loading: 0
  - Result: Nothing visible (unclear state)
```

---

## Analysis

This bug is unusual because it's the opposite of the FHE bug:

| Item | Localhost | Production | Expected |
|------|-----------|------------|----------|
| FHE (Folder) | Shows spinner ❌ | Opens submenu ✅ | Open submenu |
| Chosen (Season) | Plays video ⚠️ | Nothing ❓ | ? |

### Possible Explanations

1. **Different menu configurations**: Production may not have "Chosen" configured the same way
2. **Season vs Episode handling**: TV seasons may need to show episode list first
3. **Auto-play vs submenu**: Localhost may auto-play while production expects submenu
4. **Data availability**: Production may be missing the actual video files

---

## Questions to Investigate

1. What is the expected behavior for TV seasons - show episode list or auto-play?
2. Why does production show nothing at all (no submenu, no player)?
3. Is the "Chosen" entry configured the same way in both environments?
4. Is localhost auto-playing the correct first episode?

---

## Environment

- **OS:** macOS
- **Local Dev Port:** 3111
- **Production:** https://daylightlocal.kckern.net

---

## Test Output Location

- `/tmp/multi-item-test.log`

---

## Notes

This may not be a bug in the traditional sense - it could be:
1. Different menu configurations between environments
2. Missing media files in production
3. Intentional behavior difference

Further investigation needed to determine the expected behavior.
