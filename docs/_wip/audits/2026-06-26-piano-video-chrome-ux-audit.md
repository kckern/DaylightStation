# Piano Video Player Chrome — UX Audit

**Date:** 2026-06-26  
**Files audited:**  
- `frontend/src/modules/Piano/PianoKiosk/modes/Videos/PianoVideoChrome.jsx`  
- `frontend/src/modules/Piano/PianoKiosk/MixControls.jsx`  
- `frontend/src/Apps/PianoApp.scss` (lines 1077–1108, 1646–1659)

---

## Context

The piano video player chrome is the control bar rendered below the video during lesson playback. It has accumulated transport controls, A/B loop markers, playback speed, MIDI/audio mix controls, and a play-along toggle — all in a single flex row with `flex-wrap: wrap`, causing it to overflow into two visible rows on the kiosk display.

---

## Design Sins (Enumerated)

### 1. Two-Row Chrome — The Root Crime

The row uses `flex-wrap: wrap` and contains ~18 interactive elements. MixControls spills to a second row, producing a double-height chrome strip that consumes roughly a quarter of the screen on a kiosk. The controls have been added one at a time to a single flat row with no layout budget, and it shows.

**Evidence:** The screenshot shows two full rows of buttons beneath the progress bar.

---

### 2. MixControls Don't Belong in the Transport Row

MIDI piano volume and media audio volume are settings, not transport operations. They are not used every time you pause or skip — yet they live permanently inline with the play button. This is the textbook "piling on slop" pattern: every feature gets added as a sibling to every other feature, regardless of context or frequency of use.

MixControls should live behind an icon that reveals them (an "emotal" / flyout), not occupy permanent horizontal real estate in the primary control row.

**Code:** `<MixControls ... />` inserted directly into `<div className="piano-video-chrome__row">` at line 58.

---

### 3. Variable-Width Speed Button

The speed button renders `{rate}×` — cycling through `0.5×`, `0.75×`, `1×`, `1.25×`, `1.5×`, `2×`. Each string is a different pixel width. With `min-width: 3rem` and `padding: 0 0.75rem`, the button auto-sizes to content. Every rate change shifts adjacent button positions. On a kiosk with fat-finger tapping, this is a miss tap waiting to happen.

**Fix needed:** fixed `width` (not just `min-width`) on every button that displays text content.

---

### 4. Four Skip Buttons for No Good Reason

There are four skip buttons: ◀◀30 ◀◀15 ▶▶15 ▶▶30. Two granularities × two directions. In practice, one skip granularity is almost always enough (15s is the standard). The ±30s buttons exist but double the center-cluster's physical width and dilute the play button's visual dominance.

The center cluster should be: ◀◀ [PLAY] ▶▶ — one skip distance per side, configurable behind a preference, not four permanent buttons.

---

### 5. No "Start at Beginning" Button

There is no restart/rewind-to-start affordance. Skipping backward 30 seconds at a time from minute 13 is 26 taps. For a kiosk used by students who want to replay a lesson from the top, this is a glaring omission — especially since the A/B loop and watch-history features signal that replaying content is a primary use case.

A prominent restart button (|◀ or ↩) on the far left, outside the transport cluster, is the standard solution.

---

### 6. A/B Loop Controls Are Four Opaque Orphans

The A/B loop system has four controls: [A] [B] [↻] [✕]. They are presented as four identical-styled buttons with no visual grouping, interleaved with `1×` and MixControls. The relationship between them — "A sets start, B sets end, ↻ activates, ✕ clears" — is invisible. A first-time user has no idea what [A] does next to [1×].

The four controls belong in a visually grouped cluster (e.g., a pill or bordered subgroup) with a label or icon that signals "loop zone."

---

### 7. "A" and "B" Are Ambiguous Labels

In the context of a music/piano app, "A" and "B" might be musical sections (which they are in some notation contexts) but here they mean "loop start marker" and "loop end marker." The letters carry no visual affordance of their function. The arming state (`is-arming` — border turns amber when A is set but B is not) helps, but only if you already know what you're arming.

---

### 8. The `1.00` Ghost in the Top-Left

The screenshot shows `1.00` rendered in the top-left corner of the video area, in the same text color and style as content. This appears to be a floating state value (likely `mediaLevel` from `PianoMixContext`) being rendered somewhere unexpected — possibly a stray debug output or a misplaced display node that never got cleaned up. It has no label, no context, and no obvious parent UI element.

---

### 9. Play-Along Button Is Contextually Isolated

The keyboard icon (play-along toggle) lives on the far right of the row, separated from everything else by a `flex-spacer`. It has no label and its icon (a small keyboard silhouette) gives no hint that it toggles a second panel with chord notation. On the current two-row layout, it also appears to visually float on the second row's right edge, separated from the controls it belongs with.

---

### 10. All Buttons Look the Same

Every control — skip, speed, loop marker, loop toggle, loop clear, play-along — uses `piano-video-chrome__btn`, the same size, border, and background. The only hierarchical distinction is the play button (larger, accent-colored). Everything else is visually flat. There's no way to distinguish "I use this constantly" (play, skip) from "I use this occasionally" (speed, loop) from "I use this once per session" (mix controls, play-along).

---

### 11. `flex-wrap: wrap` as a Layout Strategy

The underlying structural sin is using `flex-wrap: wrap` on a row that has too much content. Wrapping is fine for responsive grids of unknown content. It is not a layout strategy for a fixed-function control bar. The result is non-deterministic: depending on container width, items can end up in different positions on different screens, making muscle memory impossible.

The chrome should have a fixed, declared layout — no wrapping allowed.

---

### 12. Play Button Height Mismatch

The play button is `height: 3.5rem` while all other buttons are `height: 3rem`. This 0.5rem difference causes the row to be taller than all the sibling buttons require, adding passive vertical bulk. Either unify heights or commit to a deliberate size hierarchy.

---

## Proposed Reorganization

**Single-row chrome, fixed layout:**

```
[|◀ Restart]  [◀◀15]  [▶ Play/Pause]  [▶▶15]        [1×]  [A/B loop group]  [mix icon]  [play-along]
```

- **Restart** (|◀): far left, always visible, clearly labeled or iconographically distinct.
- **Skip**: one granularity per side (15s). Remove ±30s buttons.
- **Speed**: fixed-width button (e.g., `width: 3.5rem`) so "0.75×" and "1×" don't shift layout.
- **A/B loop group**: bordered pill containing [A] [B] [↻] [✕] — visually grouped, not flat siblings.
- **Mix icon** (volume/equalizer icon): tapping reveals a flyout or modal with the two volume clusters. Hidden by default.
- **Play-along**: icon on far right, same as today, but no spacer gymnastics needed in a clean layout.

**No `flex-wrap`**: If content doesn't fit, shrink gaps or reduce padding — do not wrap.

---

## Files to Change

| File | What changes |
|------|-------------|
| `PianoVideoChrome.jsx` | Remove MixControls from the row; add restart button; group A/B controls; fix speed button to fixed-width |
| `MixControls.jsx` | No structural change; used inside the new mix flyout |
| `PianoApp.scss` | Remove `flex-wrap: wrap` from `__row`; add fixed width to `__btn` where text content varies; add A/B group styles; add mix-flyout styles |
| `PianoVideoPlayer.jsx` | Wire `onRestart` (seek to 0) handler |
