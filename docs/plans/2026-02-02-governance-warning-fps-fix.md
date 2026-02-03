# Governance Warning FPS Fix Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix 80% FPS degradation during governance warning state by replacing video filters with overlay-only visual effects.

**Architecture:** Remove CSS `filter` from video elements entirely. Use a semi-transparent tinted overlay with `backdrop-filter: blur()` to achieve the same visual warning effect. This keeps video decoding untouched and lets the GPU composite a single overlay layer.

**Tech Stack:** SCSS, React (no changes to component logic)

---

## Background

The current `.governance-filter-warning` class applies:
1. `filter: sepia(0.65) brightness(0.8) contrast(1.2)` directly to video elements
2. A `::before` pseudo-element with `backdrop-filter: blur(2px)`

This combination forces the GPU to filter every decoded video frame AND composite a backdrop-filter on top, causing severe FPS degradation (50 → 9-11 FPS).

The fix: Remove the video filter entirely and use ONLY an overlay with a tinted background + blur.

---

## Task 1: Update governance-filter-warning SCSS

**Files:**
- Modify: `frontend/src/modules/Fitness/FitnessPlayer.scss:497-521`

**Step 1: Read the current implementation**

Verify current code at lines 497-521:
```scss
&.governance-filter-warning {
  .player,
  .video-player,
  video,
  dash-video {
    filter: sepia(0.65) brightness(0.8) contrast(1.2);
    transition: filter 0.3s ease;
  }

  &::before {
    content: '';
    position: absolute;
    inset: 0;
    backdrop-filter: blur(2px);
    -webkit-backdrop-filter: blur(2px);
    z-index: 5;
    pointer-events: none;
    transition: backdrop-filter 0.3s ease;
  }
}
```

**Step 2: Replace with overlay-only approach**

Replace lines 497-521 with:
```scss
&.governance-filter-warning {
  // FPS FIX: No filters on video elements - all visual effects via overlay only
  // This prevents GPU from filtering every decoded video frame
  // See: docs/_wip/bugs/2026-02-02-fps-degradation-governance-warning.md

  &::before {
    content: '';
    position: absolute;
    inset: 0;
    // Warm sepia-like tint via semi-transparent overlay
    background: rgba(139, 92, 42, 0.25);
    // Slight blur for "hazy warning" effect
    backdrop-filter: blur(2px);
    -webkit-backdrop-filter: blur(2px);
    z-index: 5;
    pointer-events: none;
    transition: background 0.3s ease, backdrop-filter 0.3s ease;
  }
}
```

**Step 3: Verify SCSS compiles**

Run: `npm run build` (or check dev server doesn't error)
Expected: No SCSS compilation errors

**Step 4: Commit**

```bash
git add frontend/src/modules/Fitness/FitnessPlayer.scss
git commit -m "fix(fitness): remove video filter in governance warning for FPS

Replace sepia/brightness/contrast filter on video elements with
a tinted semi-transparent overlay. This prevents GPU from filtering
every decoded frame, fixing 80% FPS degradation.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

## Task 2: Visual Verification (Manual)

**Step 1: Start dev server**

Run: `npm run dev`

**Step 2: Trigger governance warning state**

Navigate to fitness app with governed content and drop HR to cool zone (or use the test simulator).

**Step 3: Visually verify the effect**

Check that:
- [ ] Video has a warm/sepia-ish tint (from the overlay background)
- [ ] Slight blur is visible
- [ ] The effect is clearly distinguishable from normal playback
- [ ] FPS feels smooth (not stuttery)

**Step 4: Compare with critical state**

Verify `governance-filter-critical` still works (it should be unchanged - uses grayscale filter which is less expensive than sepia+brightness+contrast combo).

---

## Task 3: Run Governance Performance Test

**Files:**
- Test: `tests/live/flow/fitness/governance-performance.runtime.test.mjs`

**Step 1: Ensure dev server is running**

Run: `npm run dev` (if not already running)

**Step 2: Run the performance test**

Run: `npx playwright test tests/live/flow/fitness/governance-performance.runtime.test.mjs --headed`

**Step 3: Check FPS metrics**

Expected results:
- HURDLE 9 (baseline FPS): > 30 FPS
- HURDLE 11 (warning FPS): > 30 FPS (was 9-11 before fix)
- FPS degradation: < 30% (was 80% before fix)

**Step 4: If tests pass, commit is already done**

The fix is complete. If tests fail, investigate the specific hurdle that failed.

---

## Task 4: Update Bug Documentation

**Files:**
- Modify: `docs/_wip/bugs/2026-02-02-fps-degradation-governance-warning.md`

**Step 1: Update status**

Change the header:
```markdown
**Status:** Open - Root Cause Analysis Complete
```
To:
```markdown
**Status:** Fixed - Overlay-only approach implemented
```

**Step 2: Add resolution section**

Add before the `## Conclusion` section:
```markdown
---

## Resolution

**Fix applied:** Removed all CSS filters from video elements in `.governance-filter-warning`. Visual warning effect now achieved entirely via a semi-transparent tinted overlay (`rgba(139, 92, 42, 0.25)`) with `backdrop-filter: blur(2px)`.

**Result:** Video decoding path untouched. GPU composites a single overlay layer instead of filtering + double-compositing.

**Commit:** [reference commit hash after committing]
```

**Step 3: Commit documentation update**

```bash
git add docs/_wip/bugs/2026-02-02-fps-degradation-governance-warning.md
git commit -m "docs: mark governance FPS bug as fixed

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

## Task 5: Optional - Tune Visual Effect

If the visual effect is too subtle or too strong after Task 2 verification:

**Adjust tint intensity:**
- More visible: `rgba(139, 92, 42, 0.35)` (increase alpha)
- More subtle: `rgba(139, 92, 42, 0.18)` (decrease alpha)

**Adjust blur:**
- More blur: `blur(4px)`
- Less blur: `blur(1px)`

**Alternative color approaches:**
- Amber warning: `rgba(180, 120, 40, 0.25)`
- Orange alert: `rgba(200, 100, 20, 0.25)`
- Neutral dim: `rgba(0, 0, 0, 0.3)` (no color tint, just darken)

---

## Rollback Plan

If the fix causes unexpected issues, revert to original by restoring video filters:

```scss
&.governance-filter-warning {
  .player,
  .video-player,
  video,
  dash-video {
    filter: sepia(0.65) brightness(0.8) contrast(1.2);
    transition: filter 0.3s ease;
  }

  &::before {
    content: '';
    position: absolute;
    inset: 0;
    backdrop-filter: blur(2px);
    -webkit-backdrop-filter: blur(2px);
    z-index: 5;
    pointer-events: none;
    transition: backdrop-filter 0.3s ease;
  }
}
```

---

## Success Criteria

- [ ] FPS during warning state > 30 (was 9-11)
- [ ] FPS degradation < 30% (was 80%)
- [ ] Visual warning effect is clearly visible
- [ ] No SCSS compilation errors
- [ ] Existing governance tests pass
